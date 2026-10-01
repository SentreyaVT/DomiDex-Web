# Collection worker session proof — local only

Five opt-in Android SDK regressions exercise the actual collection-worker pass with named Firebase clients and isolated in-memory Room: two actual-commit session cases and three resumed-checkpoint reread cases. This folder is a host launcher and independent Admin verifier, **not** a Web-product test. It changes no product code, old harness, production Firebase, account rights, release/signing setup or physical device.

## Prerequisites and run

- Windows with preinstalled Node 24+, Java 21+, reviewed Firebase CLI 15.28.2 and SHA-verified cached emulator JARs. Nothing is downloaded.
- Exactly `emulator-5554`, AVD `DomiDex_R27_Baseline_API36`, airplane mode on and Wi-Fi off. Android additionally requires debug mode, emulator hardware, no active network and a demo-project-only gRPC gate.
- The operator builds/installs current debug APKs and independently verifies the installed hashes. The launcher records hashes of local APK/source inputs before and after, **not** proof of the installed APK identity. It never builds or installs.
- No active instrumentation, no existing ADB reverse mappings, and all fixed emulator ports free. Unknown state fails closed. No unrelated process or package is force-stopped.
- Android/Web Firestore and Storage rules must be byte-identical. Existing isolated-environment, network-preload, cache-verification and owned child-process helpers are reused unchanged. Only fresh local Auth (9097) and Firestore (8187) emulators start, under fixed `demo-domidex-privacy`.

Run from the Web project, sequentially and only after operator-owned APK preparation:

```powershell
node tests/collection-sync-session-local/run.mjs --android-root C:/Users/Dominik/AndroidStudioProjects/CardVault
```

Optional preinstalled path overrides: `--firebase-cli`, `--java-home`, `--emulator-cache`. There are no account, project, port, serial or run-ID overrides. A new lowercase 32-hex run ID is generated for each run.

Pure validator tests, which do not establish SDK coverage:

```powershell
node --test tests/collection-sync-session-local/validation.test.mjs
```

## Actual product cases and server evidence

Host requires empty Auth and Firestore emulators. It imports exactly six nominal Google users: `sdk-proof-collection-healthy`, `sdk-proof-collection-stale`, `sdk-proof-collection-missing`, `sdk-proof-collection-malformed`, `sdk-proof-collection-confirmed`, and `sdk-proof-collection-other`, with `<uid>@example.invalid`, provider UID `<uid>-google`, verified email and only `{appAccess:true}`. No access override is seeded. No documents are seeded for healthy, stale, missing or other owners.

Each method receives `domidexCollectionSessionProof=demo-loopback-only` and `domidexCollectionSessionRunId=<32hex>`. Class: `com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest`.

1. `healthyCollectionPushAcknowledgesAndRereads`: genuine collection worker pushes one pending Room mutation, acknowledges and rereads it. Room must be CLEAN/revision 1 with no outbox. A second genuine worker pass must leave every remote field, including server timestamp and mutation ID, unchanged.
2. `staleSessionCannotAcknowledgeCommittedMutation`: the gRPC gate holds a genuine unsent CommitRequest. Auth observes A→B→A while this worker is suspended, then the gate releases the real commit. A separate named control SDK reads and verifies the complete server document before asserting that the old worker did not modify **any** captured Room rows. The stale run must retry, without scheduling continuation. A fresh genuine worker retries the same mutation, acknowledges and rereads it idempotently; the server remains field-for-field revision 1.
3. `missingRereadRetainsCheckpoint`: the remote document genuinely does not exist. A synthetic local CLEAN/revision-1 entry plus PENDING/expected-revision-0 outbox models an interrupted acknowledged-write reread. Two fresh real worker passes must retry and leave the entire captured Room state, including the checkpoint, unchanged.
4. `malformedRereadRetainsCheckpoint`: immediately before this method, Admin creates a complete revision-1 fixture **without the `name` field**, with an actual server timestamp. Android proves a successful, non-cached, non-pending control read and actual decoder rejection before constructing the same resumed-checkpoint fixture. Both worker passes must retain it and retry, without rewriting the malformed server document.
5. `confirmedRereadCompletesCheckpoint`: immediately before this method, Admin creates the full valid revision-1 fixture with an actual server timestamp. The same resumed-checkpoint fixture must finish its reread and remove the outbox, preserve CLEAN/revision 1, and leave the server unchanged through another fresh worker pass.

Remote paths are `users/<scenario-owner>/collectionEntries/entry`; mutation IDs are `collection-session-<runId>-<healthy|stale|missing|malformed|confirmed>`. All fixture fields are exact in `contract.mjs`; only the actual server timestamp is dynamic and must be a valid timestamp. The original healthy/stale cases still require genuine Android-created transactions, never fake ACKs or seeded server documents. The three new cases explicitly start from **resumed-checkpoint fixtures**, not evidence that Android previously performed their ACK. Missing-owner data must remain absent, including parent references.

After **each** method, even after an Android failure, Admin reads the complete small emulator document tree and all six Auth users. Full payloads, account/provider/claim identity, collection/document paths, absent missing/unrelated-owner data and absence of access/sidecar writes are validated. Every earlier owner's document must stay exactly unchanged through later cases. Each Admin seed is read back before its Android method, saved in `server-proof.json`, and compared field-for-field (including server timestamp) with subsequent readbacks. Raw readbacks are saved before validation, so a RED run retains useful independent evidence.

