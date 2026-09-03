import type { TcgCardDetail, TcgCardSummary, TcgSetDetail } from './domain';

const cardCache = new Map<string, Promise<TcgCardDetail>>();
const setCache = new Map<string, Promise<TcgSetDetail>>();

export async function searchCards(query: string): Promise<TcgCardSummary[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const response = await fetch(`/api/cards/search?q=${encodeURIComponent(normalized)}`);
  if (!response.ok) throw new Error('Die Kartensuche ist gerade nicht erreichbar.');
  return response.json() as Promise<TcgCardSummary[]>;
}

export function loadCard(id: string): Promise<TcgCardDetail> {
  const safe = id.trim();
  const existing = cardCache.get(safe);
  if (existing) return existing;
  const request = fetch(`/api/cards/${encodeURIComponent(safe)}`)
    .then((response) => {
      if (!response.ok) throw new Error('Kartendetails konnten nicht geladen werden.');
      return response.json() as Promise<TcgCardDetail>;
    })
    .catch((error) => {
      cardCache.delete(safe);
      throw error;
    });
  cardCache.set(safe, request);
  return request;
}

export function loadSet(id: string): Promise<TcgSetDetail> {
  const safe = id.trim().toLowerCase(); const existing = setCache.get(safe); if (existing) return existing;
  const request = Promise.all([fetch(`/api/sets/${encodeURIComponent(safe)}`), fetch(`/catalog/sets/${encodeURIComponent(safe)}.json`)]).then(async ([response, manifestResponse]) => {
    if (!response.ok) throw new Error('Das vollständige Set konnte nicht geladen werden.');
    const set = await response.json() as TcgSetDetail;
    if (!manifestResponse.ok) return set;
    const manifest = await manifestResponse.json() as { cards?: Array<Omit<TcgCardSummary, 'printVariants'> & { variants?: string[] }> };
    const metadata = new Map((manifest.cards ?? []).map((card) => [card.id.toLowerCase(), card]));
    const cards: TcgCardSummary[] = set.cards.map((card) => ({ ...card, printVariants: metadata.get(card.id.toLowerCase())?.variants, rarity: metadata.get(card.id.toLowerCase())?.rarity ?? card.rarity }));
    const known = new Set(cards.map((card) => card.id.toLowerCase()));
    for (const card of manifest.cards ?? []) if (!known.has(card.id.toLowerCase())) cards.push({ ...card, printVariants: card.variants });
    return { ...set, cards };
  }).catch((error) => { setCache.delete(safe); throw error; });
  setCache.set(safe, request); return request;
}

export function imageUrl(base?: string, quality: 'low' | 'high' = 'high') {
  if (!base) return null;
  if (/\/(?:low|high)\.(?:webp|png|jpe?g)$/i.test(base) || /\.(?:webp|png|jpe?g)$/i.test(base)) return base;
  return `${base}/${quality}.webp`;
}
