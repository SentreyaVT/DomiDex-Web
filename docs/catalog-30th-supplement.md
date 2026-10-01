# Verified anniversary catalogue supplement

Source date: 2026-09-22. This mirrors the Android repository's
`app/src/main/java/com/dominik/cardvault/data/catalog/ThirtyYearsCatalogSupplement.kt`
and `docs/catalog-30th-supplement-20260922.md`, including their verified artwork and
conservative Cardmarket mappings.

The Web catalogue adds independent `30th-rgb-r`, `30th-rgb-g`, and `30th-rgb-b`
records for Mew R/RGB, G/RGB, B/RGB; they are not finishes of Mew-ex 158/128.
The full main-set count becomes 161 while its printed denominator remains 128.
`30th-c` remains a separate catalogue.

MEP 094–110 add 17 real numbered promo identities under `mep-094` through
`mep-110`. Nidorina 101 has a regular Holo and a separate Pokémon Center
printing. Its shared artwork is the regular German card; no separate stamped
artwork or jumbo variant is inferred. The full details and Binder slots preserve
Android's `Standard · Stempel: Pokémon-Center` descriptor.

Verified artwork sources:

- RGB R/G/B: Serebii `https://www.serebii.net/card/30thcelebration/rgb1.jpg`,
  `rgb2.jpg`, and `rgb3.jpg` respectively. The corresponding [R](https://www.serebii.net/card/30thcelebration/RGB1.shtml),
  [G](https://www.serebii.net/card/30thcelebration/RGB2.shtml), and
  [B](https://www.serebii.net/card/30thcelebration/RGB3.shtml) records establish the mappings.
- MEP 094, 095, 099–103, 107–110: official German Pokémon artwork at
  `https://assets.pokemon.com/static-assets/content-assets/cms2-de-de/img/cards/web/MEP/MEP_DE_<number>.png`.
- MEP 096–098 and 104–106: the verified English fallback images at
  `https://www.serebii.net/card/megapromos/<number>.jpg`, linked from the
  [individual MEP records](https://www.serebii.net/card/megapromos/).

Filenames above use unpadded numbers. All 20 URLs were decoded and visually
checked during the Android source verification; displayed names remain German.
The Web keeps these remote URLs and does not bundle card artwork.

The verified Cardmarket product IDs are 094→895609, 095→895610, 096→895606,
097→895607, 098→895608, 102→895613, 103→895614, 104→895620, 105→895621,
106→895619, 107→895615, 108→895616, 109→895617, 110→895618. No prices are
embedded. RGB and MEP 099/100/101 remain unlinked because product-to-colour or
printing mapping is unresolved; product order is never used to guess it.

Integration is through the existing card search, set-detail, and card-detail
APIs. Existing upstream identities/metadata win; verified artwork fills only a
missing image. Known local card details are available when the upstream endpoint
is absent or temporarily unavailable. Unknown IDs retain normal upstream errors.
The set merge is idempotent and also deduplicates by actual printed number.
Optional scanner manifests cannot erase the verified printing selection.

No Firebase, authentication, sharing authorization, or security policy is changed.
This supplement does not claim that every announced promo is already available
at retail or that its corresponding TCGdex detail endpoint exists.
