# Isolierter Android-Firestore-SDK-Nachweis

Stand 01.10.2026: **3/3 tatsächliche Android-SDK-Tests bestanden**, einschließlich
unabhängiger lokaler Serverkontrolle und Cleanup. Die Testdauer betrug 2,962 s;
das ist keine Sync-Performance-Messung. Frühere Setup-/Fixturefehler bleiben unten
dokumentiert. Dieser Runner ist kein Release-, Deployment- oder allgemeiner
Gerätetest und aktiviert keinen Delta-Reader.

## Zweck und feste Quellen

Genau drei opt-in Tests vergleichen den tatsächlichen Firestore-Android-SDK-Pfad
`runTransaction`/Commit mit bewusst synthetischen optimistischen `set`/Write-
Operationen. Eine lokale ausstehende ServerTimestamp-Transformation kann die
Vollständigkeit einer vorgeschlagenen begrenzten Delta-Query beeinflussen, auch
wenn die zurückgegebenen Dokumente keine Pending-Writes-Metadaten tragen.
Die Tests ersetzen deshalb keine Inhaltsprüfung durch Metadatenbehauptungen:
ein unabhängiger benannter SDK-Client liest den Serverzustand; nach Freigabe
werden echte ACKs beziehungsweise eine echte Rules-Ablehnung erwartet.
Anschließend kontrolliert der lokale Admin-SDK-Prozess die gespeicherten Felder.

Quellen im Android-Repository:

- `app/src/androidTest/java/com/dominik/cardvault/data/sync/PrivatePullDemoGrpcGate.kt`
- `app/src/androidTest/java/com/dominik/cardvault/data/sync/PrivatePullSdkCompletenessInstrumentedTest.kt`
- `app/src/debug/AndroidManifest.xml` und
  `app/src/debug/res/xml/debug_emulator_network_security.xml`
- `docs/PRIVATE_PULL_SDK_PROOF.md`: detaillierter Fixture-/SDK-Vertrag.

Hier im Web-Repository: `run.mjs` steuert den isolierten Lauf, `execute.mjs`
seedet die festen Demo-Fixtures und kontrolliert die Ergebnisse;
`validation.test.mjs` prüft ausschließlich die Auswertung der Testausgabe.
Gemeinsame Integritäts-, Umgebungs-, Netz- und Prozesshilfen stammen aus
`../private-operations-local/safety.mjs` und `network-preload.cjs`.

## Voraussetzungen und Aufruf

Nur Windows, bereits vorhandenes **Node 24+**, **Java 21+**, **Firebase CLI
15.28.2**, installierte Web-Abhängigkeiten und lokales Android-SDK/ADB.
Die gemeinsamen Integritätschecks verlangen die vorhandenen Emulator-JARs
Firestore **1.22.0** und Storage Rules Runtime **1.1.3** mit geprüfter Größe und
SHA-256; Storage wird in diesem Lauf trotzdem nicht gestartet. Fehlende oder
abweichende Werkzeuge führen zum Abbruch, nicht zur Installation.
Android- und Web-Rules müssen bytegleich sein.

Zwingend vorab auf **`emulator-5554` / `DomiDex_R27_Baseline_API36`**:

1. Quellen prüfen und die passenden Debug-/AndroidTest-APKs separat erstellen.
   Keine Release-AAB, kein Release-/Upload-Schlüssel.
