# Read-only binder sharing — production activation 2026-09-22

## R27 local-only follow-up: reuse exact price resolution (2026-10-02)

The current un-deployed R27 DTO path reuses its already resolved exact variant
and trend when deciding whether a manual price selection is needed. Previously,
a missing trend caused the same variant/trend to be resolved again. The extracted
identity predicate preserves owner, deletion, source and Cardmarket-product checks;
queries, authorization, DTO fields, price policy and cache behavior are unchanged.

A forwarding spy on the real resolver first reproduced 128 calls for 64 complete
missing-trend DTOs; the unchanged assertion now proves 64 calls. Seven complete
parity fixtures cover selected/trend/cleared/foreign-selection/different-product/
image-only/reverse behavior, unchanged input and excluded private fields. The
isolated full unit suite went from **1,294 PASS / 1 intentional FAIL** to
**1,295/1,295 PASS** across 78 files (23.53 s). Typecheck and focused lint pass
(zero lint warnings/errors). Existing React-act/Canvas unit-harness warnings remain.

Evidence: `outputs/release-local/2026-10-02T00-46-18-162Z-16120.{json,log}` (RED)
and `2026-10-02T00-49-35-054Z-18684.{json,log}` (GREEN). An initial lint invocation
used the unit-test child-process guard, which correctly blocked the lint helper;
the successful lint used the existing local-child/loopback-only CLI guard. This
was a launcher issue, not a product regression or weakened unit isolation.

This is a deterministic duplicate-work reduction, **not** a measured live speedup,
O(N) placement-read fix, provider fan-out limit or completion of Gate 6. No
deployment, production mutation, release package or device operation occurred.
The dated production-activation record below is historical, not R27 approval.

The operator explicitly authorized activation of private-binder sharing on 2026-09-22. The narrow sharing runtime is now enabled with `BINDER_SHARING_READY=verified-v1`; merely opening a binder does not create a share. Existing frontend bundles and routes are retained unchanged. This activation does not declare the unrelated Grand Update production-ready.

## Owner API integration

- `POST /api/binder-shares` with Firebase bearer token and `{ binderId, confirm: true, showPrices: false, showTotal: false, showDisplayName: false, displayName? }`.
- Response 201: `{ shareId, path, createdAt, options }`. Construct URL using the production site origin. Copying the link is an explicit user action. The raw token is returned only once and never stored.
- `GET /api/binder-shares?binderId=…` lists the owner's active shares (no raw tokens or owner identifiers).
- `GET /api/binder-shares` lists only the authenticated owner's private binder IDs, names and canonical cover IDs; no collection documents, notes or ownership UIDs. The gated owner component is integrated into the existing Binder view, including when no set binder exists.
- `DELETE /api/binder-shares` with owner bearer token and `{ shareId, confirm: true }` revokes the selected share.
- All flags default false. Display name requires an explicit non-email value. Every action requires current server-verified app access and matching ownership. Creating a share for someone else's binder, even as admin, is not supported.
- The advanced owner UI requires an unchecked-by-default confirmation. Android additionally has the operator-requested quick path: the explicit **Teilen** click creates one link with all optional fields OFF, after required sync acknowledgement, without a preliminary list request. Merely opening a binder never publishes it. Copying/system sharing are explicit actions. Links are memory-only; account/binder changes clear them. No automatic retry follows an uncertain POST. Management and two-step revocation remain available. HTTP requests are bounded to 15 seconds, independently of the bounded sync readiness wait.

## Public view

- `/share/{token}` and `GET /api/shared-binders/{token}?page=0` expose only a dedicated read-only DTO; public API implements GET only.
- Token = 256 random bits, base64url. Firestore stores only SHA-256 token hash plus owner, binder, flags and timestamps in `privateBinderShares`. All client SDK access is denied by existing catch-all rules. No new Firebase composite index is required.
- Read verifies share status, current owner entitlement/deletion state, owned binder and placements. Rechecks revocation/owner access after catalog resolution.
- Only referenced collection entries are read, not the whole collection. Nine slots per page match existing private-binder positions. Totals, when explicitly shared, resolve all currently placed entries, without multiplying by ownership quantity.
- Catalog identity must match exact ID, set and collector number. Product/foil mismatch gives no price. Only canonical TCGdex asset URLs are exposed; custom/private URLs and arbitrary owner card names are excluded. Pricing uses the existing exact variant resolver, never purchase prices.
- Prices and totals are independent options. Missing values never become invented zero prices. Incomplete totals are `null` with `complete:false`. Price fields are wholly absent when not enabled, including when only total is enabled.
- Limits: at most 5,000 placements for this first secure implementation; over-limit data fails closed. Upstream catalog work has six workers and a 12-second deadline. No price cache is persisted. Larger-binder pricing performance still needs load validation.
- No collection/binder mutations or recipient copies. Server responses are no-store; view polls every 15 seconds and rechecks on tab visibility. A revoked link fails on the next server request. Already seen/downloaded pixels cannot be recalled.
- Account deletion inventory includes share records; deletion lock immediately denies share access before cleanup.