The Android control SDK verifies the intermediate committed state and fresh idempotent state inside the stale method. Host Admin independently verifies final state after the method; it does not claim to have independently sampled that intermediate pause.

Expected baseline RED is specifically `STALE_SESSION_ACKED_COMMITTED_MUTATION`, after the independent SDK server read. A timeout, absent remote commit, authentication error, ignored test or cleanup failure is **not** that counterexample. All failures still produce a failing run; this launcher never converts expected RED into success.

For missing/malformed rereads, the targeted RED assertion is `UNCONFIRMED_REREAD_DISCARDED_CHECKPOINT`, only after genuine successful server-read/decoder preconditions. A permission or transport failure is not the intended counterexample. Host readbacks alone cannot prove a local checkpoint survived; exact Android PASS is also required. Dated execution results below apply only to their pinned inputs.

## Fail-closed completion and cleanup

- All five exact methods must each report START then PASS once, mandatory `numtests=1`, `OK (1 test)`, and one final instrumentation code. Missing/duplicate/ignored/assumption/partial statuses fail. Each method has a 180-second host timeout; the owned emulator driver has an 18-minute total bound for all five cases and startup/cleanup.
- Android owns only in-memory Room and uniquely named Firebase clients; its `@After` attempts gate cancellation/restoration, Firestore termination, Auth sign-out, app deletion and Room close. A passing method includes successful `@After`. A RED alone does **not** independently prove cleanup; no extra cleanup method or synthetic status is counted as evidence.
- The host checks instrumentation idle before/after cases and at exit. On timeout it does not force-stop the app, start another case over live instrumentation, delete user data or touch the default Firebase app.
- Only this run's exact reverse mappings are removed, never an altered target; free ports, empty mappings, idle instrumentation and unchanged input hashes are checked afterward. Emulator process cleanup belongs to the reviewed launcher child-process mechanism, not a port/name kill.
- Admin termination/app deletion errors also fail the proof. Missing or failed server evidence can never yield a passing manifest.

Evidence is under `outputs/collection-sync-session-local/<timestamp>-<runId>/`: `manifest.json`, `server-proof.json`, per-method instrumentation logs and `emulator.log`. No execution result is implied by these files' source code. This proves the shared collection-worker function, not WorkManager scheduling, production performance, every Room final-commit race or a deployment.

## Historical two-case Root verification on 2026-10-01

The unchanged-UID baseline genuinely reproduced the stale completion: healthy control PASS,
stale case FAIL specifically at `STALE_SESSION_ACKED_COMMITTED_MUTATION`, after the held
real Commit and independent SDK server read. Admin confirmed both full payloads; the
failure correctly remains a failing run. Evidence:
`outputs/collection-sync-session-local/2026-10-01T15-38-16-631Z-a13618ea118c412681b31406f33eb4c1/`.

After the Android session/final-commit correction, **2/2 actual SDK cases PASS** including
fresh idempotent retry with unchanged server revision and timestamp. Both independent
Admin readbacks pass; exact nominal accounts/claims and unrelated-owner data stay unchanged.
Final ports are free, reverse mappings empty, instrumentation idle and input hashes unchanged.
Evidence: `outputs/collection-sync-session-local/2026-10-01T15-52-48-330Z-442c460bda5b42d5b54b8c346ddf5ba8/`.

The separately confirmed installed APK hashes come from Android
`artifacts/release27-engineering-20261001/collection-session-room-155215-8b753c30/manifest.json`:
app `854a069cb065e43bc44172e968c2d5e3fa2c4f80e143c0f3063dab987b56ed9a`,
test `e72d5c8e1604dae37a762bdc6ddb4d6353a07db3821c2955edf4e3f78b37c123`.
The six pure validator cases and focused lint also pass. These dated results apply to the
manifest-pinned inputs, not automatically to later APKs or source edits. No production,
Xiaomi, signing, release bundle or deployment was involved.

## Extended five-case verification on 2026-10-01

RED `2026-10-01T16-08-16-317Z-2c0111a4b9854e4b8b70a9713f5f1c94/` (same output parent):
three controls PASS; missing/malformed fail exactly at
`UNCONFIRMED_REREAD_DISCARDED_CHECKPOINT`. All independent server readbacks pass;
the complete run remains correctly failed. After the narrow Android confirmed-read
guard and non-null commit contract, GREEN
`2026-10-01T16-14-27-332Z-2bb445eca6ca4938ad10e6abaa8e2e33/` passes **5/5** with five
independent full Admin readbacks. Exact accounts/claims, absent missing owner,
prior owners and seeded payload/timestamps stay unchanged. Both runs finish with
free ports, empty reverse mappings, idle instrumentation and unchanged inputs.
Seven pure validators and focused lint also pass.

Installed GREEN APK identities are independently confirmed by Android
`artifacts/release27-engineering-20261001/collection-session-room-161337-013e8ad7/manifest.json`:
app `a2d4f35e2ed0882d6f2bbc4dcb7e3a761f6f7c7832b42f6097673eb22170a699`,
test `155424e7a49d534fb45b4288744110137f16f6fc4200e5034e2d283fe034f9df`.
The same install passes 11 real Room regression cases. This does not prove live
latency, WorkManager scheduling, pending-write overlays or every tombstone race.
Permanent malformed server state still needs repair; retaining its checkpoint
is deliberately not silently declaring synchronization finished.
