# Collection/private-worker session proof — local only

Current sixteen-case checkpoint: Root independently passes **16/16**, 2026-10-03,
162.627s total harness, malformed case1.550s/final1001 case18.941s. All16 complete
Admin preflights/readbacks and17 accounts, exact earlier owners, source hashes,
fixture cleanup, AVD/offline identity, free ports, empty reverses and inactive
instrumentation pass. Evidence: `outputs/collection-sync-session-local/`
`2026-10-03T14-07-04-463Z-f38f2ef6eda446699f9b9ba8104ce096/manifest.json`.
App SHA256 `5158a6556bfea004ff81f6599b18f70674ba74bec73718da65de6420a1fe7ab3`;
test `b5f919749f06a380a16cedaadb896faf8692f7558e662e1622bfd011cad74b22`.
Root verified installed hashes before/after only on owned5556; the ordinary5554
installation and physical devices remain untouched. Android receipt is under
`artifacts/release27-engineering-20261003/g9-current-sdk-review/`.32 pure validators
and focused lint pass separately. Existing CLI deprecation/blocked metadata-lookup
warnings remain. This is not a production, host-wide no-egress or whole-G9 PASS.
The historical checkpoints below retain their original scope and APK identity.

Historical verified extension: the registry then contained fifteen methods, with
the knowledge listener/Auth case immediately before the final 1001-binder method.
Root result **15/15 PASS**, 2026-10-02, 139.382s complete harness; knowledge case
1.294s and final budget case14.710s. Independent complete preflight/readback for
all15 methods and all16 accounts, cleanup, free ports, empty reverse mappings and
frozen inputs pass. Evidence: `outputs/collection-sync-session-local/`
`2026-10-02T13-17-53-019Z-705ccc68641040b7a510cdc6d836b152/manifest.json`.
App SHA256 `09cdad1dfafd62f37f482cf2d63a7c287009b074f0dd8ba2402a531e1a864633`;
test APK `1c17553d33e41edd2a5c0e05b4ef0eefbf3cbfc22858fb3e2d25ecf9099a94fe`.
Root's separate installed-file receipt is in Android's ignored dated engineering
`knowledge-listener-review/installed-apks.json`. The26 pure validators and focused
lint also pass. An earlier operator-aborted run with the old test APK is retained
as **not PASS** (`d4d5f88b...`); it is not an Android product failure.
The dated receipts below remain historical and are not relabelled as15-case runs.

Earlier additive proof: **13/13 actual SDK cases PASS**, 2026-10-02 local time,
`outputs/collection-sync-session-local/2026-10-01T23-24-15-174Z-448b17e0ba034f5796a0336a0290f8f0/`.
Complete harness 100.475 s; thirteenth case 6.726 s. All thirteen full preflight/
readbacks, fourteen nominal accounts, exact previous owner payloads, free ports,
empty reverse mappings, idle instrumentation and frozen inputs pass. 18 pure
validators and focused oxlint pass separately. Product APK unchanged
`64d40b75180873a339413460b5af1455a32c32ac24096577777d3a725ec822d3`;
test APK `7d45119d587f8d97f86c896e03662e608aecba3a83a8c32b8fd2d91cf915ed25`.
This does not claim OS scheduling, process restart or physical multi-device tests.
The older twelve-case evidence below remains tied to its historical inputs.

All twelve real-SDK cases, including offline private-worker retry across Room
file reopen, were verified locally on 2026-10-02 (UTC run starts 2026-10-01).
Exact evidence and input hashes below apply only to their dated pinned inputs.

This reuses the existing launcher, actual named Google SDK clients, isolated Room and production sync functions. The deferred-marker and offline private-worker cases each own a separate named Room file to prove close/reopen; the other ten cases retain their existing in-memory Room setup. It is not a Web-product test, a new sync protocol, WorkManager-delivery proof, production deployment or physical-device test. The three session-only cases use an internal per-session scheduling recorder; its production adapter preserves all six original scheduling effects. No authorization result, owner predicate, server read or Rules is replaced. The earlier seven-case expansion required no product change.

## Prerequisites and run

