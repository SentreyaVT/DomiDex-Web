# Lokale Private-Operations-Regression

Dieser versionierte Starter führt ausschließlich die **39 bestehenden/erweiterten Tests**
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

Ein weiterer bestehender Fall prüft die echte Admin-SDK-Fieldmask für geteilte
Karteneinträge. Zwei neue Fälle rufen die unveränderte Web-Funktion `addExactCard`
mit echten lokalen Google-/Firestore-Clients auf: Anlegen und identisches Erhöhen
sowie Ablehnung zweier positiver Produkte am selben bisherigen Speicherschlüssel.
Die 31 bisherigen Fälle bleiben erhalten; alte Läufe gelten nicht als 33er-Nachweis.

Zwei weitere Fälle prüfen seit 02.10.2026 den unveränderten kanonischen
Knowledge-Callback mit echten lokalen Admin-SDK-Transaktionen, konkurrierenden
Stimmen, unveränderter Wiederzustellung, alten Evidence-Versionen und Löschsperren.
Alle bisherigen 33 Fälle bleiben unverändert erhalten. Der Callback wird bewusst
direkt mit echten Server-Snapshots aufgerufen; Eventarc/Functions-Zustellung und
produktive Retry-/Lastbedingungen werden damit nicht simuliert oder bewiesen.

Ein zusätzlicher Fall prüft frische Löschaufträge: Der eigene deaktivierte
Access-Status bleibt bis zum Ende der Session-Ablauffrist erhalten, sein
Inventareintrag bleibt offen, und die bestehende Schlussbereinigung entfernt ihn.
Wiederaufnahme vor/nach der Frist, Fremdschutz und die minimale Startnutzlast
werden mit echten lokalen Admin-SDKs geprüft; die Uhr bleibt gezielt injiziert.
Die bisherigen 35 Fälle bleiben erhalten und erhalten ergänzende Fence-Prüfungen.
Ältere Läufe sind kein 36er-Nachweis. Bereits früher entfernte Statusdokumente
alter laufender Jobs werden nicht rekonstruiert. Parallele Rollenverwaltung bleibt
unverändert und kann weitere Metadaten ergänzen; eine dauerhaft minimale Nutzlast
unter solchen parallelen Änderungen wird nicht behauptet. Dies ist kein Nachweis
einer Android-Listener-Zustellung und ändert den separaten Lock-only-30s-RED nicht.

Drei additive Operatorfälle verwenden einen tatsächlich frisch erzeugten Löschjob
und öffnen danach einen neuen benannten Admin-SDK-Kontext auf denselben lokalen
Emulatorbestand. Echte aktuelle Tokens prüfen Admin-Status und authentifizierte
Wiederaufnahme vor der Frist, Abschluss und idempotenten Belegabruf. Für den
Abschluss werden ausschließlich die gespeicherten Jobzeitpunkte ausdrücklich als
historische Fixture gesetzt; der Service nutzt weiter die echte aktuelle Uhr.
Dies belegt weder 65 Minuten verstrichene Walltime noch einen historischen echten
Tokenwiderruf. Die vorhandenen Fristgrenzentests bleiben unverändert.

Owner-/Nichtadmin-Status und fremde Wiederaufnahme werden abgewiesen; falsche
UID/Job-Zuordnung, fehlender Job und aktive Lease dürfen keine Servermutation
auslösen. Vollständige begrenzte Firestore-Readbacks einschließlich Writezeiten,
Auth-Records sowie Storage-Metadaten und Bildbytes schützen den übrigen Bestand.
Ein neuer SDK-Kontext ist kein Prozess-/OS-Neustart. Aufgerufen werden die echten
Servicefunktionen, nicht ein HTTP-/Next-Router oder ein produktiver Scheduler.
Die bisherigen 36 Fälle bleiben unverändert; alte Läufe sind kein 39er-Nachweis.
Der tatsächliche 39er-Lauf vom 04.10.2026 ist einschließlich dieser drei Fälle
bestanden; der genaue Beleg und seine Grenzen stehen unten.

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
**39 exakt benannte Fälle bestanden, 0 fehlgeschlagen/übersprungen**, unveränderte Quellen und freie
Ports nach Emulatorende voraus.

Aktueller Nachweis: `outputs/private-operations-local/2026-10-04T20-55-49-732Z-1c8432ed/manifest.json`
und `emulator.log`, gestartet am 04.10.2026 um 20:55:49.854Z, abgeschlossen um
20:56:55.369Z: **39/39 bestanden, 0 Fehler, 0 übersprungen**, Exitcode 0.
Das Manifest bestätigt `beforePortsFree`, `afterPortsFree` und `inputsUnchanged`
jeweils als `true`. Der Vitest-Lauf dauerte 54,67s; die drei Operatorfälle sind
im Log einzeln als bestanden ausgewiesen. Die separat ausgeführten reinen
Starter-Sicherheitsprüfungen bestanden ebenfalls **17/17**; sie sind nicht Teil
der 39 Emulatorfälle. Diese nachträgliche README-Aktualisierung ändert den
eingefrorenen Quellenhash des ursprünglichen Laufbelegs nicht rückwirkend.

