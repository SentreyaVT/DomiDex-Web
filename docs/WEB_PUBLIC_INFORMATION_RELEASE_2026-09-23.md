# Public information refresh — 2026-09-23

Published to https://domidex.web.app after source review, isolated preview and
browser verification. The existing design and application behavior are retained.

- Hosting version: `f6dd602dc4a4ead9`; previous: `5e5efe92cf3b7e97`.
- Revision: `domidex-web-public-copy-20260923`.
- Image: `sha256:9a9a4f885c489130d65fa51db71516392c84db7f8d81d7bfdfba9d384b0586de`.
- Cloud Build: `e2a227ca-ed51-4a2a-8b14-02c082bb0761`, SUCCESS.

## Published scope

Public copy now describes the closed Alpha, private tester onboarding, current
Android/Web access, voluntary binder sharing, card previews, synchronization
and incomplete price coverage. The permanent Discord invite remains current.
Three update entries, six roadmap entries and 13 FAQ answers explain the present
state; Build 17 remains explicitly historical and no current Play build is
invented. Empty build suffixes are hidden.

Exactly two collector onboarding string literals changed. Other collector
code and behavior are byte-preserved; its HTML only references the refreshed
asset filename. All CSS is unchanged. The five legal pages receive reviewed
phase/date labels and copy, with the factual binder-sharing privacy disclosure
added. The existing `/pre-beta` URL remains valid with updated title/description.

The `currentSiteContent` normalization adjustment is source-only: the live
`siteContent/public` document is absent and the previous deployed hook/API has
no such normalizer. Updating the shared compiled defaults supplies the current
public content without introducing new runtime normalization logic.

## Verification and boundaries

- Root validation: 59 focused tests, TypeScript and production build passed.
- Eight independent source/client/SSR render-parity checks; all 33 packaged
  JavaScript files pass syntax validation.
- Exact two-literal collector comparison and identical CSS hashes verified.
- Runtime candidate: 38 checks; complete Hosting preview: 43 checks.
- Browser review: homepage design/current copy, FAQ interaction, privacy date
  and sharing disclosure, and retained `/pre-beta` route passed.
- Production: all 43 targeted HTTP/content/asset/CSS/protected-route checks
  passed after promotion of the exact finalized preview version, without rebuild.
- Live browser confirmation: closed-Alpha phase, binder-sharing highlight,
  30-year-set price caveat, permanent invite and private tester-ticket guidance
  are correct; the final browser tab remains on production.

150 of 155 Hosting file hashes remain unchanged; only the five legal HTML files
changed. Prior hashed assets and the previous production revision remain
available. Runtime configuration, environment, IAM and previous traffic targets
were rechecked and preserved. No auth, Firestore/Storage rules, account, sharing
logic, collection data, billing, Android or unrelated dirty-source changes were
deployed. No Git commit or push was made.

Immutable baselines, reviewed mappings, packaging and activation scripts, and
all verification evidence are retained in ignored
`.domidex/public-copy-20260923/`.
