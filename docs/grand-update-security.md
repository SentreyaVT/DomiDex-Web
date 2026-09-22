# Grand update: security integration

These changes are prepared locally. No production rules, IAM grants, releases or user data were changed.

## One rules contract

`firestore.rules` and `storage.rules` are byte-equivalent to the Android repository copies. They include collection revisions/tombstones, private binders/placements/layouts, explicit app access, private image boundaries, account deletion fences and server-only scanner publication. Deploying either old copy would break this contract; `tests/security-hardening.test.ts` detects local drift.

Existing users with valid custom claims need no data migration. Missing `/accountAccess/{uid}` retains claim-based access. A server-owned `appAccess`, `pretester` or `admin` field allows that role only when absent or exactly `true`. `disabled: true` denies all protected access. Clients can read only their own status document and cannot write it. `pretester` stays independent from `appAccess`; denying one role does not invent or erase the other role.

Role changes first fence the affected role, then update Auth claims under a Firestore lease, revoke refresh tokens on removal and persist a minimal audit entry. Partial failure stays denied and can be retried. Changes made directly in the Firebase console do not remove an existing denial: use the authorized role-management API for regranting access. Web and Android listeners can react to the status document immediately.

## Server deployment prerequisites

Protected routes now verify the current Firebase Auth user, token revocation, account status and role at request time. Scanner profile and report persistence uses the attached server identity after that check, rather than client-authorized Firestore writes. Cloud Run already uses Application Default Credentials for private images and deletion. The same identity needs the existing Auth administration, Firestore data and private Storage access; no broad new owner role is required. Local operation uses explicitly configured Application Default Credentials and `FIREBASE_ADMIN_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`. Missing credentials fail closed with a correlated server error.

Rules and backend should be published as one reviewed deployment, followed by current-role and denied-role smoke checks. Until rules deploy, the new client status listener intentionally does not grant access when `/accountAccess` cannot be read. No deployment was performed in this run.

The production Scanner Lab failure remains pending live verification: the current read-only Cloud credential returned HTTP 403 for the Rules API. A verified local cause candidate is rule divergence: Android rules previously omitted all scanner profile collections, while the profile API forwarded the client token and masked infrastructure errors as HTTP 400. The merged contract and server-authorized persistence remove that failure path; unknown errors now produce HTTP 503 plus a safe correlation ID. Reports and profiles load/retry independently. Production publication remains blocked without a real benchmark integration.

## Account deletion

`/account/delete` and `/api/account/delete` reuse the existing deletion engine. The self-service route never forwards caller-provided target UID/job ID. Explicit confirmation and recent Google reauthentication precede a request. The existing `ACCOUNT_DELETION_READY=verified-v1` gate remains required; it was not enabled or bypassed. Pending, review-required and partial-failure states are not reported as completed. Existing operator processing is still required to advance jobs across provider/token-retention waiting periods; the UI offers the legal deletion contact. Deletion also fences `accountAccess`, removes its status document and redacts access-audit attribution. This does not by itself establish a new scheduled deletion worker.

## Release consistency and headers

All app routes receive CSP, frame denial, MIME protection, referrer policy and a popup-compatible opener policy. Inline script/style allowances are retained for the current framework hydration and existing styles; production eval is denied. Test Google sign-in and private image rendering against the final hosted revision before acceptance.

`scripts/verify-legal-release.mjs` verifies legal route source and the single app Hosting rewrite. The old standalone legal publisher rejects `--publish`; legal pages must ship with the reviewed app revision. No legal assertions were invented.

## Final input/race review

Share and account-deletion JSON bodies are byte-limited while streaming, including chunked uploads. Cookie-only cross-origin share creation is rejected: mutation routes require an explicit Firebase bearer token. Public share routes implement GET only.

Manual report uploads re-check account deletion and role overrides in both Firestore transactions and re-authenticate immediately before final persistence. Revocation during an in-flight upload rejects the final commit and removes the image/operation. Admin-derived tester access is distinguished from an actual pretester claim, so a revoked admin cannot fall through to tester access.

An explicitly malformed admin deletion target (`""`, null, numeric/object, invalid path) now fails with 400 instead of falling back to deletion of the calling account. The self-service route continues to strip all supplied target IDs.

The remaining CommonJS lint findings were resolved through an isolated ESM conversion of the three historical patch utilities and the scan-knowledge backend package, without changing their behavior or disabling lint rules. The deployed service was not changed. Standalone packaging and Firebase trigger export discovery were checked locally. Historical utilities now use `.mjs` filenames; the corresponding Dockerfile reference was updated.

## Local verification

- Web targeted profile/report/Scanner Lab/auth/security suite: 40 passed.
- Auth/Firestore/Storage private operations and rules: 40 passed, including sharing owner/DTO/revocation, in-flight upload revocation and malformed deletion-target boundaries.
- Sharing DTO and read-only viewer tests: 7 passed.
- Android Firebase rules plus shared Android/Web contract: 24 passed.
- Typecheck and scoped lint: passed.
- Private server module packaging: passed.
- Bounded JSON and self-account-deletion boundary: 9 passed.
- Legacy knowledge aggregation tests: 3 passed; utility script syntax, Firebase named trigger export, and packaged private-route imports passed. Full lint now passes without rule suppression.

Run combined Firebase tests sequentially (`--no-file-parallelism`), because cross-service Storage rules resolve Firestore in the emulator's configured project. Ports: Firestore 8080, Storage 9199, Auth 9099. Only local emulators were used for writes.
