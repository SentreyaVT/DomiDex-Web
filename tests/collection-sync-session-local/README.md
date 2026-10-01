# Collection/private-worker session proof — local only

The combined seven-case expansion was verified locally on 2026-10-01. Exact
evidence and input hashes are below; dated earlier results apply only to their
own pinned inputs.

This reuses the existing launcher, actual named Google SDK clients, isolated in-memory Room and production worker functions. It is not a Web-product test, a new sync protocol, WorkManager-delivery proof, production deployment or physical-device test. No product code or Rules change is required by this harness expansion.

## Prerequisites and run

- Windows; preinstalled Node 24+, Java 21+, reviewed Firebase CLI 15.28.2, SHA-verified cached emulator JARs. No downloads.
- Exactly `emulator-5554` / `DomiDex_R27_Baseline_API36`, airplane mode on, Wi-Fi off and no active Android network. Debuggable emulator hardware and fixed demo-only gRPC guard are checked in Android.
- Root builds/installs current debug/test APKs and independently verifies their installed hashes. Launcher hashes prove the local files, not their installed identity. Launcher never builds, installs or signs.
- No active instrumentation or existing ADB reverse mappings; all fixed ports free. Unknown state fails closed, no unrelated process/package force-stop.
- Existing isolated-environment, network-preload, cache-verification and owned child-process helpers remain unchanged. Android/Web Rules must remain byte-identical. Only new local Auth9097 and Firestore8187 emulators run under fixed `demo-domidex-privacy`; no default Firebase app/account or production credentials.

After Root-owned APK preparation, from the Web project:

```powershell
node --test tests/collection-sync-session-local/validation.test.mjs
node tests/collection-sync-session-local/run.mjs --android-root C:/Users/Dominik/AndroidStudioProjects/CardVault
```

Allowed preinstalled path overrides are `--firebase-cli`, `--java-home`, `--emulator-cache`. Project, ports, serial, account list, method registry and run-ID shape are fixed. New run IDs are lowercase 32-hex. Pure validator tests are not SDK evidence.

## Exact fixtures and seven methods

Host requires entirely empty Auth/Firestore emulators. It imports exactly eight nominal Google users: the seven `SCENARIOS` owners in `contract.mjs` plus `sdk-proof-collection-other`. Each uses `<uid>@example.invalid`, verified email, Google provider UID `<uid>-google`, and only `{appAccess:true}`. No account-access override or admin claim.

Class remains `com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest`. Existing arguments remain `domidexCollectionSessionProof=demo-loopback-only` and `domidexCollectionSessionRunId=<32hex>`.

