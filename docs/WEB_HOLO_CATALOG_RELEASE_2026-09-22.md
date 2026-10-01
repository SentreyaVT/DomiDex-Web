# Web Holo + anniversary catalogue release — 2026-09-22

Published with explicit user approval to `https://domidex.web.app/app`.

- Hosting version: `e343e4216021ef1b` (previous: `e34a934133f6efbe`).
- Pinned Cloud Run revision: `domidex-web-holo-catalog-20260922`.
- Image digest: `sha256:46a376ad07c634da7c1307fdeb33d5a2ef962c80db860d0e0cc6759c43ab42aa`.
- Cloud Build: `d493e3b8-74c3-4ff0-8d0a-79b471db290f`, europe-west1, SUCCESS.

## Changes

The existing collector `/app` frontend includes 27 redesigned private-binder
Holo materials, coupled to card tilt rather than an autonomous animation clock.
Existing anniversary and collection-card/full-art effects remain preserved.
The existing public card-search, set-detail and card-detail APIs now expose
three separate RGB Mew records and 17 numbered MEP094–110 records. See
`catalog-30th-supplement.md` for exact identities, verified artwork, product
links and limitations. No unavailable prices or product links were guessed.

The release layers the current immutable production runtime. Authentication,
sharing, protected operations, admin pages, legal pages, environment and IAM
remain unchanged. All 155 Hosting file hashes were retained; only the catchall
runtime tag changed. Old hashed frontend assets remain available to open tabs.
No Firestore/Storage rules, claims, collection data or Google Play changes.

## Verification

- Holo work: 79 targeted tests, typecheck, production build and targeted lint.
- Catalogue work: 133 targeted tests, typecheck, production build and targeted
  lint; eight route tests rerun after import cleanup. These test sets overlap
  and are not presented as an aggregate distinct-test count.
- Release packaging: browser public Firebase configuration matches production;
  source and artifact hashes fixed and checked before promotion.
- Candidate: 45 checks passed, including preserved runtime routes and assets.
- Production: 41 checks passed, including every new card detail, 14 exact
  product IDs, six intentionally unmapped records, separate Nidorina printings,
  both sets, Mew/RGB search, bounded empty search and unknown-card 404.
- Protected read-only endpoints remain inaccessible without authentication.
- Browser: existing signed-in session and 365-card collection load; R/RGB
  search returns exactly red Mew, real card artwork and honest unavailable
  price. Large preview and keyboard tilt work. Nothing was added or edited in
  the user's collection. This is not a fresh Google sign-in or device-sync test.

Ignored release evidence and guarded scripts:
`.domidex/web-holo-catalog-release-20260922/`.
No Git commit/push or Android device installation was performed.
