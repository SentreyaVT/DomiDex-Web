# Read-only binder sharing — local, deployment gated

No shares are automatically created. Production remains disabled unless the operator later sets `BINDER_SHARING_READY=verified-v1` after complete security and cross-device visual verification. This run does not set the flag or deploy.

## Owner API integration

- `POST /api/binder-shares` with Firebase bearer token and `{ binderId, confirm: true, showPrices: false, showTotal: false, showDisplayName: false, displayName? }`.
- Response 201: `{ shareId, path, createdAt, options }`. Construct URL using the production site origin. Copying the link is an explicit user action. The raw token is returned only once and never stored.
- `GET /api/binder-shares?binderId=…` lists the owner's active shares (no raw tokens or owner identifiers).
- `GET /api/binder-shares` lists only the authenticated owner's private binder IDs, names and canonical cover IDs; no collection documents, notes or ownership UIDs. The gated owner component is integrated into the existing Binder view, including when no set binder exists.
- `DELETE /api/binder-shares` with owner bearer token and `{ shareId, confirm: true }` revokes the selected share.
- All flags default false. Display name requires an explicit non-email value. Every action requires current server-verified app access and matching ownership. Creating a share for someone else's binder, even as admin, is not supported.
- The owner UI requires an unchecked-by-default sharing confirmation, keeps the three independent optional fields OFF, displays/copies a new token only on explicit request, and never persists it locally. Revoke is a two-step confirmation. Account/binder change clears owner data and ignores stale requests. A failed/ambiguous create requires refreshing active shares before another attempt. Requests are bounded to 15 seconds.

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
- Android currently has no App-Link/Deep-Link infrastructure beyond MAIN/LAUNCHER. The HTTPS `/share/{token}` web view is therefore the existing safe cross-device fallback; no second native sharing stack is introduced. A native app-link is not a prerequisite for this browser-based release.

## Activation blockers

- Live IAM/hosting and cross-device/large-binder load testing remain pending; no claim of production readiness.
- New shared use/retention/privacy wording requires operator review before activation. Do not silently enable sharing via existing consent.
