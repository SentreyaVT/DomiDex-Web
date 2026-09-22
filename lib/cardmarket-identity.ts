/** Reviewed exact source/product contradictions (2026-09-22); never guess a replacement. */
export function isQuarantinedCardmarketIdentity(sourceCardId: string | null | undefined, productId: number | null | undefined): boolean {
  const identity = sourceCardId?.trim().toLowerCase();
  if (!identity) return false;
  const stem = productId === 670816 ? 'swsh11-201' : productId === 781858 ? 'sv03-062' : null;
  if (!stem) return false;
  const prefix = `tcgdex-${stem.slice(0, stem.lastIndexOf('-'))}-`;
  const source = identity.startsWith(prefix) ? identity.slice(prefix.length) : identity;
  return source === stem || source.startsWith(`${stem}-`);
}
