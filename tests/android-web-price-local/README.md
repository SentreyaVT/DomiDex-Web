# Real Android Room / worker-pass ↔ Web price selection proof

Opt-in, local-only evidence. This runner does not build, install, sign, publish or
contact a production backend. It does not start an Android emulator. The previous
three-case `private-pull-sdk-local` proof is unchanged.

## What is actually exercised

The Android instrumentation calls the real `RoomCollectionRepository` and the
shared production pass invoked by `PrivateBinderSyncWorker`, with an isolated
Room database and named, real Firebase SDK clients. It does not fake ACKs, bypass
the Google canonical-owner check, or manually delete an outbox to claim success.

The Web test calls the actual `subscribeCollectionPriceSelections`,
`saveCollectionPriceSelection` and `clearCollectionPriceSelection` functions.
Only `firebase-client` **initialization** is substituted with the named emulator
instance. Auth, RPCs, transactions, snapshots, codecs and timestamps are not mocked.
The subscription API does not expose snapshot metadata: the proof observes the
real subscription and **separately** confirms server state, not metadata of the
callback itself.

Ordered phases (one existing emulator lifetime):

1. Android A: real repository selects 532 minor EUR, `normal_avg_sell`, sourceAt
   1000, selectedAt 2000; real worker push and Room ACK produce revision 1.
2. Web: observe Android selection, then actual save of 450 minor EUR,
   `normal_low`, sourceAt 1000; revision 2 uses the product's real `Date.now()`.
3. Android B: same owned Room file, actual worker pull updates it to revision 2.
4. Web: actual clear writes revision 3 and all twelve nullable fields explicitly null.
5. Android C: actual worker pull applies clear without re-pushing it.

One synthetic Google-linked owner and one already-confirmed collection parent are
used. The parent remains field-for-field unchanged. Independent Admin SDK reads
check the complete sidecar after every step. A separate fourth Android invocation
cleans only this run's verified owned Room fixture; it is **not** success evidence.
The combination `me03-090` / product 42 and both prices is deliberately synthetic:
it establishes no correct real-world Cardmarket mapping or price coverage for that
card, other cards or all sets. This is not a production-latency benchmark.

This does not prove WorkManager delivery/constraints, UI behavior, initial parent
upload by the collection worker, every conflict/retry case, all prices, production
latency, or physical-device behavior. It is a focused product-pipeline integration
proof, not a claim that Gate 4 or all worker E2E coverage is complete.

## Preconditions and operator command

- Windows, preinstalled Node 24+, Java 21+ (default Android Studio JBR).
- Pinned installed Firebase CLI **15.28.2**, reviewed cached Firestore 1.22.0 and
  Storage rules 1.1.3 JAR hashes/sizes. Storage is verified but not started.
- Existing `emulator-5554`, AVD `DomiDex_R27_Baseline_API36`, airplane mode on,
  Wi-Fi off, no active Android network. No other instrumentation or reverse mapping.
- Operator has separately built and installed matching debug app/test APKs on that
  emulator. The input manifest hashes **local APK files**, not installed packages.
- Auth/Firestore emulators must start empty on 127.0.0.1:9097/8187. All reviewed
  emulator ports must be free. Android/Web Firestore and Storage rules must match.
- No parallel emulator work or source editing during a proof run.

From the Web repository, only after these preconditions are verified:

```powershell
node tests/android-web-price-local/run.mjs --android-root C:/Users/Dominik/AndroidStudioProjects/CardVault
```

Optional existing-tool paths: `--firebase-cli PATH`, `--java-home PATH`,
`--emulator-cache PATH`. No download/install fallback. Defaults are installed
`%APPDATA%/npm/node_modules/firebase-tools/lib/bin/firebase.js`,
`C:/Program Files/Android/Android Studio/jbr`, and `%USERPROFILE%/.cache/firebase/emulators`.
ADB is the existing `%LOCALAPPDATA%/Android/Sdk/platform-tools/adb.exe`.

Pure validator checks (not SDK evidence):

```powershell
node --test tests/android-web-price-local/validation.test.mjs
```

## Isolation, time bounds and cleanup

- Fixed demo project `demo-domidex-privacy`; synthetic owner
  `price-roundtrip-owner`, `price-roundtrip@example.invalid`, google.com provider
  UID `price-roundtrip-google`; **only** `appAccess:true`. No real credentials,
  accountAccess override or user data. No environment files or production config.
- Existing sanitized-environment and Node loopback preload are reused. The preload
  is defense-in-depth, not an OS/Java/native-network sandbox. The Android test also
  requires the offline AVD and its reviewed fail-closed demo gRPC gate.
- Vitest has `envDir:false`, Node environment and one worker. Named SDK apps use
  memory caches. Default Firebase App is not repointed or initialized by this test.
- A fresh 32-hex run ID names `domidex-price-roundtrip-<runId>.db`. Android checks
  its exact owner marker and A→B→C state; cleanup verifies ownership before deletion.
- Host uses the already-reviewed `dumpsys activity processes` idle probe. No
  force-stop by package, port or name. If a timeout leaves instrumentation alive
  or its state is opaque, cleanup is refused and the manifest fails. The operator
  must inspect that run before retrying. An unowned invocation is never stopped.
- Only reverse mappings created with `--no-rebind` are removed, and only if still
  unchanged. Only directly spawned host process trees are terminated on timeout.
- Bounds: each Android product phase 180 s, Web phase 90 s, owned Android cleanup
  60 s, whole emulator child 1020 s. Expected actual runs are much shorter; these
  are failure limits, not performance measurements.

## Evidence

Fresh files under `outputs/android-web-price-local/<timestamp>-<runId>/` include
the manifest, per-phase instrumentation logs, two strict Vitest JSON reports,
two Web proof records, five independent server readbacks, and separate owned-DB
cleanup evidence. Exact START+PASS/class/method, no skips, ordered phase identities
and complete field values are required; counts alone cannot pass.

The manifest hashes the harness/shared safety inputs, Web product modules, rules,
build configuration, **all current Android production Kotlin files**, the specific
Android test/gate, and both local APKs. Source hashes are checked again afterward.
Success also requires ports released, reverse mappings empty, instrumentation
idle, exact account/provider/claim preservation and verified owned Room cleanup.

These source files do not assert that any run has passed. Only a new manifest with
exitCode 0 and all verification/cleanup flags true is evidence for its exact inputs.