- Windows; preinstalled Node 24+, Java 21+, reviewed Firebase CLI 15.28.2, SHA-verified cached emulator JARs. No downloads.
- Under the current isolation plan, pass `--owned-regression-avd` to select exactly `emulator-5556` / `DomiDex_R27_Regression_API36`. API36, qemu hardware, airplane mode on, Wi-Fi off and no active Android default network are mandatory. Root retains the separate fresh-AVD ownership receipt. Omitting the flag preserves the historical `emulator-5554` / `DomiDex_R27_Baseline_API36` default and must not be used while preserving its ordinary installation. No arbitrary device override or fallback is supported. Debuggable emulator hardware and the fixed demo-only gRPC guard remain checked in Android.
- Root builds/installs current debug/test APKs and independently verifies their installed hashes. Launcher hashes prove the local files, not their installed identity. Launcher never builds, installs or signs.
- No active instrumentation or existing ADB reverse mappings; all fixed ports free. Unknown state fails closed, no unrelated process/package force-stop.
- Existing isolated-environment, network-preload, cache-verification and owned child-process helpers remain unchanged. Android/Web Rules must remain byte-identical. Only new local Auth9097 and Firestore8187 emulators run under fixed `demo-domidex-privacy`; no default Firebase app/account or production credentials.

After Root-owned APK preparation, from the Web project:

```powershell
node --test tests/collection-sync-session-local/validation.test.mjs
node tests/collection-sync-session-local/run.mjs --android-root C:/Users/Dominik/AndroidStudioProjects/CardVault --owned-regression-avd
```

Allowed preinstalled path overrides are `--firebase-cli`, `--java-home`, `--emulator-cache`. The sole device option is the fixed boolean `--owned-regression-avd` profile above. Project, ports, account list, method registry and run-ID shape are fixed. New run IDs are lowercase 32-hex. Pure validator tests are not SDK evidence.

## Exact fixtures and sixteen methods

Host requires entirely empty Auth/Firestore emulators. It imports exactly seventeen nominal Google users: the sixteen `SCENARIOS` owners in `contract.mjs` plus `sdk-proof-collection-other`. Each uses `<uid>@example.invalid`, verified email, Google provider UID `<uid>-google`, and only `{appAccess:true}`. No account-access override or admin claim.

Class remains `com.dominik.cardvault.data.sync.CollectionSyncSessionSdkInstrumentedTest`. Existing arguments remain `domidexCollectionSessionProof=demo-loopback-only` and `domidexCollectionSessionRunId=<32hex>`.

