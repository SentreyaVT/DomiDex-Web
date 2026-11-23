# Android/Web price conflict proof — local only

This is a separate opt-in genuine SDK regression for the existing PRICE_SELECTION conflict policy. It does not change product code or the original `tests/android-web-price-local` ACK/pull/clear proof. No signing, production Firebase, Play Console, physical device or network provider is used.

## Prerequisites and ownership

- Windows, preinstalled Node 24+, Java 21+, reviewed Firebase CLI 15.28.2 and SHA-verified cached emulator JARs; nothing is downloaded.
- Exactly `emulator-5554`, AVD `DomiDex_R27_Baseline_API36`, airplane mode on, Wi-Fi off. Android also verifies hardware/debuggable/offline network and confines actual gRPC database requests to the demo project.
- The operator must build/install the current debug APK and instrumentation APK and independently verify their installed hashes. This launcher hashes local APKs and source files before/after; those hashes alone do **not** establish the installed APK identity. It never builds or installs APKs.
- No other instrumentation may be active, all fixed emulator ports must be free, and all ADB reverse mappings must initially be empty. Unknown idle output fails closed. No process is force-stopped.
- Android and Web Firestore/Storage Rules must be byte-identical. The launcher reuses the existing reviewed isolated-environment, network-preload, cached-JAR verification, local emulator configuration and child-process ownership helpers. It starts only Auth and Firestore emulators with fixed `demo-domidex-privacy`.

## Run each decision in its own fresh emulator instance

From this Web project, after operator-owned debug compilation/installation:

```powershell
node tests/android-web-price-conflict-local/run.mjs --android-root <ANDROID_ROOT> --resolution cloud
node tests/android-web-price-conflict-local/run.mjs --android-root <ANDROID_ROOT> --resolution local
```

Run sequentially, never concurrently. Optional explicit preinstalled paths use the existing `--firebase-cli`, `--java-home`, `--emulator-cache` options. `--resolution` accepts only exact `cloud` or `local`; there is no default, combined mode, production project, port, serial or account override.

Pure parser/fixture validation, which is **not** SDK evidence:

```powershell
node --test tests/android-web-price-conflict-local/validation.test.mjs
```

## Real product sequence

Each run creates one emulator-only Google account `price-conflict-owner`, verified email `price-conflict@example.invalid`, provider UID `price-conflict-google`, solely `{appAccess:true}`. Admin setup seeds the unchanged collection parent at `users/price-conflict-owner/collectionEntries/entry`, not a price choice or `accountAccess` override.

1. Android `androidCreatesAndAcknowledgesPriceChoice`: actual repository choice 532 EUR minor / `normal_avg_sell`, sourceAt 1000, selectedAt 2000. Actual common worker acknowledges server revision 1 and clean Room state.
2. Web actual subscription observes revision 1; actual `saveCollectionPriceSelection` transaction sets 450 / `normal_low`, revision 2 with genuine client/server timestamps.
3. Android `androidHoldsStaleBaseConflict`: local choice 500 / `normal_avg_1d`, sourceAt 1000, selectedAt 3000 from still-confirmed revision 1. Two actual common worker passes must keep the exact conflict and payload, old base revision and ERROR queue state. Server remains field-for-field Web revision 2 despite subsequent full pulls.
4. Android `androidResolvesExplicitConflict`: existing guarded resolution helper. **Cloud** adopts confirmed revision 2 / 450, no server rewrite. **Local** explicitly rebases then actual worker commits revision 3 / 500, preserving sourceAt 1000 and selectedAt 3000. No new conflict policy is introduced.
5. Web actual subscription, with **no write**, observes the resulting choice; a separate server-confirmed SDK read and independent Admin readback confirm it exactly.

After every one of these five phases, independent Admin reads verify the full sidecar field set and values, unchanged parent, sole exact Google user/provider/claims, no accountAccess override and exactly one sidecar. The five snapshots are included in `server-proof.json`; held, cloud-retained and final subscription values are compared field-for-field including mutation IDs and timestamps. Revision 3 is a live 500 choice, never the older roundtrip's clear tombstone.

The Web test substitutes only the Firebase-client initializer with a named emulator SDK; product subscription, save, codecs, permissions and RPCs remain real. The product callback has no metadata argument: callback data is matched to a separate `getDocFromServer` result with `fromCache=false` and `hasPendingWrites=false`; the proof does not claim that those flags came from the callback.

## Exact success and cleanup

- Every Android phase must report its exact class/method and one START followed by one PASS, `OK (1 test)` and a single final instrumentation code. Skips, duplicate/unfinished statuses, wrong classes and partial executions fail.
- Each Web phase requires one exact named passing assertion, no pending/todo/failing assertions. Cleanup is never counted as a success phase.
- The separate Android cleanup method targets only `domidex-price-conflict-<cloud|local>-<32hexrunid>.db` and its own verified ownership marker; it receives all three opt-in arguments. It does not delete user databases, log in or need cloud access.
- Named Web SDK cleanup attempts unsubscribe, timer cleanup, Firestore termination, Auth sign-out and app deletion independently, collecting errors. A timed-out live instrumentation prevents cleanup instead of causing a package force-stop.
- The launcher removes only its exact reverse mappings and verifies idle instrumentation, empty mappings and free ports afterwards. Source/APK hashes must remain unchanged. Failed or missing cleanup/readbacks cannot produce a passing manifest.

Evidence: `outputs/android-web-price-conflict-local/<timestamp>-<resolution>-<runId>/manifest.json`, `server-proof.json`, individual Android/Web logs, Web SDK proof/result JSON, and `cleanup-proof.json`. No execution result is implied by adding these files.

This proves the actual shared Android sync pass, not WorkManager scheduling/constraints or production latency, and covers one explicit decision per fresh run. Broader account races, remote writes during resolution, deletion conflicts and large-collection fairness remain separate tests. It does not claim zero-latency sync or a production rollout.
