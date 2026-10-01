import type { TcgCardDetail, TcgCardSummary, TcgSetDetail } from './domain';

export type CardLoad = Readonly<{ promise: Promise<TcgCardDetail>; cacheExpiresAt: number }>;
const cardCache = new Map<string, CardLoad>();
const setCache = new Map<string, Promise<TcgSetDetail>>();
const cacheTimes = new Map<string, number>();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_LIMIT = 600;

async function boundedFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Zeitlimit beim Laden der Katalogdaten erreicht.'));
      controller.abort();
      // A stalled stream/cancellation hook must not keep the caller pending.
      void reader?.cancel().catch(() => {});
    }, 15_000);
  });
  try {
    const response = await Promise.race([fetch(url, { signal: controller.signal }), deadline]);
    // Include reading the response body in the deadline, not just receiving headers.
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      while (true) {
        const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
        size += part.value.byteLength;
        if (size > 8 * 1024 * 1024) { void reader.cancel().catch(() => {}); throw new Error('Katalogantwort überschreitet das sichere Größenlimit.'); }
        chunks.push(part.value);
      }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(size ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally { clearTimeout(timer!); reader?.releaseLock(); }
}

export async function searchCards(query: string): Promise<TcgCardSummary[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const response = await boundedFetch(`/api/cards/search?q=${encodeURIComponent(normalized)}`);
  if (!response.ok) throw new Error('Die Kartensuche ist gerade nicht erreichbar.');
  return response.json() as Promise<TcgCardSummary[]>;
}

export function loadCard(id: string): Promise<TcgCardDetail> {
  return loadCardWithCacheInfo(id).promise;
}

/** Cache deadline of this exact request, not the provider's price date or a new freshness grant. */
export function loadCardWithCacheInfo(id: string): CardLoad {
  const safe = id.trim();
  const existing = cardCache.get(safe);
  const startedAt = Date.now();
  if (existing && startedAt < existing.cacheExpiresAt) return existing;
  const request = boundedFetch(`/api/cards/${encodeURIComponent(safe)}`)
    .then((response) => {
      if (!response.ok) throw new Error('Kartendetails konnten nicht geladen werden.');
      return response.json() as Promise<TcgCardDetail>;
    })
    .catch((error) => {
      // An evicted request may settle after a newer request for the same public ID.
      if (cardCache.get(safe)?.promise === request) cardCache.delete(safe);
      throw error;
    });
  const entry = Object.freeze({ promise: request, cacheExpiresAt: startedAt + CACHE_TTL });
  cardCache.set(safe, entry);
  if (cardCache.size > CACHE_LIMIT) cardCache.delete(cardCache.keys().next().value!);
  return entry;
}

export function loadSet(id: string): Promise<TcgSetDetail> {
  const safe = id.trim().toLowerCase(); const existing = setCache.get(safe); if (existing && Date.now() - (cacheTimes.get(`set:${safe}`) ?? 0) < CACHE_TTL) return existing;
  const request = Promise.all([boundedFetch(`/api/sets/${encodeURIComponent(safe)}`), boundedFetch(`/catalog/sets/${encodeURIComponent(safe)}.json`).catch(() => null)]).then(async ([response, manifestResponse]) => {
    if (!response.ok) throw new Error('Das vollständige Set konnte nicht geladen werden.');
    const set = await response.json() as TcgSetDetail;
    if (!manifestResponse?.ok) return set;
    let manifest: { cards?: Array<Omit<TcgCardSummary, 'printVariants'> & { variants?: string[] }> };
    try { manifest = await manifestResponse.json(); } catch { return set; }
    if (!manifest || !Array.isArray(manifest.cards) || manifest.cards.some((card) =>
      !card || typeof card.id !== 'string' || (card.variants !== undefined &&
        (!Array.isArray(card.variants) || card.variants.some((variant) => typeof variant !== 'string'))))) return set;
    const metadata = new Map((manifest.cards ?? []).map((card) => [card.id.toLowerCase(), card]));
    const cards: TcgCardSummary[] = set.cards.map((card) => ({ ...card, printVariants: card.printVariants ?? metadata.get(card.id.toLowerCase())?.variants, rarity: metadata.get(card.id.toLowerCase())?.rarity ?? card.rarity }));
    const known = new Set(cards.map((card) => card.id.toLowerCase()));
    for (const card of manifest.cards ?? []) if (!known.has(card.id.toLowerCase())) cards.push({ ...card, printVariants: card.variants });
    return { ...set, cards };
  }).catch((error) => { setCache.delete(safe); throw error; });
  setCache.set(safe, request); cacheTimes.set(`set:${safe}`, Date.now()); return request;
}

export function imageUrl(base?: string, quality: 'low' | 'high' = 'high') {
  if (!base) return null;
  if (/\/(?:low|high)\.(?:webp|png|jpe?g)$/i.test(base) || /\.(?:webp|png|jpe?g)$/i.test(base)) return base;
  return `${base}/${quality}.webp`;
}