1. `healthyCollectionPushAcknowledgesAndRereads`: actual collection worker creates/ACKs/rereads revision1; fresh pass is idempotent. No Admin seed.
2. `staleSessionCannotAcknowledgeCommittedMutation`: real Commit held across observed Auth A→B→A; independent control SDK proves actual remote commit before checking no stale Room ACK. Fresh actual pass converges idempotently. No Admin seed.
3. `missingRereadRetainsCheckpoint`: actual remote absence; synthetic CLEAN1/PENDING0 resumed checkpoint survives two actual worker retries. Missing-owner data and references remain absent.
4. `malformedRereadRetainsCheckpoint`: just-in-time Admin seed is the complete normal revision1 payload **without name**. Successful control SDK read and real decoder rejection precede the synthetic resumed checkpoint. Two retries preserve Room/outbox and the exact remote seed.
5. `confirmedRereadCompletesCheckpoint`: just-in-time full valid revision1 Admin seed; actual worker reread completes the synthetic checkpoint, then a fresh pass stays idempotent. Exact seed and timestamp remain unchanged.
6. `pendingOverlayRereadRetainsCheckpointUntilActualAck`: just-in-time valid revision1 Admin seed. Android starts from an explicit synthetic CLEAN1/PENDING0 resume fixture. Subject optimistic `set` is held before outgoing Write transmission. Real `Source.SERVER` must be existing/noncache/**pending**, and the actual production decoder must succeed. Two actual collection-worker passes retry with the entire Room snapshot unchanged; control SDK still sees revision1. After release, a real Rules-authorized ACK creates revision2 and a fresh worker converges. Exactly revision, mutation ID, quantity3, notes, client timestamp1700000000001 and actual server timestamp differ. Parent identity/remaining fields stay exact. A further fresh pass stays idempotent.
7. `lateParentPlacementIsRecoveredWithoutRemoteRewrite`: just-in-time Admin seeds two binders and one structurally valid **orphan** placement, never its Collection parent. Normal Rules do not allow creating this orphan as a client; this deliberately represents pre-existing legacy/admin state, not a legal client-creation race. Fresh Room has no Collection/catalog/outbox fixture. First actual private-worker pass applies both binders, creates no dummy parent/placement and schedules no hot continuation. The independent nominal Google SDK client then really creates the missing parent under unchanged Rules. Second actual private-worker pass applies the same untouched placement revision1, exact slot/holo/identity, and real parent. Neither test cursor edits nor direct local apply are used. All three Admin seeds stay entirely unchanged.

The first two cases require real Android-created worker commits. The four resumed-checkpoint cases do **not** claim the prior ACK was actually performed. The late-parent case calls two real worker passes explicitly; it does not prove when WorkManager would schedule the second pass. An actual outer subject Auth lease checks no observed token/account transition across its two passes; each product pass still owns its normal internal lease.

## Two additional session-only characterizations

8. `sessionHealthyStartConfirmsAccessWithoutRunningWorkers`: actual named Google
   identity and verified access activate a fresh session and request the existing
   four positive scheduling effects. The recorder executes no worker. The entire
   eight-table local snapshot, exact pending entry/outbox and empty server owner
   stay unchanged.
9. `offlineSessionNeedsExplicitRecheckWithinObservedReconnectWindow`: disable only
   the subject SDK transport before creating its session. A real initial Auth
   event/main-queue fence plus read-only inspection of the actual volatile
   entitlement generation (at least two) distinguish the current failed initial
   check from a stale attempt. After enableNetwork and genuine positive SERVER
   access, observe two seconds without an Auth event or session reactivation.
   Then the same session's explicit requestSync must truly verify access and
   request scheduling. Local entry/outbox and every server document remain exact.

The negative window characterizes this bounded SDK/session case, not permanent
failure, an OS connectivity event, real process cold boot or a latency SLA.
Unexpected token/generation events fail this characterization rather than being
reported as reproduction. Close occurs in finally and first in fixture cleanup.
The original negative case retains the no-op connectivity source; the new case
below separately exercises the production recheck path.
Both new owners receive no server seed and may never create an entry, sidecar,
access override or orphan reference; the complete Admin preflight and readback
must be exactly equal. Earlier owners remain unchanged.

10. `usableConnectivitySignalRechecksActualEntitlementWithoutManualSync`: a third
    empty diagnostic owner uses the actual Session, verifier and named SDK, but a
    controlled Boolean connectivity source. Real offline failure and subsequent
    SERVER reachability precede a signal burst. Only that burst triggers recovery;
    no manual requestSync is used. Generation must advance exactly once, all four
    positive scheduling requests occur exactly once, and already-active bursts do
    not restart verification. Close releases exactly one registration; its retained
    callback and another start cannot revive the Session. Both bounded two-second
    negative observations are not latency guarantees. Full Room/remote state stays
    unchanged. This case is **synthetic OS delivery**, not actual Android network
    switching, automatic worker execution or multi-device convergence.

## Offline private-worker retry and actual FULL recovery

12. `offlinePrivateMutationSurvivesRoomReopenAndCompletesFullPull` starts with one
    deterministic pending private binder and its original outbox mutation in an
    owned, file-backed Room fixture. Its remote owner starts empty; no Admin seed.
    Real subject SDK transport is disabled. Two actual worker passes, separated
    by a verified Room file close/reopen, must return retry before opening the
    database and preserve all fourteen business tables exactly. The separate
    nominal control SDK confirms no remote writes. After enableNetwork and real
    SERVER access, the actual worker pushes/ACKs revision1 and completes its four
    active FULL-pull groups. A fresh online pass preserves the complete Room and
    server payload, including the server timestamp. No Delta is activated.

The new owner is `sdk-proof-collection-private-offline-retry`; the sole allowed
new document is `privateBinders/offline-retry-binder`, with mutation ID
`private-offline-<runId>-binder`. Exact payload and nulls are checked by Android
and independently by the complete Host readback. The final twelve-case tree has
13 collection paths, 21 document references and 13 actual documents; existing
16-collection/32-reference bounds remain unchanged. This proves neither actual
OS reconnect delivery, automatic WorkManager retry, process death nor a large
FULL cycle. The pending start is a synthetic valid DAO fixture, not a claimed
repository creation or previous remote commit. Worker pass bounds are 30s,
whole-case 120s; timeouts are never converted into passing retry evidence.

## Independent complete-tree evidence

Before **every** method, Admin captures the complete bounded database tree plus all seventeen Auth accounts. For seeded methods it first uses create-only writes, reads back and validates each exact fixture, then records the complete preflight. No filter drops unknown documents. Only the final 1001-binder scenario has the exact-path inventory exception described below. Both knowledge documents consume ordinary references; the generic limits remain sixteen collections and thirty-two ordinary references.

Each preflight must equal the previous method's complete final state plus exactly this method's allowed seeds. Healthy/stale remain unseeded; missing remains absent. Pending-overlay must still be revision1. Late-parent must have exactly two binders/one placement and **no Collection parent**. Earlier owners, exact fields/timestamps and accounts must remain unchanged.

After every Android method, **even upon FAIL**, Admin again captures the full tree and accounts. Validation requires exact collection paths, document references, every existing document and every field. Final pending-overlay must be the agreed revision2 with timestamp not before its seed; all other Admin seeds are fully immutable. Late-parent gains only the expected nominal-client-created Collection entry. All prior owners, missing/unrelated-owner absence, claims/providers and absence of access overrides/extra sidecars remain checked.

Raw preflights/readbacks are saved before validation. A server commit alone, including pending-overlay revision2 or the late parent, never makes a failed Android method pass. The intermediate held-write/first-private-pass evidence is Android control SDK + Room assertions; Admin independently samples **before and after** each method, not between the two internal worker passes.

## Fail-closed completion, scope and cleanup

- Exactly sixteen START/PASS pairs, each `numtests=1`, `OK (1 test)` and one final instrumentation code; duplicate/skip/assumption/missing/partial/failure status fails.
- Each host invocation retains its 180-second bound and the unchanged launcher keeps an overall 18-minute budget. A slow case can exhaust the total budget; no timeout is converted to success.
- Existing `run.mjs` changes only its descriptive cleanup scope: it still hashes the entire product Kotlin source set (including the new scheduling seam), the existing SDK class/gate, APK inputs and all five host files (including this README). No manifest list entry is needed.
- Original Android bounds: setup60s / test120s / Task20s / held-gate15s. Late-parent adds 45s per real worker pass and control queries limit8. Actual product FULL queries retain limit200 / logical budget1000. This small fixture does not instrument total RPC/read billing or establish scale.
- Android attempts every owned-resource cleanup: gate cancellation/restoration, named Firestore termination, named Auth sign-out/app deletion and Room close. File-backed cases verify the exact run/owner/UUID marker before deleting only their owned fixture and SQLite sidecars. PASS includes successful teardown. RED alone does not independently prove cleanup.
- Host checks instrumentation idle before/after cases/exit. It never starts a case over uncertain live instrumentation, force-stops packages on timeout, resets a shared emulator or deletes user databases.
- Only owned unchanged reverse mappings are removed; afterward require free ports, empty mappings, idle instrumentation and unchanged input hashes. Process cleanup remains the reviewed owned child-process mechanism, not name/port killing.
- Admin cleanup errors fail the proof. No pending-overlay write is released on Android failure merely to make cleanup succeed.
- No safeDelta/bootstrap activation, historical timestamp validation, delta-overlay completeness, hard-delete repair, UI/WorkManager delivery, distributed lock, multi-device scale or performance SLA follows.

Evidence belongs to `outputs/collection-sync-session-local/<timestamp>-<runId>/`:
manifest, complete server-proof, per-method logs and emulator log. Source alone is
not evidence that a later build or environment passed.

## Narrow knowledge listener/Auth proof (historical local verification)

14. `knowledgeListenerReplacesCacheRemovesMissingAndInvalidatesOnSignOut` uses the
    actual `FirebaseScanKnowledge.observeRelevant` adapter, real nominal Google
    Auth and Firestore SDK, and the existing guarded demo transport. Admin creates
    exactly `scanKnowledge/` plus 64 ones just before this method. The complete
    payload and actual `lastUpdatedAt` are independently checked by Admin and the
    separate control SDK. The matching local hint differs in every ranking field;
    the callback and AtomicFile cache must both equal the complete server record.
    A second fingerprint (64 twos) starts locally cached but is confirmed absent
    on the server. Its null callback only passes if its exact base/backup/new files
    are absent, while the positive and a third unobserved cache file remain exact.
    The positive listener remains open for real subject `auth.signOut()` and must
    then publish null with no canonical account; the control account stays signed
    in. No explicit observation close can supply that null assertion.
15. `malformedKnowledgeListenerRemovesOnlyExactCacheAndPreservesLocalState` is the
    additional negative listener case described below; locally verified above.
16. `largePrivateFullPullContinuesAfterBudgetAndRoomReopen` remains the final
    1001-binder case, with unchanged worker semantics and exact inventory exception.

The knowledge case owns a run/UUID directory and a uniquely named real preference
file. Its ContextWrapper returns itself as applicationContext and redirects both
filesDir and consent preferences, so the default app cache/consent are untouched.
Observation close, SDK teardown, preference deletion and exact file cleanup are
attempted independently. Deletion checks the ownership marker and exact allowed
paths; it never recursively removes a shared directory. Full Admin before/after
trees and all accounts must match exactly. The historical fifteen-case final tree
contained 16 collection references, 1026 document references (24 ordinary), and
1016 existing documents. The new sixteenth case adds one ordinary reference and
one existing document; the bounds and exact final-owner exception stay unchanged.

This case proves neither nonempty evidence/receipt preservation, malformed server
payload handling, transport-failure fallback, revoked Rules/claims, A->B->A auth,
late callbacks after close, process death, physical devices, scanner UI/ranking
accuracy, nor production latency. Empty outbox/upload directories and unchanged
preference contents prove only absence of writes in this observe-only path. There
are no enqueue, consent setter, worker, default Firebase or app behavior changes.

## Twelve-case Root verification on 2026-10-02

**12/12 actual SDK cases PASS**, 91.365 s complete harness; new offline case
4.094 s. All twelve full Admin preflights/readbacks and thirteen nominal accounts
verify. Exit0, frozen inputs, free ports, empty reverse mappings and idle final
instrumentation confirm. 16/16 pure validators and focused lint pass separately.
Evidence: `outputs/collection-sync-session-local/2026-10-01T22-27-50-753Z-8fc2d585e11e4d0881894a53d65a83f2/`.

Root installation and 11/11 real Room controls: Android
`artifacts/release27-engineering-20261002/collection-session-room-222722-9c8f340d/manifest.json`.
App `64d40b75180873a339413460b5af1455a32c32ac24096577777d3a725ec822d3` remains
unchanged; test `ad0bb28f57bc5778cab306b4dfc98a579a1ceb36a5f50d7996c549d39ce1f5e7`.
Source snapshot `261bda2e3022f6bd7b1bdcfe640b07c41e520afc06772a3e16b10a45716063c2`.
Only the Android test and this Host contract changed; production policy remains
FULL. No automatic delivery/process-death/large-cycle or whole-release claim.
Older evidence below retains its own earlier inputs and counts.

## Ten-case Root verification on 2026-10-01

**10/10 actual SDK cases PASS**, with ten full independent Admin preflights and
readbacks, eleven nominal accounts, exact previous-owner state and unchanged
diagnostic owners. The new case recovers on a controlled usable-network signal
without manual sync, with exactly one generation advance and one set of four
scheduling requests. Duplicate healthy signals and callbacks after close cannot
reactivate it. This proves the session path with synthetic OS delivery, not real
Android network switching, automatic WorkManager execution or a latency SLA.
The original nine methods remain intact. Twelve pure validators and focused lint
pass separately. Complete harness duration: 78.799 s.

Evidence: `outputs/collection-sync-session-local/2026-10-01T20-07-42-715Z-a417bd8b48954918bb8cf634c6c906ea/`.
Exit 0, serverVerified, free ports, empty reverse mappings, idle instrumentation
and unchanged inputs all verify. Root's installation proof is Android
`artifacts/release27-engineering-20261001/collection-session-room-200651-0aa74074/manifest.json`:
app `58613d94075ea30791e4996c791ed5aedd9f960f97326aea66d0d3f5ddbdf958`,
test `ea5bc02b4a59ba64045d41376b3362014360c634729d3df4d56315ed45c1cac7`.
The same APKs pass 11 Room cases and fixed 371 emulator regressions; sources/APKs
stay unchanged and the device stays offline. No release artifact, production,
Rules, signing, deployment or Xiaomi action. Hashes precede this evidence text.

## Nine-case Root verification on 2026-10-01

**9/9 actual SDK cases PASS**, with nine full Admin preflights/readbacks and ten
nominal accounts. The offline case confirms the bounded two-second no-event
characterization followed by actual explicit-request activation; it is not an OS
reconnect test or proof of permanent failure. All earlier seven cases still pass.
Twelve pure validators pass separately, including rejection of mutations by either
new diagnostic owner. Focused host lint passes.

Evidence: `outputs/collection-sync-session-local/2026-10-01T19-53-27-370Z-c302ec6569884feb9b8e423dcb94cf5b/`.
Exit 0, serverVerified, free ports, empty reverse mappings, idle instrumentation
and unchanged source/APK inputs are all confirmed. Root's independent installation
proof is Android `artifacts/release27-engineering-20261001/collection-session-room-195240-3b974eef/manifest.json`:
app `259b5319722a1e3d9a949f1e21e74f8ce90666953866c3c0644593329d5acd2b`,
test `3028b9ac412af64e76f9aa25d792d504334f8946cb8b43d5c0ce85c469f8548e`.
That same install passes 11 Room session controls. No production, signing, release
bundle, Xiaomi or deployment action. These hashes refer to the frozen run inputs,
before this dated evidence paragraph was added.

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

## Eleventh case: read-only deferred placement across Room reopen — verified

`deferredPlacementPointReadSurvivesRoomReopenUntilParentDelivery` uses owner
`sdk-proof-collection-deferred-point-read`. Just before this method, Admin seeds
exactly three complete revision-1 documents with actual server timestamps:
`collectionEntries/entry`, `privateBinders/deferred-binder` and
`privateBinderPlacements/deferred-placement`. Unlike the late-parent case, the
Collection parent already exists remotely; only its local Room delivery is absent.

The case uses a real `PrivatePullAuthSession`, named Google SDK `Source.SERVER`
point reads, `PrivatePullRemoteRoomAdapter` and the real Room metadata store. A
known fixture's initial trusted singleton page creates a deferred marker through
`commitFence`/`commitPage`. This is a deliberately complete isolated fixture, not
evidence that arbitrary provider queries are complete.

After closing and reopening its own named Room file, a fresh adapter reserves the
persisted marker. A fresh placement point read followed by `commitRecheck` must
retain it while the parent is still locally absent. A genuine parent point read
is then applied through `applyRemoteDocumentToRoom` inside the normal session
guard. Another fresh placement read/recheck applies the unchanged placement and
removes the marker. Local parent delivery is not a fabricated direct Room seed.
Checkpoint commits may advance the local checkpoint revision; scope, epoch and
cursor identity are asserted independently by Android.

The client performs **no server writes**. Every field in all three seeds,
including each actual server timestamp and mutation ID, must be identical in the
full Admin preflight and final readback. Every previous owner's data and all
twelve Google identities/claims must remain exact too. The complete-tree oracle
does not filter unknown owners, access overrides, sidecars, empty references or
other unexpected documents.

This is not a whole-worker invocation, an upload ACK, active delta/bootstrap
integration, automatic WorkManager retry, OS process-death recovery, a permission
change or a throughput/liveness claim. Marker removal is not an outbox ACK.
Android closes and safely removes only the uniquely owned test Room file; the
launcher does not add any database deletion behavior. `run.mjs`, ports, overall
budget, offline-AVD constraints, source hashing and owned cleanup remain unchanged.
Host's existing tree bounds still suffice: this complete fixture ends with twelve
collection paths, nineteen document references and twelve actual documents.

Two additional pure validators exercise the exact three seeds and fail-closed
rejection of changed seeds, revisions/mutation IDs, cross-owner references,
timestamps, readbacks, extra documents/claims and missing/failed method evidence.
Pure validator success would not itself establish the SDK or Room behavior above.

Root executed all **11/11 actual SDK cases** successfully, including this new
case (3.213 s), with complete harness duration 87.918 s. Fourteen pure validators
and focused lint pass separately. Evidence:
`outputs/collection-sync-session-local/2026-10-01T20-25-48-822Z-ccab0ba13ece438187f1e58ac19444e3/`.
Exit 0, full server proof, free ports, empty reverse mappings, idle instrumentation
and frozen inputs all verify. All eleven preflights/readbacks and twelve accounts
are checked; the three new seed documents are entirely immutable. Root's exact
installation/11 Room-control proof is Android
`artifacts/release27-engineering-20261001/collection-session-room-202521-6b8fb4ba/manifest.json`:
app `58613d94075ea30791e4996c791ed5aedd9f960f97326aea66d0d3f5ddbdf958`,
test `230d51dff73bd2e52d308c0e98b3f03ccf8f19dcbba29690c649b2bc5fc2dd46`.
No product, Rules, release artifact, signing, deployment or Xiaomi change. These
hashes precede this evidence paragraph; no process-death/active-delta claim.

## Thirteenth case: two-client private-binder stale-base convergence

13. `twoClientPrivateBinderStaleEditConvergesWithoutRemoteRewrite` starts remotely
empty, with no Admin seed. Two independent named client SDKs use the same nominal
Google owner and separate run/label/UUID-owned Room files. A creates revision1 with
the real private worker; B receives it via the real FULL worker, not direct local
copying. Each Room then holds a different synthetic pending base1 edit. A commits
revision2. B's later client timestamp cannot override its stale base: REMOTE_WINS
must consume B's original outbox mutation and apply every A field. An independent
named witness checks full SERVER payload/timestamps before and after B and fresh
passes. All 14 business tables and exact FULL metadata are checked in both Rooms;
only their separate fixture-owner marker differs across databases. No continuation
or sharing callback is expected. Each exact owned Room file is closed, ownership-
verified and deleted with its sidecars; @After failure cannot count as PASS.

The final Admin inventory is exactly 14 collection references / 23 document
references / 14 existing documents; existing 16/32 inventory limits are unchanged.
All earlier scenarios and owner payloads/timestamps remain unchanged, with exactly
14 nominal accounts checked in every preflight/readback. No Admin writes occur for
this new owner. The host cannot replace Android intermediate witness assertions
with a final-only sample; both are mandatory for a passing complete proof.

The initial creation and edits are valid synthetic DAO fixtures, not UI/repository
action coverage. The invocations are sequential to test a deterministic stale base
in this one process. This does not prove concurrent physical devices, all conflict
interleavings, process death, WorkManager delivery, or native query completeness.
The draft adds no product behavior, credentials, Rules or runtime architecture.
The dated Root run at the top is the actual 13-case proof. Pure validator success
alone does not prove that Android performed any worker pass.

## Additional malformed knowledge listener case (locally verified, 2026-10-03)

The new phase uses owner `sdk-proof-collection-knowledge-malformed` and a single
create-only Admin fixture at `scanKnowledge/` plus 64 fours. Every field is the
agreed fresh synthetic `STABLE` record except `knowledgeVersion`, which is the
string `"1"`. A separate genuine control SDK confirms that exact SERVER payload.
The actual `FirebaseScanKnowledge.observeRelevant` listener must reject it through
the normal decoder and remove only the matching base, backup and new cache files
while its real subject remains signed in. There is no fake listener, Auth override,
transport gate replacement or production decoder change.

The isolated local fixture includes nonempty pending evidence and uploaded receipts
for both synthetic owners, a separate unobserved 64-fives cache record, and real
isolated consent preferences. Exact file bytes and directory inventory may change
only by the three target cache files disappearing. Those files must already be
absent before any later cache get could itself remove them. Preferences, both
owners' evidence/receipts and the unobserved cache remain exact. The existing
`localSnapshot()` also compares eight Room tables using their string
representations; this is not typed preservation proof for all fifteen tables.

Admin independently captures the complete tree and all seventeen nominal accounts
before and after the case, including an Android failure. The snapshots must match
exactly, with no owner parent, collection entry, sidecar, access override, remote
rewrite or other extra path. The subsequent final budget case must retain the
malformed record unchanged. Final expected inventory is 16 collection references,
1027 document references (25 ordinary), and 1017 existing documents. Generic
16/32 limits and the exact final-only 1001-binder exception remain unchanged.

The current source proposal requires sixteen real START/PASS pairs plus sixteen
independent complete Admin preflights/readbacks; historical fifteen-case output
does not satisfy it. A pure validator pass is not Android listener evidence.
The existing Node loopback guard does not instrument Java/native code or the OS
and is not a security sandbox; exact emulator endpoints and Android offline checks
must not be described as host-wide no-egress proof. This case makes no transport
failure, revoked-access, late-callback, physical-device or production claim.
