import type { TcgCardDetail, TcgVariant } from './domain';

export type DlrCardmarketMappingStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'UNMATCHED' | 'REJECTED';

export type DlrCardmarketMappingRecord = Readonly<{
  sourceCardId: string;
  collectorNumber: string;
  productId: number | null;
  finish: 'Normal';
  variant: 'Standard';
  status: DlrCardmarketMappingStatus;
  provenance: string;
  verifiedAt: string | null;
}>;

const verifiedAt = '2026-11-23T00:00:00.000Z';
const declaredProvenance = 'TCGdex declared product + Cardmarket expansion/name/attack fingerprint';
const fingerprintProvenance = 'Cardmarket expansion + unique English name/complete attack fingerprint';
const verified = (
  collectorNumber: string,
  productId: number,
  provenance = declaredProvenance,
): DlrCardmarketMappingRecord => ({
  sourceCardId: `me06-${collectorNumber}`, collectorNumber, productId, finish: 'Normal', variant: 'Standard',
  status: 'VERIFIED', provenance, verifiedAt,
});

const verifiedRecords = [
  verified('001', 918810), verified('002', 918811), verified('004', 918813),
  verified('005', 918814), verified('006', 918815), verified('007', 918816),
  verified('008', 918817), verified('009', 918818), verified('013', 918823),
  verified('014', 918824), verified('015', 918825), verified('016', 918826),
  verified('020', 918834), verified('022', 918837), verified('024', 918839),
  verified('027', 918842), verified('030', 918846), verified('032', 918848),
  verified('034', 918850), verified('037', 918854), verified('038', 918855),
  verified('040', 918857), verified('041', 918858), verified('042', 918859),
  verified('043', 918863), verified('044', 918864), verified('045', 918865),
  verified('046', 918867), verified('049', 918871), verified('051', 918873),
  verified('056', 918879), verified('058', 918881), verified('060', 918883),
  verified('061', 918884), verified('062', 918885), verified('064', 918888),
  verified('065', 918889), verified('067', 918892), verified('070', 918896),
  verified('072', 918900), verified('073', 918901), verified('074', 918902),
  verified('076', 918904), verified('077', 918905), verified('081', 918909),
  verified('086', 918914), verified('087', 918915), verified('093', 918921),
  verified('129', 918968),
  // TCGdex has no usable Cardmarket root for these cards. Each is still
  // unambiguous: exactly one product in expansion 6704 has the same English
  // name and full attack-name fingerprint.  No title-only bridge is used.
  verified('010', 918819, fingerprintProvenance),
  verified('017', 918827, fingerprintProvenance),
  verified('028', 918843, fingerprintProvenance),
  verified('035', 918852, fingerprintProvenance),
  verified('039', 918856, fingerprintProvenance),
  verified('050', 918872, fingerprintProvenance),
  verified('052', 918875, fingerprintProvenance),
  verified('054', 918877, fingerprintProvenance),
  verified('055', 918878, fingerprintProvenance),
  verified('057', 918880, fingerprintProvenance),
  verified('075', 918903, fingerprintProvenance),
  verified('079', 918907, fingerprintProvenance),
  verified('085', 918913, fingerprintProvenance),
] as const;

const byCardId = new Map(verifiedRecords.map((record) => [record.sourceCardId, record]));
const unmatchedCollectors = new Set(['090', '094', '095', '098', '099', '101', '126', '132', '133', '134']);

/** Returns all DLR slots, making unresolved data visible rather than silently absent. */
export function dlrCardmarketMappingRecords(): DlrCardmarketMappingRecord[] {
  return Array.from({ length: 141 }, (_, index) => {
    const collectorNumber = String(index + 1).padStart(3, '0');
    return byCardId.get(`me06-${collectorNumber}`) ?? {
      sourceCardId: `me06-${collectorNumber}`, collectorNumber, productId: null,
      finish: 'Normal', variant: 'Standard', status: unmatchedCollectors.has(collectorNumber) ? 'UNMATCHED' : 'NEEDS_REVIEW',
      provenance: unmatchedCollectors.has(collectorNumber) ? 'No Cardmarket root reference supplied by TCGdex' : 'No print-specific Cardmarket evidence yet', verifiedAt: null,
    };
  });
}

function verifiedProduct(card: TcgCardDetail, variant: TcgVariant): number | null {
  const record = byCardId.get(card.id.toLowerCase());
  if (!record || record.status !== 'VERIFIED' || record.productId === null) return null;
  if (!/^normal$/i.test(variant.type) || (variant.size && !/^standard$/i.test(variant.size))) return null;
  // A source root may be absent; that is why this independently reviewed
  // mapping exists. A present but contradictory root remains a hard reject.
  const sourceProductId = card.pricing?.cardmarket?.idProduct;
  return sourceProductId == null || sourceProductId === record.productId ? record.productId : null;
}

/** Adds a product only to the exact verified normal printing; no root fallback is exposed. */
export function attachVerifiedDlrCardmarketPricing<T extends TcgCardDetail>(card: T): T {
  const variants = card.variants_detailed;
  if (!card.id.toLowerCase().startsWith('me06-') || !variants?.length) return card;
  return {
    ...card,
    variants_detailed: variants.map((variant) => {
      const productId = verifiedProduct(card, variant);
      if (productId === null) return variant;
      return {
        ...variant,
        thirdParty: { ...variant.thirdParty, cardmarket: productId },
        pricing: { ...variant.pricing, cardmarket: { ...card.pricing?.cardmarket, ...variant.pricing?.cardmarket, idProduct: productId } },
      };
    }),
  };
}
