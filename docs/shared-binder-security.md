# Read-only binder sharing — local, deployment gated

No shares are automatically created. Production remains disabled unless the operator later sets `BINDER_SHARING_READY=verified-v1` after complete security and cross-device visual verification. This run does not set the flag or deploy.

## Owner API integration

- `POST /api/binder-shares` with Firebase bearer token and `{ binderId, confirm: true, showPrices: false, showTotal: false, showDisplayName: false, displayName? }`.
- Response 201: `{ shareId, path, createdAt, options }`. Construct URL using the production site origin. Copying the link is an explicit user action. The raw token is returned only once and never stored.
- `GET /api/binder-shares?binderId=…` lists the owner's active shares (no raw tokens or owner identifiers).
- `DELETE /api/binder-shares` with owner bearer token and `{ shareId, confirm: true }` revokes the selected share.
- All flags default false. Display name requires an explicit non-email value. Every action requires current server-verified app access and matching ownership. Creating a share for someone else's binder, even as admin, is not supported.

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

## Deliberately incomplete / activation blockers

- Owner UI and Android deep-link integration are not yet connected.
- The standalone viewer has dedicated card large view, native modal focus/Escape handling and local pointer tilt with reduced-motion support. It does **not** fake Android Holo shaders. Exact cover/Holo parity must be integrated/visually verified using the DTO's allowlisted `coverStyle`, `holoEffectId`, `holoIntensity` before enabling the feature.
- Live IAM/hosting and cross-device/large-binder load testing remain pending; no claim of production readiness.
- New shared use/retention/privacy wording requires operator review before activation. Do not silently enable sharing via existing consent.