2. Genau diese beiden APKs separat auf diesem Emulator installieren:
   `app/build/outputs/apk/debug/app-debug.apk` und
   `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.
   Installationsausgabe und zugehörige SHA-256 sichern. **Der Runner installiert
   nichts und vergleicht lokale APK-Hashes nicht mit installierten APKs.**
3. Flugmodus an, WLAN aus, kein aktives Android-Standardnetz. Die Tests prüfen
   diese Bedingungen selbst. Keine vorhandenen `adb reverse`-Zuordnungen;
   keine parallele Instrumentierung, Emulatorverwaltung oder Portnutzung.

Aus dem Web-Repository-Stamm:

```powershell
node --test tests/private-pull-sdk-local/validation.test.mjs
node tests/private-pull-sdk-local/run.mjs --android-root <ANDROID_ROOT>
```

Optional ausschließlich vorhandene Werkzeugpfade angeben:

```powershell
node tests/private-pull-sdk-local/run.mjs --android-root "PFAD/CardVault" --firebase-cli "PFAD/firebase-tools/lib/bin/firebase.js" --java-home "PFAD/jbr" --emulator-cache "PFAD/firebase/emulators"
```

Ohne diese Optionen wird die CLI unter `%APPDATA%/npm/node_modules`, Java unter
`%ProgramFiles%/Android/Android Studio/jbr` und der Cache unter dem bisherigen
Home-Verzeichnis gesucht; ADB kommt aus `%LOCALAPPDATA%/Android/Sdk/platform-tools`.
Diese Pfade dienen nur der Werkzeugermittlung, nicht als geerbte Kind-Credentials.
Projekt, Geräte-Serial, Testklasse, Testliste und auszuführender Befehl sind fest.
Nur den Validator auszuführen ist kein Android-SDK-Nachweis.

## Isolation und Cleanup

- Festes Projekt `demo-domidex-privacy`, Auth `127.0.0.1:9097`, Firestore
  `127.0.0.1:8187`; nur neue synthetische Benutzer und Daten. Die aktuellen Rules
  werden unverändert kopiert. Kein produktiver Login, keine `.env`, kein Deploy.
- Der gemeinsame konservative Portcheck verlangt 8187, 9097, 9297, 4407, 4507
  und 9150 frei. Gestartet werden nur Auth/Firestore mit lokalen Hilfsdiensten,
  keine Emulator-UI und kein Storage-Emulator.
- Frische Home-/APPDATA-/LOCALAPPDATA-/XDG-/CLOUDSDK-/Temp-Verzeichnisse,
  bereinigte Credential-/Proxy-/Startoptionen und Node-Loopback-Preload.
  Das ist **keine OS-, Java- oder Native-Sandbox**. Geprüfte lokale Werkzeuge
  und der offline gehaltene dedizierte Android-Emulator bleiben erforderlich.
- Nur die beiden benötigten Reverse-Ziele werden mit `--no-rebind` angelegt.
  Das `finally` entfernt nur eigene noch unveränderte Zuordnungen und kontrolliert
  anschließend leere Reverse-Liste sowie freie Hostports. Keine fremden Prozesse
  werden anhand von Port oder Namen beendet.
- Die Instrumentierung hat 240 Sekunden, der eigene CLI-Prozessbaum 360 Sekunden
  Laufzeitbudget. Bei Fehler/Timeout werden zusätzlich nur die beiden festen
  Test-/App-Pakete auf `emulator-5554` gestoppt; ein beendeter ADB-Client allein
  würde die Android-Instrumentierung nicht zuverlässig beenden.
- Benannte Test-Apps benutzen eigene MemoryCaches und je App einen neuen
  synthetischen API-Key. Die DefaultApp wird nicht umkonfiguriert. Der globale
  Testhook ist auf Firestore 26.5.0 beschränkt und prüft vor echtem Call-Start die
  typisierte Demo-Datenbank. Fremde oder unbekannte RPCs bleiben lokal abgewiesen.
  Bereits existierende Kanäle sind dadurch nicht geschützt: Offline bleibt Pflicht.
- JUnit-Cleanup erfasst auch teilweise erzeugte Clients, terminiert sie, meldet
  nur Test-Authinstanzen ab, löscht Test-Apps und stellt den Hook wieder her.
  Gehaltene Mutationen werden bei Fehlern nicht freigegeben. Debug erlaubt HTTP
  ausschließlich für `127.0.0.1`, nicht global oder für `10.0.2.2`; die Ausnahme
  liegt ausschließlich im Debug-Quellset, nicht im Release-Manifest.

## Nachweis und Laufhistorie

`outputs/private-pull-sdk-local/<Lauf-ID>/` enthält `manifest.json`,
`instrumentation.log`, `emulator.log`, kopierte Rules/Konfiguration und bei
erfolgreicher unabhängiger Datenkontrolle `server-proof.json`. Erfolg verlangt
alle drei festgelegten Tests genau einmal, null Skips/Fehler, vollständigen
Instrumentierungsabschluss und unabhängige Serverkontrolle. Außerdem müssen
Cleanup-/Inputflags stimmen. APK-Eingabehashes belegen nur lokale Dateien;
der oben verlangte Installationsnachweis bleibt separat notwendig.

Alle folgenden Lauf-IDs liegen unter `outputs/private-pull-sdk-local/`; jede
enthält ihr eigenes Manifest und die vollständige Instrumentierungsausgabe:

1. `2026-10-01T05-35-54-096Z-36baf158`: Exit 1, **drei Setup-Fehler**.
   Android blockierte zuerst HTTP zu `127.0.0.1`; danach verwies die API-Key-
   gebundene Auth-Emulatorregistry auf eine bereits gelöschte benannte App.
   Die Debug-Loopback-Ausnahme und je App eindeutige synthetische API-Keys
   korrigierten diesen Aufbau. Kein Produkt-RED und kein SDK-PASS.
2. `2026-10-01T05-42-26-504Z-c108d5ec`: Exit 1, **drei Fixture-Setup-Fehler**.
   Auth, Claims und die erste tatsächliche Serverquery waren bereits erfolgreich;
   die Fixture erwartete aber nicht speicherbare Timestamp-Nanosekunden `1/2`.
   Firestore-Dokumentwerte speichern Mikrosekundenpräzision. Seed und exakte
   Assertions verwenden nun `1000/2000` Nanosekunden; der Host prüft die
   vollständig persistierten Fixturefelder vor dem Android-Start zusätzlich.
3. `2026-10-01T05-44-20-568Z-1fdcd71e`: **2 PASS, 1 FAIL**. Die beiden
   optimistischen Write-Szenarien liefen durch; der Commit-Test unterstellte
   unnötig die weitere Verfügbarkeit eines nicht mehr beobachteten Dokuments
   im MemoryCache. Statt dieser Retentionsannahme prüft er nun eine echte
   Server-Punktabfrage auf Existenz, alten Timestamp und fehlende Pending Writes.
   Die eigentlichen begrenzten Subject-/Control-Queries und ACK-Prüfungen
   bleiben erhalten; keine Produktionsabfrage wurde geändert.
4. `2026-10-01T05-46-24-017Z-354ac507`: **3/3 PASS ohne Skips**, 2,962 s,
   Exit 0 und `serverVerified: true`. Alle fünf Port-/Reverse-/Inputflags sind
   `true`. Die 15 Manifest-Eingabehashes wurden anschließend unabhängig
   read-only nachgerechnet und stimmten vollständig überein.

Der separate Android-Nachweis
`artifacts/release27-engineering-20261001/private-pull-sdk-proof-install4.log`
enthält beide erfolgreichen Installationen mit identischen Manifest-SHA-256:

```text
app-debug.apk             94e845d1dccddaf6465608ac7d1c274ff65ce3a0d88b56de131faf222beaa752
app-debug-androidTest.apk  1ea5844d925eaf4594b76949b29f69a5abaa50cf2bace949b0d4638dcf2a043c
```

`server-proof.json` des erfolgreichen Laufs bestätigt Revision 2 und einen neuen
Server-Timestamp für Commit/erfolgreichen Write, dagegen den unveränderten
abgelehnten Datensatz mit Revision 1 und Timestamp `(1700000000, 1000)`.
Die zugrunde liegenden Host-Assertions kontrollieren außerdem alle übrigen
Fixturefelder und das unveränderte Kontroll-Dokument `b`.

## Exakt abgedeckt und weiterhin offen

Belegt ist unter dem geprüften SDK/Emulator die konkrete Unterscheidung:
Der gehaltene `runTransaction`-Commit lässt den alten Bereich sichtbar;
ein bewusst optimistischer `set` kann im Subject dagegen eine bestätigte Query
mit fehlendem Dokument beziehungsweise leerem Ergebnis erzeugen. Die unabhängige
Control-Ansicht sieht das Dokument weiter. Bei echter Rules-Ablehnung reicht
ein inklusiver Folgelauf ab dem späteren oberen Timestamp allein nicht zur
Wiedererfassung des wiederhergestellten älteren Dokuments. Der erfolgreiche
Test dieser Gegenbeispiele bedeutet **nicht**, dass eine solche Delta-Strategie
produktiv sicher wäre.

Der PASS aktiviert keinen Delta-Reader, verändert keinen Room-Checkpoint und
beweist weder den vollständigen produktiven Sync-Worker noch Outbox-/Checkpoint-
Atomarität, alle lokalen Overlayzustände, Hard-Delete-Reparatur, fehlende
Zeitstempel, Live-Cloud-Verhalten oder höhere Geschwindigkeit. Ohne Opt-in werden
die drei Tests in gewöhnlichen Android-Läufen absichtlich übersprungen; solche
Skips dürfen nicht als Nachweis gelten. Die Laufartefakte sind lokal und ignoriert,
nicht Teil eines produktiven Releases.