## Original visual materials and safe web fallback

- The viewer uses byte-identical Android cover/core-Holo/element-Holo atlases, all 20 cover and 31 Holo IDs, the same 2.5% inset, effect palettes, medium-quality primitive geometry, bounded 8-degree tilt, overscan and two compositing layers. Metadata/source/asset hash and deterministic geometry tests detect drift from `PrivateBinderVisualEngine.kt`.
- The standalone Web test suite pins this parity contract in `tests/fixtures/android-binder-visual-contract.json`, extracted from Android commit `b28c16c3097950a8efc225a74003ebbf7749e857` (source Git-blob SHA-256 `1b7b2d879c5bbdd67fa7828aa1fc017e74319d96123082d68e66a8d33c5e9de2`). It verifies all three original atlas hashes, ordered stable IDs, Holo patterns and palettes without requiring a sibling Android checkout. Update the fixture only from a reviewed committed Android source/atlas revision, preserving source commit/hash attribution; never regenerate expected values from the Web renderer.
- A single local tilt value transforms card and foil together. No clock animates Holo; reduced-motion disables tilt while preserving a static material. Cover artwork uses the Android static phase/default intensity, not a replacement picture. Cross-browser compositing may differ and must still be visually accepted before activation.
- Large view is a dedicated read-only native dialog, with focus/Escape behavior. No private card component or private edit/remove/add controls are reused.
- Android's new `SharedBinderActivity` accepts only canonical HTTPS `domidex.web.app/share/{token}` links and consumes this same public DTO without authentication, Room, owner controls or a WebView. It remains portrait; the main activity and scanner are untouched. A device needs the updated APK to use this entry point. Older apps and devices without DomiDex retain the web fallback. Third-party embedded browsers and device link preferences can still require choosing “open in app”.
- The public `/.well-known/assetlinks.json` retains both prior registered fingerprints and adds the independently verified current debug fingerprint plus the Google deployment certificate registered for this Firebase Android app. The latter's classification as the current Play App Signing (rather than another Google deployment) certificate still requires authoritative Play verification before a new Play release. No upload key was substituted. No Play Console setting was changed.

## Narrow activation and remaining limits

- Cloud Run revision: `domidex-web-binder-links-20260922`; final Hosting version: `e98d1a93db31e8fa` (runtime version `f95a923de43e9704`). All 152 pre-existing Hosting files and 27 checked main frontend assets are unchanged. Hosting's AUTO association was overriding the runtime, so it is now NONE with an explicit Android association and byte-preserved empty Apple associations (three added static files). Existing server runtime is layered by exact digest; only sharing routes, Android association and one account-deletion inventory entry are added.
- Android sharing starts a separate owner-and-binder-scoped priority chain using the existing CollectionSyncWorker followed by PrivateBinderSyncWorker. Only that binder's referenced pending cards, binder and placements are selected. Existing ACK/revision/conflict handling is unchanged. API 31+ uses expedited work with quota fallback, earlier APIs use ordinary work without delay. No global binder pull is added; large batches continue scoped. Link publication still waits for acknowledged data and may time out honestly after 30 seconds on slow/offline/large sync.
- Live Firestore rules were minimally extended from the exact previous live source: owner-only accountAccess GET and optional validated Holo fields on existing placement writes. No broad local rules/deletion/auth rewrite was deployed. Shares remain server-only.
- Live synthetic-user checks cover creation, precise two-page card identity, privacy defaults, foreign/anonymous denial, explicit options and revocation/access loss. Fixtures are removed. A reference-catalog miss occurred once; a repeated complete candidate run passed. Catalog availability and large-binder load remain external/remaining limits, not guaranteed instant rendering.
- Physical Xiaomi testing remains with the operator. No Play release, signing change, real collection publication or real-device installation is performed by this run. Operator review of use/retention wording remains a manual legal point, not a technical certification.
