# Reproducible local unit regression

```sh
node --test tests/release-local/selection.test.mjs
node --require ./tests/release-local/network-preload.cjs --test tests/release-local/network-preload.test.mjs
npm run test:release-local
```

Use the repository's locked root dependencies and `backend/scan-knowledge` locked
dependencies (needed by the trigger suite). The launcher installs nothing. It runs
the ordinary `test`, `test:rate-limits`, `test:app-check`, `test:owner-snapshots` file
lists plus the explicit supplemental unit suites in `selection.mjs`, deduplicated.
It does not execute package-script shell text. An unexpected command/file format,
missing group, Rules/emulator test or empty selection fails closed.

This replaces the engineering-only launcher that needed an ignored previous JSON
report. It can run from a fresh authorized checkout with dependencies present; no
local test report, credential, `.env` file, build artifact or Firebase account is needed.
No application bundle, release signing, emulator start, deployment or GitHub Action
is triggered. Reports go to ignored `outputs/release-local/` with unique names.

The child has an environment allowlist, `envDir:false`, a Node preload disabling
network transports/DNS and shell/external helpers, and a setup guard for JSDOM.
Node and esbuild child processes remain allowed for Vitest and packaging tests.
These guards are defense in depth for trusted tests, **not an OS sandbox or proof
that arbitrary malicious repository code cannot bypass them**. Test mocks can
replace fetch deliberately. Emulator/Rules, public-cache and concurrent sharing
harnesses remain separate with their own documented boundaries.

Root verification on 2026-10-01: **1,013/1,013 tests in 63 files**, 22.53 s. Ten
selection/environment and two transport/helper-blocking cases also pass. A first launcher invocation failed before
test discovery because Node interpreted quoted Windows backslashes as escapes;
normalizing only the preload path to forward slashes fixed it. The failed log is
preserved, not counted as a product failure or test pass. Latest successful report:
`outputs/release-local/2026-10-01T03-31-03-587Z-17940.{json,log}`.

Existing React-act/JSDOM-canvas warnings remain visible. Unit results do not establish
browser visual correctness, real Firebase authentication, cross-client end-to-end
convergence, scanner/device behavior or production performance.

The later Gate-10 selection additionally includes the real account-deletion status
component and public technical-information tests. Its initial run reproduced four
missing status/reader descriptions; after the narrow text fixes all **1,031 tests
in 65 files** pass. That does not close the separate account-switch UI audit.
Report: `outputs/release-local/2026-10-01T03-37-40-496Z-14648.{json,log}`.

The account-switch follow-up is now included: 19 session cases cover pending and
not-yet-started actions, SDK A→B→A before a React commit, same-UID refresh, uncheck,
unmount and late responses. Independent review found the pre-request consent race;
the synchronous consent-generation check closes it. Root rerun: **1,050/1,050 in
66 files, 33.73 s**, `outputs/release-local/2026-10-01T03-46-31-932Z-16420.{json,log}`.
These are mocked auth/backend boundaries, not a live account deletion.
