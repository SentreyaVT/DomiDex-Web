# Anniversary prices and collection-layout sync — 2026-09-23

Published with the user's explicit GO to https://domidex.web.app/app.

- Hosting version: `4704f6013ed900e1`; previous: `e343e4216021ef1b`.
- Pinned revision: `domidex-web-prices-sync-20260923`.
- Image digest: `sha256:79ce0da27615603065eebce693ee6995a872ea29b1fdfb03bdf36d4f1e08bbbf`.
- Regional Cloud Build: `8e0dbf63-0f03-4d3c-8691-2f36b4d8221f`, SUCCESS.

## Changes and boundaries

The existing collector frontend now consumes owner-scoped collection-layout
changes. Hidden set-binder entries remain in collection/portfolio and available
to private binders. Cleanup/account-switch handling is tested.

The existing public card-detail route enriches 198 reviewed anniversary/MEP
identities from the official Cardmarket guide, matching Android's mappings.
This includes all 158 numbered main-set cards. Regular and reverse guide fields,
source identities and special-printing exclusions remain separate. Null prices
remain unavailable. No price values are hardcoded.

The release layers the immutable running production image. Authentication,
security/sharing backends, admin pages, landing/legal pages, environment and IAM
remain unchanged. All 155 Firebase Hosting file hashes were preserved. The
catchall points to the new verified tag; previous Cloud Run traffic targets and
old hashed frontend assets remain available. No rules, claims, user-data writes
or Google Play operations were performed.

## Verification

- 135 focused Web tests, TypeScript and production build succeeded.
- Candidate: 55 checks passed. Production: 51 checks passed.
- Checks include 27 exact product IDs with regular/reverse/date agreement to the
  official guide, three intentionally unmapped MEP records, RGB colour identity,
  set/search responses, source-card preservation, frontend asset hashes,
  public/legal routes and blocked unauthenticated protected endpoints.
- Existing browser login remains valid and the same 364-card collection loads.
  Set and private binders load; no collection or sharing buttons were submitted.
- Market prices remain separately fetched/cached, not instantaneous synchronized
  wire values. Existing browser HTTP cache can retain older card details for
  five minutes, and the client has a ten-minute memory cache. No claim of zero
  latency or a fresh two-device mutation roundtrip is made.

Guarded release scripts and exact evidence are retained locally in the ignored
`.domidex/web-anniversary-prices-sync-20260923/` directory. Each mutation stage
checked the immutable baseline, package/source hashes, runtime settings, IAM
and previous Hosting configuration before promotion. No Git commit/push.
