# Isolierte Firestore-/Storage-Rules-Matrix

Dieser Starter führt genau drei vorhandene Node-Testdateien aus einer ausdrücklich
angegebenen lokalen Android-Quellkopie aus:

- `firebase-tests/firestore.rules.test.mjs`: 11 Fälle.
- `firebase-tests/storage.rules.test.mjs`: 7 Fälle.
- `firebase-tests/release27-security.rules.test.mjs`: 66 Fälle, darunter vier
  neue Client-Deny-Fälle für `privateReadRateLimits`.

Das sind **84 Fälle**, ausschließlich mit synthetischen Daten im festen Projekt
`demo-domidex-firestore`. Die vier Quota-Rollen sind Owner mit App-Zugang,
Fremdnutzer mit App-Zugang, Client-Admin und anonym. Jede Rolle muss am aktuellen
gehashten Counter-Schlüssel mit realen SDK-Aufrufen scheitern: Create vor dem
Server-Seed, Get, gesamte Collection-Liste, exakte Dokument-ID-Abfrage,
Update/Overwrite und Delete. Ein abschließender Server-Read prüft den unveränderten
Datensatz. Server-Seed und Kontrolle benutzen bewusst deaktivierte Testregeln;
die überprüften Clientoperationen nicht.

## Voraussetzungen und Aufruf

Bereits installiert erforderlich: **Node 24+**, **Java 21+**, **Firebase CLI
15.28.2**, die Web-Abhängigkeiten und die Abhängigkeiten unter Android
`firebase-tests/node_modules`. Die vorhandenen Emulator-JARs müssen exakt zur
geprüften CLI-Metadatei passen: Firestore **1.22.0**, Storage Rules Runtime
**1.1.3**, jeweils mit passender Dateigröße und SHA-256. Fehlende oder abweichende
Dateien führen zum Abbruch; es wird nichts installiert oder heruntergeladen.
Android- und Web-`firestore.rules` sowie `storage.rules` müssen bytegleich sein.

Aus dem Web-Repository-Stamm, mit dem tatsächlichen Pfad zur Android-Quellkopie:

```powershell
node --test tests/private-operations-local/safety.test.mjs
node tests/rules-local/run.mjs --android-root <ANDROID_ROOT>
```

Vorhandene Werkzeuge können optional ausdrücklich angegeben werden:

```powershell
node tests/rules-local/run.mjs --android-root "PFAD/CardVault" --firebase-cli "PFAD/firebase-tools/lib/bin/firebase.js" --java-home "PFAD/jbr" --emulator-cache "PFAD/firebase/emulators"
```

Nur diese vier Pfadoptionen sind zulässig. Projekt, Suite, Konfiguration, Testliste
und Shellbefehl sind nicht frei überschreibbar. Ohne Werkzeugoptionen nutzt der
Starter dieselbe lokale CLI-/Java-/Cache-Suche wie `private-operations-local`.
Die drei Tests und ihr Fixture-Helper müssen in der Android-Quellkopie vorhanden
sein; frühere ignorierte `artifacts`-/`outputs`-Ordner oder historische Web-
Rules-Snapshots sind nicht erforderlich.

## Isolation und Lebensdauer

- Integritätsprüfungen, Portprüfung, saubere Kindprozessumgebung, Netz-Preload und
  Prozessbeendigung stammen aus `tests/private-operations-local/safety.mjs`.
  Dessen Default bleibt `private-operations`/`demo-domidex-privacy`; nur der neue
  feste Typ `rules` wählt `demo-domidex-firestore`. Der alte 30-Test-Runner bleibt
  ein eigener Lauf und ist nicht Teil der 84 Rules-Fälle.
- Nur Firestore und Storage werden gestartet, explizit an `127.0.0.1`. Die UI ist
  aus. Firestore 8187, Storage 9297, Hub 4407, Logging 4507 und Websocket 9150
  müssen frei sein. Der gemeinsame konservative Portcheck verlangt zusätzlich
  den freien Auth-Port 9097; in dieser Suite startet dort kein Auth-Emulator.
- Jeder Lauf erhält frische Home-, APPDATA-, LOCALAPPDATA-, XDG-, CLOUDSDK- und
  Temp-Verzeichnisse. Credentials, Token, Proxies sowie geerbte Node-/Java-
  Startoptionen werden nicht an Kinder weitergereicht; keine `.env` wird geladen.
  Die von der CLI erzeugte `FIREBASE_CONFIG` wird vor dem Testkind verworfen.
- Das gemeinsame Node-Preload blockiert nichtlokale Socket-/TLS-/DNS-/Fetch-/
  HTTP2-/WebSocket-Ziele sowie UDP. Das ist **keine OS-Firewall und keine Java-
  oder Native-Sandbox**. Geprüfte lokale Werkzeuge und JARs sind Voraussetzung;
  ein manipuliertes natives Werkzeug liegt außerhalb dieser Isolationsgrenze.
- Nach 180 Sekunden endet ein hängendes Testkind, nach 300 Sekunden der eigene
  CLI-Prozessbaum. Nur selbst gestartete noch laufende Prozesse werden beendet,
  nie anhand eines Ports oder Namens. Belegte Ports vor oder nach dem Lauf sind
  ein Fehler; ein fremder oder verwaister Listener wird nicht blind beendet.
- Die CLI erhält nur `node execute.mjs`; Quellpfade werden als Argumente an Node
  übergeben, nicht in einen variablen Shellbefehl eingebaut. Alle drei Dateien
  laufen seriell mit `--test-concurrency=1`.

## Nachweis und Grenzen

`outputs/rules-local/<Lauf-ID>/` ist ignoriert und enthält die vollständige
`rules.tap`, `emulator.log`, kopierte Rules/Konfiguration und `manifest.json`.
Erfolg verlangt **84 PASS**, null FAIL/Cancelled/Skipped/Todo, den vollständigen
TAP-Plan und jeden der vier Quota-Testtitel genau einmal. Weniger Fälle dürfen
nicht als Erfolg gelten. Eine Änderung der Zahl oder Testauswahl braucht einen
erneuten Review der tatsächlichen Matrix, keine bloße Anpassung an einen
fehlgeschlagenen Lauf. Das Manifest hält Tool-/JAR-Identität, Eingabehashes beider
Repos, freie Ports vorher/nachher und unveränderte Quellen fest.

Root verifizierte am 01.10.2026 **17/17 Safety** und **84/84 Rules ohne Skips**
(Rules-TAP 35,604 s). Beleg:
`outputs/rules-local/2026-10-01T05-23-40-780Z-a9b6f6b4/manifest.json`;
Exit 0, `beforePortsFree`, `afterPortsFree` und `inputsUnchanged` jeweils `true`.
Anschließend bestätigte Root auch den unveränderten Aufruf des separaten
Private-Operations-Defaults: **30/30 PASS**, 33,487 s Testdauer (35,04 s Vitest
gesamt). Beleg:
`outputs/private-operations-local/2026-10-01T05-24-48-401Z-2ebfe9c5/manifest.json`.

Keine Produktregeln werden geändert, keine Produktion wird angesprochen und
kein Deployment wird ausgelöst. Dies ist reale lokale Client-SDK-/Rules-
Verifikation mit synthetischen Claims, keine Prüfung produktiver Regeln, echter
Google-Konten, einer Android-Gerätesitzung oder der Backend-Quota-Transaktion.
Letztere hat ihren getrennten Private-Operations-Testvertrag.