1. `healthyCollectionPushAcknowledgesAndRereads`: actual collection worker creates/ACKs/rereads revision1; fresh pass is idempotent. No Admin seed.
2. `staleSessionCannotAcknowledgeCommittedMutation`: real Commit held across observed Auth A→B→A; independent control SDK proves actual remote commit before checking no stale Room ACK. Fresh actual pass converges idempotently. No Admin seed.
3. `missingRereadRetainsCheckpoint`: actual remote absence; synthetic CLEAN1/PENDING0 resumed checkpoint survives two actual worker retries. Missing-owner data and references remain absent.
4. `malformedRereadRetainsCheckpoint`: just-in-time Admin seed is the complete normal revision1 payload **without name**. Successful control SDK read and real decoder rejection precede the synthetic resumed checkpoint. Two retries preserve Room/outbox and the exact remote seed.
5. `confirmedRereadCompletesCheckpoint`: just-in-time full valid revision1 Admin seed; actual worker reread completes the synthetic checkpoint, then a fresh pass stays idempotent. Exact seed and timestamp remain unchanged.
6. `pendingOverlayRereadRetainsCheckpointUntilActualAck`: just-in-time valid revision1 Admin seed. Android starts from an explicit synthetic CLEAN1/PENDING0 resume fixture. Subject optimistic `set` is held before outgoing Write transmission. Real `Source.SERVER` must be existing/noncache/**pending**, and the actual production decoder must succeed. Two actual collection-worker passes retry with the entire Room snapshot unchanged; control SDK still sees revision1. After release, a real Rules-authorized ACK creates revision2 and a fresh worker converges. Exactly revision, mutation ID, quantity3, notes, client timestamp1700000000001 and actual server timestamp differ. Parent identity/remaining fields stay exact. A further fresh pass stays idempotent.
7. `lateParentPlacementIsRecoveredWithoutRemoteRewrite`: just-in-time Admin seeds two binders and one structurally valid **orphan** placement, never its Collection parent. Normal Rules do not allow creating this orphan as a client; this deliberately represents pre-existing legacy/admin state, not a legal client-creation race. Fresh Room has no Collection/catalog/outbox fixture. First actual private-worker pass applies both binders, creates no dummy parent/placement and schedules no hot continuation. The independent nominal Google SDK client then really creates the missing parent under unchanged Rules. Second actual private-worker pass applies the same untouched placement revision1, exact slot/holo/identity, and real parent. Neither test cursor edits nor direct local apply are used. All three Admin seeds stay entirely unchanged.

The first two cases require real Android-created worker commits. The four resumed-checkpoint cases do **not** claim the prior ACK was actually performed. The late-parent case calls two real worker passes explicitly; it does not prove when WorkManager would schedule the second pass. An actual outer subject Auth lease checks no observed token/account transition across its two passes; each product pass still owns its normal internal lease.

## Independent complete-tree evidence

Before **every** method, Admin captures the complete small database tree plus all eight Auth accounts. For seeded methods it first uses create-only writes, reads back and validates each exact fixture, then records the complete preflight. No filter drops unknown documents.

Each preflight must equal the previous method's complete final state plus exactly this method's allowed seeds. Healthy/stale remain unseeded; missing remains absent. Pending-overlay must still be revision1. Late-parent must have exactly two binders/one placement and **no Collection parent**. Earlier owners, exact fields/timestamps and accounts must remain unchanged.

After every Android method, **even upon FAIL**, Admin again captures the full tree and accounts. Validation requires exact collection paths, document references, every existing document and every field. Final pending-overlay must be the agreed revision2 with timestamp not before its seed; all other Admin seeds are fully immutable. Late-parent gains only the expected nominal-client-created Collection entry. All prior owners, missing/unrelated-owner absence, claims/providers and absence of access overrides/extra sidecars remain checked.

Raw preflights/readbacks are saved before validation. A server commit alone, including pending-overlay revision2 or the late parent, never makes a failed Android method pass. The intermediate held-write/first-private-pass evidence is Android control SDK + Room assertions; Admin independently samples **before and after** each method, not between the two internal worker passes.

## Fail-closed completion, scope and cleanup

- Exactly seven START/PASS pairs, each `numtests=1`, `OK (1 test)` and one final instrumentation code; duplicate/skip/assumption/missing/partial/failure status fails.
- Each host invocation retains its 180-second bound and the unchanged launcher keeps an overall 18-minute budget. A slow case can exhaust the total budget; no timeout is converted to success.
- Existing `run.mjs` is unchanged: it already hashes the entire product Kotlin source set, the existing SDK class/gate, APK inputs and all five host files (including this README). There is no new source file or manifest list entry needed after promotion.
- Original Android bounds: setup60s / test120s / Task20s / held-gate15s. Late-parent adds 45s per real worker pass and control queries limit8. Actual product FULL queries retain limit200 / logical budget1000. This small fixture does not instrument total RPC/read billing or establish scale.
- Android attempts every owned-resource cleanup: gate cancellation/restoration, named Firestore termination, named Auth sign-out/app deletion and in-memory Room close. PASS includes successful teardown. RED alone does not independently prove cleanup.
- Host checks instrumentation idle before/after cases/exit. It never starts a case over uncertain live instrumentation, force-stops packages on timeout, resets a shared emulator or deletes user databases.
- Only owned unchanged reverse mappings are removed; afterward require free ports, empty mappings, idle instrumentation and unchanged input hashes. Process cleanup remains the reviewed owned child-process mechanism, not name/port killing.
- Admin cleanup errors fail the proof. No pending-overlay write is released on Android failure merely to make cleanup succeed.
- No safeDelta/bootstrap activation, historical timestamp validation, delta-overlay completeness, hard-delete repair, UI/WorkManager delivery, distributed lock, multi-device scale or performance SLA follows.

Evidence belongs to `outputs/collection-sync-session-local/<timestamp>-<runId>/`:
manifest, complete server-proof, per-method logs and emulator log. Source alone is
not evidence that a later build or environment passed.

## Seven-case Root verification on 2026-10-01

**7/7 actual SDK cases PASS**, 15.317 s summed instrumentation time, 51.187 s
complete harness. Seven full independent Admin preflights and seven final
readbacks pass; eight nominal accounts, all prior-owner payloads and exact seed
timestamps remain checked. Pending-overlay and late-parent behavior passed without
any product or Rules change. No new failing-before product regression is claimed.

Evidence: `outputs/collection-sync-session-local/2026-10-01T18-53-04-230Z-52fcb2bc3e124af5be3ea075fe3cd920/`.
Manifest confirms exit 0, verified server proof, free ports, empty reverse
mappings, idle instrumentation and unchanged source/APK inputs. Ten pure harness
validators and focused lint pass separately; they are not ten extra SDK cases.

Installed identities were independently verified by Android
`artifacts/release27-engineering-20261001/collection-session-room-185032-bbcdb47a/manifest.json`:
app `b85d6a5bb0a90fbef91ecadb88c913b2a4e9282027311a8907f91b8111931cf4`,
test `a7bb873e80a044fe5b608ede46a1091fcee48987b637575ee603caf207866df9`.
That same install also passes 11 real Room session-commit regressions with inputs
unchanged. No signing, release bundle, deployment, production data or Xiaomi use.


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
