# Lokale Private-Operations-Regression

Dieser versionierte Starter führt ausschließlich die **30 bestehenden/erweiterten Tests**
aus `tests/private-operations.test.mjs` gegen lokale Auth-, Firestore- und
Storage-Emulatoren aus. Das Projekt ist fest `demo-domidex-privacy`.
Es gibt keine Anmeldung an echten Konten, Veröffentlichung, Produktionslöschung
oder Downloads; Auth-Anmeldungen erfolgen ausschließlich im lokalen Demo-Emulator.

Die bisherigen 27 Fälle enthalten zusätzlich die exakte Bereinigung des neuen
Read-Quota-Zählers samt Fremdkonto- und Wiederaufnahmeprüfung. Drei weitere Fälle
prüfen den lokalen Zeitanker mit echten Admin-SDKs: unveränderte Nanosekunden aus
dem fehlenden Lock-Snapshot, ein gemeinsames 60+1-Limit über zwei SDK-Instanzen
(59 echte Reservierungen, dann zwei konkurrierende Endpunktaufrufe) sowie
Berechtigungsentzug/Disabled und Löschsperren vor und nach der Authentifizierung.
Das ist kein Produktionslasttest und keine Android-Delta-Sync-Ende-zu-Ende-Prüfung.

## Voraussetzungen und Aufruf

Bereits installiert werden benötigt: Node 24+, Java 21+, die Repository-
Abhängigkeiten einschließlich Vitest sowie **Firebase CLI 15.28.2**. Die bereits
vorhandenen JARs müssen exakt zur Integritätsmetadatei dieser CLI passen:
Firestore **1.22.0**, Storage Rules Runtime **1.1.3**. Fehlende Dateien,
unbekannte Versionen, fehlende SHA256-Angaben oder abweichende Dateigröße/Hashes
führen vor dem Emulatorstart zum Abbruch. Der Starter installiert nichts.

Aus dem Repository-Stamm:

```powershell
node --test tests/private-operations-local/safety.test.mjs
node tests/private-operations-local/run.mjs
```

Optional können vorhandene Installationen ausdrücklich angegeben werden:

```powershell
node tests/private-operations-local/run.mjs --firebase-cli "PFAD/firebase-tools/lib/bin/firebase.js" --java-home "PFAD/jbr" --emulator-cache "PFAD/firebase/emulators"
```

Ohne Optionen sucht der Starter die CLI im lokalen `node_modules`, im bestehenden
globalen npm-Pfad und im PATH. Java wird in JAVA_HOME, der üblichen vorhandenen
Windows-Android-Studio-JBR-Installation und im PATH gesucht. Der Cache wird unter
dem vorhandenen Standardpfad `.cache/firebase/emulators` gesucht. Eine frische
Quellkopie braucht weiterhin diese **lokal vorinstallierten** Werkzeuge und Caches;
sie hängt nicht von früheren `outputs`-/`artifacts`-Dateien oder einem Android-Repo ab.

## Isolation und Abbruch

- Alle Emulatoren binden ausdrücklich an `127.0.0.1`; die Emulator-UI ist aus.
  Benötigt werden TCP 9097 (Auth), 8187 (Firestore), 9297 (Storage), 4407 (Hub),
  4507 (Logging) und 9150 (Firestore-Websocket). Belegte Ports führen zum Abbruch.
- Jeder Lauf bekommt neue APPDATA-, LOCALAPPDATA-, XDG-, CLOUDSDK-, Home- und
  Temp-Verzeichnisse. Das Kindprozess-Environment wird aus einer kleinen OS-
  Allowlist neu aufgebaut: keine vererbten Credentials, Tokens, Proxy-Adressen,
  `.env`-Werte oder Java-/Node-Injektionsoptionen. Vitest nutzt `envDir: false`.
- Das vor allen CLI-/SDK-Imports geladene Node-Preload erlaubt nur Loopback-
  Netzwerkziele; nichtlokale Socket-/TLS-/DNS-/Fetch-/HTTP2-/WebSocket-Zugriffe
  werden blockiert, UDP ebenfalls. Die CLI-erzeugte `FIREBASE_CONFIG` wird vor
  dem Testprozess verworfen. Die Tests verwenden ausschließlich ihre feste Demo-ID.
- Das ist **keine OS-Firewall und keine Java-/Native-Sandbox**. Java wird mit
  geprüften vorhandenen JARs, bereinigter Umgebung und lokaler Demo-Konfiguration
  gestartet. Ein manipuliertes lokales Tool oder natives Modul liegt außerhalb
  dieser Grenze. Portprüfung und Start sind außerdem nicht atomar.
- Nach 180 Sekunden wird ein hängender Testprozess beendet, nach 300 Sekunden
  der gesamte eigene CLI-Prozessbaum. SIGINT/SIGTERM und Kindprozessfehler liefern
  einen Fehlerstatus. Nur ein noch lebender, selbst gestarteter Prozessbaum darf
  beendet werden. Es gibt keine Prozesssuche/Beendigung anhand eines Ports/Namens.
  Falls eine hart abgestürzte CLI verwaiste Listener hinterlässt, meldet der
  Nachtest einen Fehler; unbekannte Prozesse werden **nicht** automatisch beendet.
- Die Produktregeln und Testdatei werden nicht geändert. Regeln werden lediglich
  bytegleich in den isolierten Laufordner kopiert. Hashes der Quellen werden vor
  und nach dem Lauf verglichen. Die CLI startet den festen Befehl
  `node execute.mjs`; variable Dateipfade werden nicht zu Shellbefehlen verkettet.

## Ergebnis und Aussagegrenzen

Unter dem ignorierten `outputs/private-operations-local/<Lauf-ID>/` liegen
`emulator.log`, `vitest-results.json` und `manifest.json`. Das Manifest enthält
Werkzeugversionen, SHA256/Größe der beiden JARs, Hashes der Regeln/Tests/des
Harness, Portprüfungen, Testzahlen und Exitstatus. Erfolg setzt ausdrücklich
**30 bestanden, 0 fehlgeschlagen/übersprungen**, unveränderte Quellen und freie
Ports nach Emulatorende voraus.

Getestet werden echte lokale Admin-SDK-Aufrufe der Sharing-, Bild-/Berechtigungs-
und Kontolöschengine, einschließlich Teilfehlern, Wiederaufnahme und Fremdschutz.
Es ist **kein** Android-Worker-/Browser-End-to-End-Test und kein Nachweis der
Produktionskonfiguration. Storage-Soft-Delete-Metadaten und die Uhr werden in der
bestehenden Suite gezielt injiziert, weil der Emulator diese Anbieterfunktion
nicht real nachbildet. Es gibt keinen Beleg einer tatsächlichen Provider-Purge-
Frist oder eines live ausgelösten Functions-Triggers.
