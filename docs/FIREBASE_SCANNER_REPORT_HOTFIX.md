# Firebase scanner-report hotfix — 2026-09-03

The standard Docker source rebuild lost the stylesheet references in rendered HTML even though the source CSS was unchanged. Do not repeat that release path without checking the rendered stylesheet references, JavaScript references and asset responses first. HTTP 200 alone is not a design check.

The recovered release preserves all 147 files from the verified Hosting version `436c09e053eed102` byte-for-byte. Its server is derived from the verified `firebase-admin-only-20260903` image, not a new frontend build. Only the compiled Firestore write helper is patched; its source equivalent is `lib/server/firestore-rest.ts`.

- Build definition: `cloudbuild.scanner-report-patch.yaml` and `Dockerfile.scanner-report-patch`.
- Guarded patch: `scripts/patch-cloud-run-scanner-report.mjs` refuses an unknown helper shape and checks all three create-only argument cases before writing. (Originally `.cjs`; now ESM with identical patch behavior.)
- Recovered Hosting version: `9e7db3d70e70189f`.
- Recovered Cloud Run revision: `domidex-web-00019-niw`.
- Hosting rewrite tag: `scanner-report-ui-fix-20260903` (fixed revision).
- Verified live: `/`, `/app`, `/admin/scanner-lab` load the original stylesheet bytes; anonymous report API requests remain rejected.

For this recovery the existing Hosting version was cloned and only the Cloud Run rewrite tag changed. Do not deploy the independently rebuilt local `dist/client` over these assets. A future source rebuild must pass the full runtime/asset checks before promotion. Firebase rules, account claims and user data were not changed. A new authenticated phone upload still needs an end-to-end confirmation.

## Scanner publication guard — 2026-09-03, 21:40 UTC

Explicitly approved publication of the narrowly scoped Scanner Lab correction:

- Live Hosting version: `cfc2f42c812ba83a`, cloned from `9e7db3d70e70189f`.
- All 147 existing Hosting file paths and hashes verified unchanged.
- Pinned Cloud Run tag: `scanner-publication-guard-20260903`, revision `domidex-web-00021-ruy`.
- Image digest: `sha256:1499f7b1aaddbd7f78457d9073f60a1fd77004200f818a36f7b0332809e932e3`.
- Base image: the existing recovered runtime, `sha256:9ac06cf639ce1e31b23b4442998cb668c80c401089e7e8a536620b4ad5c48da0`.
- Build: `6c41128c-6836-40de-907b-4df51a34f0c2`.

`scripts/patch-cloud-run-scanner-publication.mjs` checks the exact original hashes before applying the reviewed source-equivalent changes. It tests the compiled server route and client/SSR action handlers with isolated mock data. Only the publication restriction and its UI explanation change; draft and review persistence remain separate. Five affected/importing client chunks receive new cache-busted names, with matching runtime manifests. New assets are served by the pinned runtime; existing Hosting assets remain intact. No unrelated dirty source files were rebuilt or published. (Utility subsequently migrated from `.cjs` to ESM.)

`scripts/verify-scanner-publication.mjs` passed on both the zero-traffic candidate URL and the final public `https://domidex.web.app` URL: `/`, `/app`, `/admin/scanner-lab` return HTML 200 with original CSS references and the new bootstrap; 29 assets match the expected bytes; anonymous profile/report reads and profile publication remain rejected. All changed JavaScript files passed syntax checks. The source patch previously passed 19 focused tests, typecheck and build.

This does **not** connect a benchmark engine or prove a new authenticated phone upload. It prevents publishing/rolling back scanner profiles through this API while no trusted benchmark runner exists. No production scanner profile, manifest, Firebase rule, account claim or user data was modified by this deployment. The prior Hosting release and runtime remain available for recovery.
