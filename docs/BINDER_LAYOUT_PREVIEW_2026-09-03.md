# Binder layout correction — approved and published

The user required screenshot approval before publication. The preview was delivered, then the user approved installation on 2026-09-04. **Published after that approval.**

## Scope

- `components/web-app.tsx`: remove the extra animated `TurningPage`, its snapshot state and animation-end navigation lock. Existing page boundaries, slot identities, card dialogs and collection operations remain unchanged. Export the existing `BinderView` for direct UI tests.
- `app/globals.css`: append rules scoped exclusively to `.binder-view`. Constrain page rows/columns and pocket minimum dimensions, contain card images with padding, remove binder entry and pocket hover movement. Narrow layouts retain stacked pages with bounded aspect ratios. No homepage selectors or existing styles were replaced.
- `tests/binder.test.ts`: retain six existing slot/variant tests; add three component tests for immediate navigation, last-page empty pockets, exact card selection and reopening.

## Verification

- Nine focused tests passed; typecheck, targeted lint and production build passed.
- Actual WebApp/BinderView rendered in an ignored, loopback-only Vite harness under `.domidex/binder-preview` with local example ownership and real public Prismatische Entwicklungen card data/images. Auth and collection writes are mocked/disabled; no production account or collection was changed.
- Desktop 1920×1080: book 1000×510, all eight pockets inside its bounds, images loaded, no turning overlay, animation name `none`.
- Next/previous pages switch immediately (1 → 2 → 1), without an animation event.
- Narrow 390×844 viewport: all eight pockets remain inside the stacked binder, no horizontal document overflow.
- Screenshot: `outputs/binder-preview/binder-desktop-1920x1080.jpg` (actual browser JPEG; local example collection, not a production-account screenshot).

## Publication — 2026-09-04 (Europe/Berlin)

- Hosting release: `32e15e89a65fc4d7`, cloned from `cfc2f42c812ba83a`; all 147 existing Hosting file paths/hashes verified unchanged.
- Pinned Cloud Run tag: `binder-layout-20260904`, revision `domidex-web-00022-fuh`.
- Image digest: `sha256:0349e96b746dcd544f50a14b74e148d58d7e48b1dc2b7207ed84b6e0aae9ad67`.
- Cloud Build: `28d10440-b711-40d4-8d8e-05002860f486` (successful).
- Exact base: existing scanner-guard image `sha256:1499f7b1aaddbd7f78457d9073f60a1fd77004200f818a36f7b0332809e932e3`.
- `scripts/patch-cloud-run-binder-layout.cjs` checks original hashes, changes only BinderView/TurningPage in client and SSR, and verifies both compiled components' navigation/selection. All other component function bytes are retained. Original stylesheet bytes are retained with only the approved `.binder-view` suffix appended. Changed assets/importers are cache-busted with consistent manifests.
- Unrelated dirty authentication/WebApp changes were not published. Scanner guard, Firebase rules, claims, collection data, and backend routes were not modified.
- Nine source tests and typecheck passed again. All changed JavaScript syntax checks passed.
- `scripts/verify-binder-layout.mjs` passed against both zero-traffic candidate and final `https://domidex.web.app`: three routes render, 33 assets match exact expected bytes, anonymous admin access remains blocked. Landing-page HTML is byte-identical to the preceding release after normalizing only renamed asset references; original CSS bytes are preserved.
- Authenticated visual geometry was already checked in the local screenshot harness; no production user collection was modified for this deployment.
- Previous Hosting version and runtime remain available for recovery. Do not use a broad source rebuild for a future deployment without the runtime/asset checks in `FIREBASE_SCANNER_REPORT_HOTFIX.md`.
