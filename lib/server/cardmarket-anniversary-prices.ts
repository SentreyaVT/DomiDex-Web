import { boundedJson } from '@/lib/bounded-json';
import { anniversaryProducts } from './cardmarket-anniversary-products';

const GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const MAXIMUM_GUIDE_BYTES = 32 * 1024 * 1024;
const CACHE_MILLIS = 60 * 60 * 1000;
const RETRY_MILLIS = 60 * 1000;
const knownProducts = new Set(Object.values(anniversaryProducts));
type Fields = Record<string, unknown>;
type GuidePrice = {
  trend: number | null;
  'trend-holo': number | null;
  avg?: number;
  low?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  'avg-holo'?: number;
  'low-holo'?: number;
  updated?: string;
};
let cached: { expires: number; prices: Map<number, GuidePrice> } | undefined;
let pending: Promise<Map<number, GuidePrice>> | undefined;

function fields(value: unknown): Fields | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;
}
function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** One shared bounded download per server process, retaining only reviewed product IDs. */
async function guidePrices(): Promise<Map<number, GuidePrice>> {
  if (cached && cached.expires > Date.now()) return cached.prices;
  if (pending) return pending;
  pending = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Price guide timed out.')); }, 6_000);
    });
    try {
      const response = await Promise.race([fetch(GUIDE_URL, {
        headers: { Accept: 'application/json', 'User-Agent': 'DomiDex-Web/1.0-pre-beta' },
        signal: controller.signal,
      }), deadline]);
      if (!response.ok) throw new Error('Price guide unavailable.');
      const data = await Promise.race([boundedJson(response, MAXIMUM_GUIDE_BYTES), deadline]);
      if (!Array.isArray(data.priceGuides) || data.priceGuides.length > 250_000) throw new Error('Invalid price guide.');
      const updated = typeof data.createdAt === 'string' && data.createdAt.length <= 80 && Number.isFinite(Date.parse(data.createdAt)) ? data.createdAt : undefined;
      const prices = new Map<number, GuidePrice>();
      const duplicates = new Set<number>();
      for (const raw of data.priceGuides) {
        const row = fields(raw), id = row?.idProduct;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || !knownProducts.has(id)) continue;
        // Conflicting duplicate rows are not a reliable source for an exact price.
        if (prices.has(id) || duplicates.has(id)) { prices.delete(id); duplicates.add(id); continue; }
        const alternatives = Object.fromEntries([
          ['avg', price(row?.avg)], ['low', price(row?.low)], ['avg1', price(row?.avg1)],
          ['avg7', price(row?.avg7)], ['avg30', price(row?.avg30)],
          ['avg-holo', price(row?.['avg-holo'])], ['low-holo', price(row?.['low-holo'])],
        ].filter((item): item is [string, number] => item[1] !== null));
        prices.set(id, { trend: price(row?.trend), 'trend-holo': price(row?.['trend-holo']), ...alternatives, ...(updated ? { updated } : {}) });
      }
      cached = { expires: Date.now() + CACHE_MILLIS, prices };
      return prices;
    } catch {
      // A short negative cache avoids one failed download per visible card.
      const prices = new Map<number, GuidePrice>();
      cached = { expires: Date.now() + RETRY_MILLIS, prices };
      return prices;
    } finally { clearTimeout(timer!); }
  })().finally(() => { pending = undefined; });
  return pending;
}

function emptyMarker(value: unknown): boolean {
  return value == null || (typeof value === 'string' && !value.trim())
    || (Array.isArray(value) && value.every((item) => typeof item === 'string' && !item.trim()));
}
function ordinaryVariant(variant: Fields): boolean {
  if (typeof variant.type !== 'string' || !['normal', 'holo', 'reverse', 'reverse holo'].includes(variant.type.trim().toLowerCase())) return false;
  const size = variant.size == null || variant.size === '' ? variant.type : variant.size;
  return typeof size === 'string' && ['standard', 'normal', 'holo', 'reverse holo'].includes(size.trim().toLowerCase())
    && emptyMarker(variant.stamp) && emptyMarker(variant.foil) && emptyMarker(variant.subtype);
}
function sameCardIdentity(card: Fields, id: string): boolean {
  const setId = id.startsWith('30th-c-') ? '30th-c' : id.startsWith('30th-') ? '30th' : 'mep';
  const localId = id.includes('-rgb-') ? `${id.slice(-1)}/rgb` : String(Number(id.slice(id.lastIndexOf('-') + 1)));
  const sourceNumber = typeof card.localId === 'string' ? card.localId.trim().toLowerCase() : '';
  return typeof card.id === 'string' && card.id.toLowerCase() === id && fields(card.set)?.id === setId
    && (id.includes('-rgb-') ? sourceNumber === localId : /^\d+$/.test(sourceNumber) && String(Number(sourceNumber)) === localId);
}

/** Enrich only reviewed identities and ordinary source-declared printings; never rewrite identity. */
export async function enrichAnniversaryPrices<T extends object>(card: T, requestedId: string): Promise<T> {
  const source = fields(card), id = requestedId.toLowerCase(), productId = anniversaryProducts[id];
  if (!source || typeof productId !== 'number' || !sameCardIdentity(source, id) || !Array.isArray(source.variants_detailed)) return card;
  const variants = source.variants_detailed;
  const eligible = variants.map((raw) => {
    const variant = fields(raw);
    if (!variant || !ordinaryVariant(variant)) return undefined;
    const own = fields(fields(variant.pricing)?.cardmarket);
    const base = variants.length === 1 ? fields(fields(source.pricing)?.cardmarket) : undefined;
    const pricing = own ?? base;
    const declaredIds = [own?.idProduct, fields(variant.thirdParty)?.cardmarket, base?.idProduct].filter((value) => value != null);
    if (declaredIds.some((value) => value !== productId) || (pricing?.unit != null && pricing.unit !== 'EUR')) return undefined;
    return { variant, pricing };
  });
  if (!eligible.some(Boolean)) return card;
  const guide = (await guidePrices()).get(productId);
  return { ...card, variants_detailed: variants.map((raw, index) => {
    const match = eligible[index];
    if (!match) return raw;
    const cardmarket: Fields = { ...match.pricing, idProduct: productId, unit: 'EUR' };
    if (guide) {
      // Treat the guide as one snapshot: a new null trend must not borrow a stale price,
      // and a missing guide date must not inherit the older source's timestamp.
      delete cardmarket.updated;
      Object.assign(cardmarket, guide);
    }
    return { ...match.variant, pricing: { ...fields(match.variant.pricing), cardmarket } };
  }) };
}