Getestet werden echte lokale Admin-SDK-Aufrufe der Sharing-, Bild-/Berechtigungs-
und Kontolöschengine, einschließlich Teilfehlern, Wiederaufnahme und Fremdschutz.
Es ist **kein** Android-Worker-/Browser-End-to-End-Test und kein Nachweis der
Produktionskonfiguration. Storage-Soft-Delete-Metadaten und die Uhr werden in der
bestehenden Suite gezielt injiziert, weil der Emulator diese Anbieterfunktion
nicht real nachbildet. Es gibt keinen Beleg einer tatsächlichen Provider-Purge-
Frist oder eines live ausgelösten Functions-Triggers.

## Zusätzlicher echter Web-Hinzufügen-Nachweis

Jeder neue Fall verwendet ein eigenes synthetisches Google-Konto mit exakt
`appAccess:true`, ohne Admin-/Pretesterrechte. Nur die Initialisierung von
`lib/firebase-client` wird durch einen benannten lokalen SDK-Client ersetzt.
RPCs, Transaktionen, Zeitstempel, Produktlogik und unveränderte Rules sind echt.
Die vorhandenen privilegierten Backend-Testkonten führen diese Clientwrites nicht aus.

Eine unabhängige MD5-Erwartung prüft den bisherigen UUIDv3-Schlüssel; beide
positiven Produkt-IDs und die Schlüsselkollision werden ausdrücklich bestätigt.
Der erste Fall muss Menge 2/Revision 1 anlegen und auf Menge 5/Revision 2 erhöhen.
Der zweite muss mit leerer und veralteter Clientliste exakt den Druckvariantenfehler
melden, ohne irgendein Serverfeld zu ändern. Nach jedem Schritt werden bestätigte
Clientreads und unabhängige vollständige Admin-Dokumente einschließlich Nanosekunden,
Mutation, Menge und Revision verglichen. Die begrenzte rekursive Inventur besucht
auch Unterkollektionen fehlender Eltern; Überschreitung führt zum Fehler statt Kürzung.
Erfasste Kontofelder/Claims/Provider sowie Storage-Objektnamen bleiben unverändert.
Dies ist kein vollständiger Auth-Export einschließlich Passwort-/Betriebsmetadaten.

`web-add-create-increment-proof.json` und `web-add-collision-proof.json` enthalten
die exakt geordneten Zustände und Bereinigungsnachweise. Nur eigenes Testdokument,
Testkonto und benannter SDK-Client werden bereinigt; anschließend muss die vorherige
Inventur wieder stimmen. Der bestehende Demo-Reset vor jedem Suitefall bleibt bestehen.
Ein Timeout oder harter Prozessabbruch beweist keine abgeschlossene Einzelbereinigung:
ohne vollständiges Proofartefakt wird der Lauf nicht erfolgreich gemeldet.

Der Starter prüft alle 39 Titel/Passzustände, beide Proofdateien und die unveränderten
Hashes der direkten/transitiven lokalen `addExactCard`-Quellen sowie des Paketstands.
Keine Browser-UI, Android-Workerplanung, Produktion, echten Marktpreise oder allgemeine
Idempotenz werden dadurch belegt; wiederholtes erfolgreiches Hinzufügen erhöht bewusst
die Menge. Der separate Android/Web-Preisrundlauf bleibt unverändert.

## Zusätzliche kanonische Knowledge-Persistierung

Der Test importiert den tatsächlichen `aggregateScanKnowledge`-Export und dessen
eigenen verschachtelten Admin-SDK-Paketstand. Der Standardclient wird nur nach
bestätigter Demo-Projekt-/Emulatorisolation initialisiert und am Ende beendet.
Unabhängige Admin-Reads vergleichen sämtliche gespeicherten Aggregat-, Public-
und Contributor-Felder einschließlich Server-Updatezeitstempeln. Eine identische
Wiederzustellung darf keine zusätzliche Stimme und keinen neuen Write erzeugen.
Ein echter alter Snapshot sowie der aktive synthetische Löschlock verhindern
Änderungen; nach Entfernung ausschließlich dieses Testlocks wird derselbe gültige
Beitrag verarbeitet. Das Transaktions-Versuchslimit des Produkts bleibt unverändert.

Nachweis: `outputs/private-operations-local/2026-10-01T23-47-21-660Z-52ae5b8f/manifest.json`,
35/35 bestanden, unveränderte Inputs, freie Ports nach Abschluss. Die kanonischen
Quellen und ihr Paket-/Lockstand sind zusätzlich im Quellenmanifest enthalten.
Kein tatsächlicher Retryzähler, Live-Trigger, Einwilligungs-UI oder produktiver
Löschlauf wird dadurch abgenommen.
