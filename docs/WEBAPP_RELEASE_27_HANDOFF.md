# Web-App: Übergabe für Release 27

Stand: 02.10.2026. Dieses Dokument gehört ausschließlich zum separaten Repository
`DomiDex-Web`; Android liegt im benachbarten Repository `CardVault`. Keine Kopie der
Web-Implementierung im Android-Repository pflegen.

### R27-Entscheidung: vollständigen Sync beibehalten (02.10.2026)

Der Betreiber hat ausdrücklich den aktuell abgesicherten vollständigen Abgleich
für Release 27 bestätigt. Bestehende Web-Listener und Android-FULL-Pull bleiben;
Delta wird nicht aktiviert, kein neuer Lesepfad, keine Cursor-/Datenmigration und
kein unnötiger Architekturumbau für R27. Die vorhandene inaktive Delta-Grundlage
ist eine spätere Optimierung und setzt belastbare Vollständigkeits-, Overlay-,
Wiederaufnahme- und Konfliktnachweise voraus.

Ältere Delta-Gates in diesem Dokument beziehen sich ab jetzt auf diese spätere
Optimierung, nicht auf die R27-Freigabe. Bestehende Owner-, Preiswahl-, Outbox-,
Offline-/Multi-Client- und Regressionstests bleiben erforderlich. Dieser Beschluss
ist kein Beleg für verzögerungsfreien Sync und keine Signing-/Deploymentfreigabe.

### Aktueller lokaler Zwischenstand: aktiver FULL-Sync über Offline-Wiederaufnahme

**12/12 echte Android-SDK-Fälle PASS**, inklusive neuem privatem Binder mit
ursprünglicher Outbox-Mutation: Zwei Offline-Worker-Versuche vor/nach echtem
Datei-Room-Reopen bewahren alle 14 Tabellen; erst nach tatsächlicher
SERVER-Autorisierung folgen Commit, ACK und vierteiliger FULL-Pull. Der zweite
Online-Lauf bleibt in Room und remote vollständig idempotent. Unabhängige
vollständige Admin-Zustände vor/nach jedem Fall und 13 nominelle Googlekonten
bestätigt; keine zusätzlichen Rechte, Sidecars oder geänderten früheren Owner.

Gesamtlauf 91,365 s, neuer Fall 4,094 s; 16 reine Nachweisprüfer PASS. Beleg:
`outputs/collection-sync-session-local/2026-10-01T22-27-50-753Z-8fc2d585e11e4d0881894a53d65a83f2/`.
Ports/Reverse/Instrumentierung anschließend frei, Eingaben unverändert. Frische
Web-Regression **1285/1285 PASS** in 78 Dateien, 34,68 s:
`outputs/release-local/2026-10-01T22-30-01-188Z-19892.{json,log}`.
Vorhandene act/Canvas-/SDK-Warnungen bleiben. Nur Testvertrag und Dokumentation
ergänzt, Web-/Android-Produktcode und Regeln unverändert. Kein Deployment, Signing
oder Releasepaket. Der Nachweis umfasst weder Prozessneustart noch automatische
OS-/WorkManager-Zustellung, große FULL-Zyklen oder komplette Mehrgeräteabdeckung.

### Vorheriger lokaler Zwischenstand: Hinzufügen mit echten lokalen SDK-Transaktionen

Der bestehende Private-Operations-Starter bewahrt alle 31 bisherigen Fälle und
ergänzt zwei echte Web-Client-Fälle: `addExactCard` legt Menge 2/Revision 1 an und
erhöht dieselbe Druckvariante auf Menge 5/Revision 2. Ein anderes eindeutig
positives Produkt am selben bisherigen UUID-Schlüssel wird mit leerer sowie
veralteter Clientliste abgelehnt; sämtliche bestätigten Serverfelder bleiben
unverändert. Die Produkt-ID-/UUID-Kollision wird vorab ausdrücklich geprüft.

**33/33 echte lokale SDK-Fälle bestanden**, 35,906 s Testzeit; kompletter isolierter
Lauf 49,818 s. Sieben geordnete unabhängige Admin-Zustände über die beiden neuen
Fälle, vollständige Dokumentvergleiche, bestätigte nicht-pendente Clientreads und
gezielte Bereinigung bestanden. Neue Google-Testkonten hatten nur `appAccess:true`,
keine Admin-/Pretesterrechte. Alle Ports anschließend frei, gehashte Eingaben
unverändert. Beleg:
`outputs/private-operations-local/2026-10-01T19-19-46-837Z-635450bc/manifest.json`
und beide `web-add-*-proof.json` desselben Ordners.

17 reine Sicherheitsprüfungen des Starters, Typecheck und gezielter Oxlint PASS.
Der anfängliche Lintbefund im neuen Nachweisprüfer wurde durch einen getrennten
Prüfhelfer korrigiert, ohne Regeln zu unterdrücken. Erneute vollständige lokale
Web-Regressionssuite **1285/1285 PASS**, 78 Dateien, 24,58 s:
`outputs/release-local/2026-10-01T19-21-37-030Z-13684.{json,log}`.
Vorhandene React-act/Canvas-/SDK-Deprecationwarnungen bleiben sichtbar.

Nur Tests, Starter und Dokumentation verändert; Produktcode, UUID, Schema,
Zugriffsregeln und Konfiguration unverändert. Kein Deployment oder neuer
Produktionsbuild. Der separate Android3/Web2-Preisrundlauf bleibt unverändert.
Kein Nachweis über Browserklicks, automatische Android-Workerplanung, Produktion
oder vollständige Preisdaten. Gesamtrelease weiterhin **NOT READY**.

### Vorheriger lokaler Zwischenstand: echte SDK-Synchronisationsgrenzen

Der bestehende lokale Teststarter prüft jetzt sieben Android-SDK-Fälle mit acht
rein künstlichen Google-Testkonten. Neu abgesichert: Ein echter noch unbestätigter
SDK-Schreibstand darf den Wiederaufnahme-Eintrag nicht entfernen; nach Bestätigung
muss er korrekt konvergieren. Außerdem übernimmt der echte private Binder-Worker
eine unveränderte Platzierung in einem späteren Durchlauf, sobald deren zuvor
fehlende Karte durch einen zweiten berechtigten SDK-Client angelegt wurde.

**7/7 SDK-Fälle bestanden**, zusätzlich sieben vollständige Admin-Vorher- und
Nachher-Prüfungen, zehn reine Prüfprogramm-Tests und gezielte Lintprüfung. Lauf:
`outputs/collection-sync-session-local/2026-10-01T18-53-04-230Z-52fcb2bc3e124af5be3ea075fe3cd920/`.
Alle Ports wieder frei, Weiterleitungen leer, Android-Testlauf beendet, Eingaben
unverändert. Der fehlende Parent ist bewusst ein lokal administrativ vorbereiteter
Altzustand; normale Client-Regeln erlauben kein solches Anlegen einer verwaisten
Platzierung. Keine Behauptung über automatische Planung, UI-Latenz oder Produktion.

Nur Teststarter und Dokumentation erweitert, keine Web-Funktion, Firebase-Regel
oder Produktkonfiguration geändert. Kein Deployment. Gesamtrelease weiterhin
**NOT READY**. Details und APK-Nachweis im README des Teststarters.

### Vorheriger lokaler Zwischenstand: widersprüchliche Produkte und Hinzufügen

Gleiche rohe Varianten-ID, gleicher normalisierter Finish und exakt gleiche volle
Druckbeschreibung dürfen nicht abhängig von der Quellreihenfolge verschiedene
Cardmarket-Produkte liefern. Die Auflösung prüft deshalb sämtliche positiven
Rohdeklarationen dieser Gruppe. Ein bereits intern widersprüchlicher Nachbar darf
seine widersprechende ID nicht verstecken. Andere Oberflächen, Größen, Untertypen,
Stempel, Folien und rohe IDs bleiben getrennt. Keine Root-/Geschwisterpreis-Vererbung;
fehlende Metadaten werden nicht durch einen Nachbarpreis ersetzt.

Beim Hinzufügen wird der tatsächlich innerhalb der Transaktion gelesene Eintrag
nochmals mit `samePrinting` geprüft. Die vorhandene deterministische UUID enthält
keine Produkt-ID; ein kollidierender Schlüssel darf deshalb nicht ungeprüft eine
andere Druckvariante hochzählen. Bei Konflikt keine Schreiboperation und keine
Erfolgsmeldung. Eindeutige Legacy-/Nullprodukt-Regeln bleiben unverändert; keine
Migration, UUID-, Schema- oder Regeländerung.

Nachgewiesene Quellgruppen: `sv10-096`, `sv03-125`, `sv10.5b-034`, jeweils beide
Reihenfolgen und gesunde Geschwister. 18 neue Produkt-Tests plus acht Tests über die
echte `addExactCard`-Transaktionsfunktion mit mechanischem SDK-Double. Das Double
ist **kein** zusätzlicher echter Firebase-Transaktionstest. RED: acht gezielte
Produktfehler und drei Transaktionsfehler; nachher **1.285/1.285 PASS**, 78 Dateien:
`outputs/release-local/2026-10-01T18-14-34-916Z-2444.{json,log}`.
RED-Belege: `2026-10-01T18-13-32-469Z-21664` und
`2026-10-01T18-05-47-423Z-22848` im selben Ordner.

Typecheck, gezielter Oxlint und zehn Auswahlverträge PASS; Katalog-/Runtime-Suite
**103/103** (`outputs/public-catalog-cache/2026-10-01T18-17-56-238Z-7244.log`).
Bestehende lokale SDK-Regression **31/31**, 34,58 s, alle eigenen Ports danach frei:
`outputs/release27-engineering-20261001/security-gate10-deletion/run-20261001-201918-8e5d6ac7/`.
Der zuvor abgebrochene Windows-PowerShell-5-Start scheiterte vor Testbeginn an einer
CLI-Deprecation auf stderr; Wiederholung mit bestehendem PowerShell 7 erfolgreich.

Isolierter Produktionsmodus-Build: **37,711 s**, 303 Quelldateien, keine privaten
Env-Dateien, keine Veröffentlichung. Root-dist und neun Build-/Deploymentdateien
unverändert (`fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`);
Belege `outputs/release27-engineering-20261001/baseline/build-cross-row-identity-final*`.
Bestehende Test-/SDK-Deprecations bleiben; kein Produktions-/Signing-/Rules-Zugriff.
Gesamtrelease weiterhin **NOT READY**.

### Vorheriger lokaler Zwischenstand: vollständige Druckbeschreibungen

Die Web-Identität übernimmt jetzt die vorhandenen Rohfelder `subtype`, `stamp`
und `foil` in fester Reihenfolge, statt unterschiedliche Drucke allein auf
`size` zu reduzieren. Stempel werden getrimmt, ohne Beachtung der Großschreibung
dedupliziert und deterministisch sortiert. Der öffentliche Katalogcache behält
zusätzlich `subtype`; private Providerfelder bleiben ausgeschlossen. Vollständig
vorangereicherte Beschreibungen bleiben erhalten, auch wenn dieselben vollständigen
Marker unterschiedliche Großschreibung oder äußere Leerzeichen haben. Kein
Teilwort-/Namensmatching, keine Migration gespeicherter Einträge oder neue UUID-Regel.

13 Tests mit Rohmetadaten-Auszügen aus dem eingefrorenen Snapshot (`base1-1`,
`sv03-062`), unabhängigen Android-Labeln und Plattform-MD5-Referenz reproduzierten
zunächst zehn Fehler. Sie prüfen getrennte UUIDs, gleiche Produkt-ID bei verschiedenen
Drucken, Legacy-ID-Aliase, Shared-DTO und kalten/warmen Cache. 18 zusätzliche
synthetische Kompatibilitätsfälle reproduzierten sieben doppelte Marker.
Final **1.259/1.259 PASS**, 76 Dateien, keine Skips:
`outputs/release-local/2026-10-01T17-55-33-246Z-15392.{json,log}`.
RED-Belege: `2026-10-01T17-42-02-464Z-3180` und
`2026-10-01T17-54-04-183Z-17576` im selben Ordner.

Typecheck, fokussierter Oxlint und zehn Launcher-Verträge bestehen. Die isolierte
Katalog-/Runtime-Auswahl besteht **103/103** (`outputs/public-catalog-cache/2026-10-01T17-51-32-348Z-6760.log`).
Echte lokale SDK-Regression: **31/31**, Rules unverändert, eigene Ports anschließend
frei (`outputs/release27-engineering-20261001/security-gate10-deletion/run-20261001-195601-3e7235bb/`).
Isolierter Produktionsmodus-Build: **13,825 s**, 303 Quelldateien, synthetische
Umgebung ohne private Env-Dateien. Root-dist und neun Konfigurationsdateien behalten
Integritätshash `fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`.
Buildbelege: `outputs/release27-engineering-20261001/baseline/build-printing-descriptor-final*`.

Das ist keine Vollgarantie für physische Druckmetadaten, aktuelle Preise oder
bereits mehrdeutig gespeicherte Altbestände. Normale bisherige Labels und
Absent-size-Fallbacks bleiben unverändert; keine pauschale Parität für hypothetische
abweichende Quellformate behaupten. Bestehende React-act/Canvas-Testwarnungen bleiben.
Keine Produktionskonten, kein Deployment, keine Rules-/Signing-/Releaseänderung.
Gesamtrelease weiterhin **NOT READY**.

### Vorheriger lokaler Zwischenstand: wiederverwendete Druck-IDs beim Hinzufügen

`collectionSyncIdForExactCard` akzeptiert dieselbe rohe Varianten-ID nicht mehr
als alleinigen Gleichheitsbeweis. Zusätzlich muss die bereits aufgelöste
Variantenbeschreibung übereinstimmen; ein bekannter Produkt-ID-Widerspruch wird
vor diesem Kurzpfad geprüft. Eindeutige vorhandene ID-/Legacy-Aliase bleiben
erhalten. Bestehende Einträge werden weder migriert noch verändert; Transaktion,
UUID-Verfahren, Schema und Regeln sind unverändert.

Reproduktion über echte Produktfunktionen: **1.224 PASS / vier gezielte FAIL**;
nach der Korrektur **1.228/1.228 PASS**, einschließlich der identischen normalen
und besonderen Drucke als Kontrollen. Artefakte:
`outputs/release-local/2026-10-01T17-35-21-319Z-21756.{json,log}` und
`outputs/release-local/2026-10-01T17-36-52-001Z-22180.{json,log}`.
Typecheck und gezielter Oxlint bestehen. Isolierter Produktionsmodus-Build:
12,734 s, 303 Dateien; Root-dist und neun Build-/Deploymentdateien unverändert
(`outputs/release27-engineering-20261001/baseline/build-printing-merge-guard*`).

Grenze: Diese Fälle verwenden bereits vollständige Beschreibungen im `size`-Feld.
Die separate Übernahme roher `subtype`-/`stamp`-/`foil`-Metadaten ist damit noch
nicht bewiesen oder korrigiert; der zusätzliche Paritätsbefund wird getrennt
bearbeitet. Kein Firebase-/Produktionszugriff, keine Veröffentlichung.
Gesamtrelease weiterhin **NOT READY**.

## Geltungsbereich und belastbarer Stand

- Eingefrorene Web-Baseline: `6caa46a`; Android-Baseline des übergeordneten Runs:
  `53b4e40d`. Die Baseline enthält bereits vor diesem Run vorhandene Änderungen.
- **Im initialen Baseline-Prüfabschnitt umgesetzt:** ausschließlich typkorrekte Test-Fixtures,
  eine Laufzeit-Typprüfung für den Select-Test und korrekte synchrone Registrierung
  der neun `node:test`-Regeltests. Keine Assertion abgeschwächt, keine Suppression.
- **Gate 2 danach lokal implementiert, noch nicht veröffentlicht:** verteilter
  UID-Schreib-Limiter, serverseitige Revalidierung der Rollenvergabe, zugehöriger
  exakter Kontolösch-Cleanup und Packaging-Importfix. Spätere gezielte Preis-/Sharing-
  Korrekturen sind unten getrennt dokumentiert; dies ist kein vollständiger
  Skalierungs- oder zentraler Preisversorgungsumbau.
- **Gate 3 danach lokal implementiert, noch nicht aktiviert:** optionale
  App-Check-Beobachtung, Default-off; keine neue Zugangssperre oder Enforcement.
- **Gate 4: isolierter Listener-Lifecycle-Fix lokal implementiert:** Preiswahl-
  Abonnement erst nach App-Freigabe, veraltete Callbacks abgefangen und expliziter
  Wiederverbindungsbutton. Die vorhandenen Owner-Listener verarbeiten jetzt
  inkrementelle SDK-Dokumentänderungen; die Remote-Queries bleiben unverändert.
  Noch keine paginierte allgemeine Initial-/Delta-Sync-Architektur.
- **Gate 6: Preisparität lokal implementiert, nicht deployed:** bestätigte
  Alternativpreise sowie bestehende geprüfte Katalog-/Guide-Ergänzungen auch in
  freigegebenen Bindern; getrennte Preis-Opt-ins und öffentliche DTO-Grenzen bleiben.
- Kein Deployment, kein produktiver Firebase-Zugriff, keine Rollenänderung, kein
  Google-Play-Aufruf und kein Android-Build durch diesen Web-Prüfabschnitt.
  Aus vorhandenem Quellcode folgt keine Behauptung über den derzeitigen Live-Stand.

## Lokale Baseline-Verifikation

Alle Zeiten sind lokale Messungen dieses Rechners, keine Nutzer-Latenzen.
Vitest lief mit `envDir: false` und einer Test-Setup-Sperre für echte Fetch-,
TCP- und TLS-Verbindungen. Private `.env`-Dateien wurden nicht gelesen.

| Prüfung | Ausgangszustand | Nach Testkorrektur |
| --- | --- | --- |
| TypeScript `tsc --noEmit --incremental false` | 1 Fehler im Select-Test | 0 Fehler; 18,80 s |
| Oxlint | 26 Fehler, ausschließlich Testcode | 0 Fehler; 6,85 s; erneuter Lauf nach Registrierungskorrektur ebenfalls 0 |
| Paket-Testauswahl | 48 Dateien, 611 Tests bestanden | 48 Dateien, 611 Tests bestanden; 26,34 s |
| Zusätzliche Vitest-Tests | 7 Dateien, 76 Tests bestanden | 7 Dateien, 76 Tests bestanden; 2,83 s |
| Zusätzliche Node-Tests | 7 Tests bestanden | 7 Tests bestanden; ca. 0,15 s |
| Gezielte Wiederholung | — | 7 Dateien, 86 Tests bestanden; bereits in obigen Zahlen enthalten |
| Legal-Prebuild-Prüfung | bestanden | kein Produkttext dafür verändert |
| Isolierter Vinext-Build | separat geprüft | Exit 0; 20,413 s |

Damit sind **694 unterschiedliche Nicht-Emulator-Tests** grün. Die neun
`sharing-live-rules`-Tests und weitere Firebase-Regel-/Auth-Emulatortests sind
**nicht** in dieser Zahl enthalten; deren Ergebnisse gehören in den separaten
Security-Gate-Bericht. Die neun Sharing-Regeltests wurden nach der unten genannten
Korrektur durch den Security-Prüflauf erneut ausgeführt: **9/9 bestanden**.
Ein zunächst eingeführtes sequenzielles `await test(...)`
löste vorzeitig den globalen Cleanup aus; es wurde durch synchrone Registrierung
mit `void test(...)` ersetzt; die erneute Emulatorprüfung bestätigte den Fix.
Bestehend: React-`act`-Warnung im Sammlungspreis-Test, kein Testfehler.

### Sicher isolierter Build

Die bestehende `vite.config.ts` ruft ausdrücklich `loadEnv(mode, process.cwd(), '')`
auf; auch die Vinext-CLI lädt Dotenv. Deshalb wäre `envDir: false` allein hier keine
ausreichende Isolation. Es wurden 294 ausgewählte Source-/Config-/Asset-Dateien in
eine frische Temp-Kopie übernommen, **keine** privaten `.env`-Dateien. Installierte
Dependencies wurden über eine lokale Junction wiederverwendet, nicht aktualisiert.
Vite-/Next-Konfiguration und Produktquellen blieben unverändert.

Die Kindprozess-Umgebung war bewusst neu aufgebaut: künstliche
`demo-domidex-build`-Firebase-Clientwerte, `https://example.invalid`, leere
HOME-/APPDATA-Verzeichnisse, deaktivierte Wrangler-Metriken, gesperrte Node-Netzwege
und keine geerbten Cloud-Zugangsdaten. Der optionale Windows-`net use`-Probe von
Vite meldete kontrolliert „nicht verfügbar“, ohne Benutzer-Netzlaufwerke abzufragen.
Es wurde nur `vinext build`, kein Deploy-Helper ausgeführt.

- Erfolgreich: Client-/Server-Referenzanalyse, RSC-, Client-, SSR-Build und
  `dist/standalone/server.js`.
- Warnungen: ein oder mehrere minifizierte Chunks über 500 kB, Plugin-Laufzeitanteile,
  `punycode`-Deprecation. Nicht durch erhöhte Warnschwellen unterdrückt.
- Ergebnis: **Kompilierbarkeit bestätigt**, nicht Cloud-Authentifizierung,
  Produktions-Routing, Vollständigkeit aller dynamisch geladenen Backend-Dateien
  oder Startfähigkeit des fertigen Deployment-Containers.
- Die synthetische Ausgabe darf **nicht veröffentlicht** werden.
- Nachweise: `outputs/release27-engineering-20261001/baseline/`:
  `unit-fixed-results.json`, `extra-fixed-results.json`, `node-fixed.log`,
  `typecheck-fixed.log`, `lint-test-registration-fixed.log`,
  `build-isolated.log`, `build-isolated-result.json` und die Isolationsskripte.
  Der genaue temporäre Ausgabeort steht in `build-isolated-result.json`.

## Bestehende Authentifizierungs- und Servergrenzen

- `lib/server/private-cloud-operations.ts` delegiert Node-only-Vorgänge dynamisch
  an `backend/security/routes.mjs`. Das Deployment muss diesen Backend-Pfad mitliefern.
- `backend/security/firebase.mjs: actorFor` prüft das ID-Token mit Revocation-Check,
  aktuellen Auth-Nutzer, aktuelle Claims, `accountAccess` und Löschsperre. Rollen
  sind explizit; `scannerLabAccess` ist keine allgemeine Adminrolle.
- `lib/server/firebase-token.ts` verwendet für privilegierte Anforderungen die
  aktuelle Backend-Autorisierung. Die ebenfalls vorhandene reine JWT-Prüfung darf
  nicht als schnellere Alternative für diese Rechteprüfung eingesetzt werden.
- `backend/security/access.mjs: changeRole` verwendet eine Firestore-Lease,
  widerruft beim Entzug Refresh-Tokens und überprüft die Änderung. Diese
  Sicherheitsgarantien dürfen durch Latenzoptimierung nicht geschwächt werden.
- `lib/server/server-failure.ts` liefert begrenzte Fehlercodes/Fehler-ID; die
  Backend-Fehlerhülle lautet `{ ok: false, error: CODE }`. Vollständige, vergleichbare
  p50-/p95-Messungen und Cache-Hit-Zähler sind noch keine nachgewiesene Baseline.

### Repository-übergreifender Functions-Drift — aktuelles Risiko

Die Android-Kopie `CardVault/functions/index.js` und der Web-Pfad
`backend/scan-knowledge/index.js` enthalten beide `aggregateScanKnowledge` und sind
über die jeweilige `firebase.json` für dieselbe Functions-Codebase `default`
vorgesehen. Im Web-Pfad schützt `isCurrentEvidence` die Verarbeitung anhand des
aktuellen Dokuments und der Account-Löschsperre; in der Android-Kopie fehlt dieser
Guard. Ein späterer undifferenzierter Deploy aus Android könnte somit den
abgesicherten Funktionsstand überschreiben. Nicht jetzt blind angleichen/deployen.

Gate 9 muss eine kanonische Backend-Verantwortung samt genau einem freigegebenen
Deploy-Quellpfad festlegen und Drift technisch prüfen. Bis dahin gilt: Der hier
geprüfte Web-Guard ist die Sicherheitsreferenz, aber noch keine automatisch
verliehene Deploy-Freigabe oder abschließend beschlossene Repository-Zuständigkeit.

## Gate 2: minimaler Rate-Limit-Vertrag — implementierter lokaler Quellstand

Nach drei gezielt roten Backend-Regressionen wurde `backend/security/rate-limit.mjs`
implementiert: Upload **5/10 Minuten**, Share-Erstellung **20/Stunde**, Rollenvergabe
**30/Minute**, jeweils pro verifizierter UID und eigener Policy. Defaults und
Grenzen sind serverseitig konstant. Der technische Source-Stand ist kein Nachweis
für produktiv aktives Enforcement. OpenAPI-Teilcontract: `openapi.release27.yaml`.

**Operative Einschränkung:** Nur der Modus ist per Umgebungsvariable konfigurierbar;
die drei Zahlenwerte sind derzeit Source-Konfiguration, keine laufzeitveränderbare
Operator-Konfiguration. Insbesondere darf ein Limit nicht blind unter einen
bereits gespeicherten Zähler abgesenkt werden: der aktuelle Integritätscheck würde
das als ungültigen Zustand mit 503 ablehnen. Eine spätere dynamische Konfiguration
benötigt validierte, versionierte Policies und ein getestetes Migrationsverfahren:
laufende Fenster mit ihrem bisherigen Limit auswerten, neue Grenzen erst im nächsten
Fenster aktivieren; kein vorzeitiges Budget-Reset bei Rollout/Rollback. Dieser
Migrationsvertrag ist ein Vorschlag, **noch nicht implementiert**. Die gegenwärtigen
Limits während eines laufenden Fensters nicht ändern.

1. Gemeinsamer Vertrag:
   `consumeWriteQuota(context, policyId, verifiedActorUid)`; Erfolg oder sicherer
   Fehler mit Status/Retry-After.
   UID ausschließlich aus der bestehenden, aktuellen Server-Autorisierung;
   niemals aus Body, E-Mail oder ungeprüften Headern. Policies serverseitig festlegen.
2. Firestore-Transaktion pro Policy/UID statt prozesslokalem Zähler oder globalem
   Hotspot. Ein Dokument `privateWriteRateLimits/{policy}_{sha256(policy + NUL + uid)}`
   mit gedeckeltem Zähler; keine rohe UID/E-Mail/IP im Dokument. Fensterbeginn kommt
   aus Firestore-`readTime.toMillis()`, nicht Clientzeit oder lokaler Prozessuhr.
   Zeitfenster werden atomar geprüft/erneuert. `expiresAt` = Fensterende + 24 Stunden;
   **keine TTL-Policy wurde eingerichtet**. TTL ist kein Freischaltmechanismus.
   Wiederholte Transaktions-Callbacks dürfen keine externen Nebenwirkungen auslösen.
3. Zunächst nur teure authentifizierte Mutationen, nicht blind jeden Scanner-,
   Karten- oder Sync-Request mit einem zusätzlichen Firestore-Roundtrip versehen.
4. Implementierte Integrationspunkte: `images.mjs: uploadReport` nach Tester-Autorisierung
   und vor Binärverarbeitung; `sharing.mjs: createBinderShare` nach Auth/kleinem
   Body/Ownership und vor Erstellung; Rollenvergabe nach Admin-Prüfung und vor
   Lease/Claims. Direkte Backend-Aufrufe sind damit ebenfalls abgesichert.
   Der Review-PATCH des Scanner Labs ist **noch nicht** limitiert.
5. Widerruf, Kontolöschung und Rechteentzug dürfen nicht an einer ausgeschöpften
   Upload-/Erstellungsquote hängen und rufen den Limiter nicht auf. Auch fehlerhafte
   Mode-Konfiguration wird erst beim limitierten Write geprüft, nicht beim Revoke.
6. HTTP 429, ganzzahliger `Retry-After`, `Cache-Control: private, no-store`, kompatible
   Hülle `{ ok: false, error: "RATE_LIMITED", retryAfterSeconds: 30 }`. Der zentrale
   Fehlerpfad und der Admin-PATCH erhalten diesen Vertrag. Infrastrukturfehler
   bleiben 503, fehlende Rechte 401/403, keine irreführende Neuanmeldung wegen 429.
   Kein automatischer POST-Retry bei ungewissem Erstellungsergebnis.

`DOMIDEX_WRITE_RATE_LIMIT_MODE`: **monitor** ist der Default; verbraucht Budgets und
meldet Überschreitungen ohne Ablehnung. **enforce** gibt bei Überschreitung 429
zurück. **off** führt keine Budget-DB-Anfrage aus. Unbekannte Werte schlagen bei
limitierten Writes sicher mit 503 fehl. Monitor erlaubt keine grenzenlose
Umgehung bei Infrastrukturfehlern: auch dort 503. Produktionsaktivierung dieser
Stufen ist ausdrücklich noch nicht erfolgt.

Monitor/Enforce verursachen pro zugelassenem Versuch üblicherweise zwei
transaktionale Dokumentreads (Budget und Löschsperre) plus einen Write; bei
erschöpftem Fenster keinen zusätzlichen Budget-Write. SDK-Retries können Reads
wiederholen und Latenz/Kosten erhöhen. Beobachtungsereignisse werden erst nach
der Transaktion ausgegeben und enthalten ausschließlich Event, Policy und Mode,
keine UID-/Hash-/Token-/IP-Labels. Eine operative TTL-/Retention-Entscheidung für
inaktive Nutzer bleibt erforderlich; ohne TTL bleiben maximal drei Dokumente pro
UID erhalten. Die bestehende Kontolöschung entfernt exakt diese drei Hash-Refs,
nicht fremde Budgets. Der Löschlock wird innerhalb derselben Quota-Transaktion
gelesen, damit laufende Quota-Writer gelöschte Datensätze nicht neu anlegen.

Rollenänderungen nehmen intern nun die Bearer-Autorisierung statt einer bloßen
Actor-UID entgegen. `actorFor(..., 'admin')` im Backend liefert die Audit-UID.
Öffentliche PATCH-Payload und bestehende Lease-/Claim-/Widerrufslogik bleiben gleich.
Alle Source-Aufrufer inklusive Helfer/Tests wurden gesucht; kein CLI-Aufrufer
dieser internen Funktion gefunden. Tokens werden nicht protokolliert.

Der aktuelle `scripts/package-private-operations.mjs` paketiert nun auch
`rate-limit.mjs` sowie den zuvor fehlenden `cardmarket-identity`-Import des Domain-
Moduls. Ein sauberer Temp-Package-Test importiert alle privaten Routen ohne alte
dist-Dateien, private Env oder Cloud-Verbindung. Der historische
`scripts/prepare-sharing-release.mjs` bleibt **unverändert und nicht freigegeben**:
sein enger Kopierpfad enthält die neuen Rate-/App-Check-Module nicht und nutzt eine archivierte
Löschimplementierung/Containerbasis von September. Keine package.json-/Source-
Aufrufkette auf diesen Alt-Packer gefunden; manuelle Nutzung ist nicht ausgeschlossen.
Vor Nutzung ist eine eigene Migrations-/Paketierungsentscheidung erforderlich.

**IP-Trust-Risiko:** Hosting-Rewrite auf Cloud Run beweist noch keine vertrauenswürdige
Client-IP-Kette. Niemals den ersten `X-Forwarded-For`-Eintrag ungeprüft übernehmen;
vorgelagerte Proxys können vom Client gesendete Werte enthalten. Vor anonymem
Rate-Limiting zuerst tatsächliche Ingress-/Proxygrenze prüfen. Kein unbeschränkter
Firestore-Eintrag pro anonymer Anfrage/IP als neue Kosten-/DoS-Fläche.
Damit ist nur der enge Vertrag für die drei authentifizierten Schreib-Policies
implementiert; **keine vollständige Rate-Limit-Abdeckung** aller öffentlichen
Reads, Scanner-Review-Mutationen, IPs oder Tokens. Diese verbleibt in Gate 6.

Grundlagen: [Firestore-Transaktionen](https://firebase.google.com/docs/firestore/manage-data/transactions),
[TTL-Verzögerung](https://firebase.google.com/docs/firestore/ttl),
[Google-Load-Balancer und X-Forwarded-For](https://docs.cloud.google.com/load-balancing/docs/https#x-forwarded-for_header).

### Gate-2-Nachweise auf dem kombinierten lokalen Stand

Zusätzlich zur Quota-Implementierung begrenzt der Security-Prüfabschnitt sechs
bisher unbegrenzte JSON-Leser: Tester POST/PATCH 4 KiB, Report-DELETE 4 KiB,
Review-PATCH 32 KiB, Scanner-Profil-POST 1 MiB, Site-Content-PUT 4 MiB.
Autorisierung bleibt vor dem Einlesen; maximale gültige Feldwerte bleiben erlaubt.
Die zugehörigen 58 Tests enthalten echte Streams ohne bzw. mit falschem
Content-Length, UTF-8-/Escape-Grenzen, Auth-Reihenfolge und gültige Maximalpayloads.

| Nachweis am 01.10.2026 | Ergebnis |
| --- | --- |
| Paket-Testauswahl + Quota/Package + JSON-Grenzen | 52 Dateien, **690/690**; 16,61 s |
| Zusätzliche Vitest-Auswahl | 7 Dateien, **76/76**; 1,03 s |
| Zusätzliche Node-Tests | **7/7**; 0,10 s |
| Typecheck / Lint | beide Exit 0 |
| Auth/Firestore/Storage-Emulator | **30/30**, keine Skips; 40,09 s |
| Frischer isolierter Vinext-Build | 295 Dateien; Exit 0; 37,125 s |
| OpenAPI-Teilcontract | YAML geparst; alle 24 lokalen Referenzen aufgelöst |

Das sind **773 unterschiedliche Nicht-Emulator-Tests**. Die 30 Emulator-Tests sind
separat: 27 bestehende private Operationen und drei neue echte Firestore-Tests.
Zwei unabhängige Admin-SDK-Instanzen erhalten bei zwölf parallelen Upload-Versuchen
zusammen exakt fünf Budgets; sieben Versuche werden begrenzt. Zusätzlich sind
Fensterablauf und Löschlock-Rennen gegen wieder entstehende Quota-Daten geprüft.
Die Quota-Dokumente werden bei Kontolöschung einschließlich Wiederholung nach
Teilfehlern entfernt, fremde UID-Dokumente bleiben bestehen.

Transparenz zum ersten kombinierten Lauf: Während gleichzeitig Build und
Typecheck liefen, bestanden 688/690 Tests; zwei bestehende UI-`waitFor`-Assertions
(Sharing-Link und Sammlungspreis-Retry) überschritten ihre kurze Wartegrenze.
Der unmittelbar folgende vollständige Lauf ohne konkurrierenden Build bestand
690/690 **ohne** Test-/Timeout-/Produktcodeänderung. Lastabhängige Testinstabilität
bleibt ein CI-Hinweis, nicht als verschwundener Produktfehler dargestellt.

Nachweise im oben genannten ignorierten Baseline-Ordner:
`unit-gate2-combined.log` (erster Lauf), `unit-gate2-combined-repeat-results.json`,
`extra-gate2-combined.log`, `node-gate2-combined.log`,
`typecheck-gate2-combined.log`, `lint-gate2-combined.log`,
`gate2-emulators.log`, `build-gate2-result.json` und `build-gate2.log`.
Keine dieser synthetischen Build-Ausgaben ist zur Veröffentlichung bestimmt.

## Gate 3: optionale App-Check-Beobachtung — lokaler Quellstand

`backend/security/app-check.mjs` beobachtet ausschließlich bereits autorisierte
Anfragen; `actorFor` prüft weiterhin zuerst Token-Widerruf, aktuellen Nutzer,
Claims, Rechte und Kontolöschsperre. App Check ist **kein** Login, keine Rolle und
keine Alternative zu Firebase Rules. Es gibt in diesem Gate keinen Enforcement-
Modus und keinerlei Console-/Projektaktivierung.

- `DOMIDEX_APP_CHECK_MODE=off|monitor`, Default **off**. Off initialisiert keinen
  App-Check-Verifier und erzeugt keine App-Check-Metrik. Ein fehlender Token im
  Monitor erfordert ebenfalls keine SDK-Initialisierung/Netzprüfung.
- Monitor benötigt `DOMIDEX_APP_CHECK_ALLOWED_APP_IDS`: komma-getrennte, exakt
  verglichene Firebase-App-IDs (Android/iOS/Web); höchstens 32, kein Wildcard,
  Paketname oder UID. Leere/fehlerhafte Konfiguration liefert nur `config_error`,
  ändert keine ansonsten erlaubte Antwort. `enforce` ist absichtlich ungültig.
- Optionaler Header `X-Firebase-AppCheck`, maximal **4096 Zeichen**, getrennt vom
  Bearer-Token. Syntaktisch fehlerhafte/überlange Header werden nicht verifiziert.
  Die vorhandene Admin-SDK-Version prüft Signatur, Issuer, Audience und Ablauf;
  danach erfolgt der exakte App-ID-Abgleich. Kein `consume`-/Replay-RPC.
- `services()` liefert den echten, lazy initialisierten SDK-Verifier derselben
  Firebase-App; nicht nur einen Test-Hook. Der Packer nimmt das neue Modul mit.
- Request-lokale `WeakMap` vermeidet eine zweite Prüfung beim erneuten Upload-
  Authcheck; keine UID-/Token-übergreifende Memoisierung. `authorize` behält ältere
  String-Aufrufer und akzeptiert zusätzlich den Originalrequest; abweichende
  Authorization-Header werden abgewiesen. Die Framework-Wrapper und sechs
  Admin-/Lab-Routen reichen den unveränderten Request einschließlich Header weiter.

Feste beobachtete Routen: manueller Report-Upload, reviewed-knowledge-POST,
eigene Binder-Freigaben GET/POST/DELETE, Account-Delete-POST, Tester GET/POST/PATCH,
Report GET/PATCH/DELETE und private Report-Bilder, Scanner-Profile GET/POST,
Scanner-Referenzen/Bilder GET, Site-Content-PUT. Öffentliche Shared-Binder-,
TCGdex-/Cardmarket-/Katalog-Reads bleiben ausdrücklich außerhalb. Interne
synthetische `/`-Requests werden nicht fälschlich als fehlende Client-Tokens gezählt.

Es wird höchstens einmal pro Request bis zu **250 ms zusätzlich gewartet**.
Dies ist ein Antwort-Wartebudget, **kein** Netzwerkabbruch: der aktuelle Firebase-
Admin-Verifier akzeptiert kein AbortSignal; ein angefangener Keyfetch kann im
Hintergrund weiterlaufen. Die JS-Ereignisschleife kann unter Last die Timerzustellung
zusätzlich verzögern. Späte Ergebnisse/Ablehnungen erzeugen keine zweite Metrik
und keinen unbehandelten Promise-Fehler. Der Metrik-Sink wird nicht abgewartet.
Dieser mögliche Monitor-Overhead muss vor manueller Aktivierung gemessen werden;
bei Default-off entsteht keine Attestierungswartezeit im Scanner-/Sharing-Pfad.

Metriken enthalten ausschließlich `event: APP_CHECK_MONITOR`, festen `route` und
`reason` (`valid`, `missing`, `invalid`, `wrong_app`, `timeout`, `unavailable`,
`config_error`). Kein Token, App-ID, UID, vollständiger Pfad/Query, Body, E-Mail,
IP oder unbearbeiteter SDK-Fehler. Die SDK-Fehlerklasse `invalid-argument` ist
breit; einzelne intern so klassifizierte Key-/Verifikationsfehler können deshalb
als `invalid` statt `unavailable` erscheinen. Keine Rohfehlermeldung zur heuristischen
Unterscheidung auswerten oder protokollieren.

Client-Aktivierung, Debug-/Play-Integrity-Provider und reale Geräteprüfung werden
separat im Android-Vertrag `CardVault/docs/RELEASE_27_APP_CHECK.md` geführt. Die
Web-App erhält in diesem Gate keinen neuen Client-Attestierungsprovider; fehlende
Web-/Altclient-Tokens sind im Monitor zu erwarten. Lokale Fake-Verifier beweisen
kein echtes Play-Attestierungsverdict. Noch kein produktiver Schutz behauptet.

### Gate-3-Verifikation und gemessene Grenze

Vor der Produktimplementierung: sechs gezielt rote Regressionen und zwei bereits
grüne Auth-/Off-Erwartungen, dokumentiert in `app-check-red.log`. Danach:

| Nachweis am 01.10.2026 | Ergebnis |
| --- | --- |
| App-Check-Vertrag, Runtime, Forwarding, Services | **52/52**, separat unabhängig ebenfalls 52/52 |
| Gesamtauswahl einschließlich Gate 2 und App Check | 56 Dateien, **742/742**; 19,13 s |
| Zusätzliche Vitest-/Node-Tests | **76/76 + 7/7**; 1,21 s / 0,12 s |
| Typecheck / Lint / `git diff --check` | Exit 0 |
| Frischer Package-Import | bestanden; App-Check-Modul enthalten |
| Isolierter Vinext-Build | 296 Dateien; Exit 0; 79,261 s |
| OpenAPI-Teilcontract | 28 lokale Referenzen aufgelöst; optionaler Header dokumentiert |

Damit **825 unterschiedliche Nicht-Emulator-Tests** auf dem Gate-3-Stand. Die 52
App-Check-Tests und der Paketimport sind bereits in 742 enthalten, nicht addieren.
Die oben genannten 30 Emulator-Tests stammen aus Gate 2 und wurden für Gate 3 nicht
nochmals ausgeführt. Signatur-/Geräteattestierung gegen Firebase/Play wurde nicht
aufgerufen. Frühere Mock-Aufrufererwartungen wurden auf den zusätzlichen
Originalrequest erweitert, ohne bestehende Auth-/Berechtigungsassertions zu entfernen.

Reine lokale Zusatzkosten des Monitors mit synthetischem Verifier, **ohne Auth und
ohne Netzwerk**: je 25 Anfragen mit Off/Missing/sofort gültigem Fake ergaben p95
0,023 / 0,067 / 0,079 ms. Off und Missing riefen den Verifier exakt nullmal auf.
Fünf hängende Fake-Prüfungen zeigten trotz 250-ms-Timerbudget unter Windows
**p50 263,69 ms, Maximum 264,15 ms**. Keine harte 250-ms-Wallclock-Zusage daraus
ableiten. Diese Messung ersetzt weder Firebase-Keyfetch-Latenz noch echte Geräte-
oder Produktions-p95-Messungen; die Build-Dauer ist ebenfalls nur lokale Laufzeit.

Nachweise: `unit-gate3-final-results.json`, `extra-gate3.log`, `node-gate3.log`,
`typecheck-gate3.log`, `lint-gate3.log`, `app-check-contract-green.log`,
`app-check-latency.json`, `build-gate3-result.json`, `build-gate3.log` im ignorierten
Baseline-Ordner. Keine produktive Aktivierung, kein Deploy und keine Signierung.

## Gate 4: isolierter Preiswahl-Listener-Lifecycle-Fix

Der Web-Preiswahl-Listener startete bisher bereits für eine bekannte UID, noch
bevor `hasAppAccess` bestätigt war. Ein terminaler Listener-/Registrierungsfehler
konnte für dieselbe UID bestehen bleiben: der bisherige Preis-Retry wiederholte
nur die Kartenpreisauflösung. Ein verspäteter Erfolgs-Callback einer alten
asynchronen Registrierung konnte außerdem den aktuellen Owner-State verdrängen.

Eng begrenzte Änderungen in `components/web-app.tsx` und
`components/use-collection-prices.ts`:

- Owner-UID erst bei bestätigtem App-Zugang an den Preiswahl-Hook übergeben.
- Erfolg, Fehler und Registrierungs-Cleanup an die aktive Effect-Generation
  binden, auch nach Entzug und erneuter Freigabe derselben UID.
- Eigener Retry-Zähler startet einen fehlgeschlagenen Preiswahl-Listener neu.
  Ein gesunder Listener bleibt bei reinen Kartenpreis-Retries bestehen.
- Sichtbarer Button „Preisauswahl erneut synchronisieren“, auch wenn die
  Marktpreisabrufe selbst erfolgreich waren.

**RED → GREEN:** Vor dem Produktfix am 01.10.2026, 03:56:10, bestanden im
gezielten 37-Test-Lauf 31 Tests; sechs neue Regressionen waren rot. Betroffen
waren Zugangsgating, fehlender UI-Retry, derselbe Owner nach Fehler/Freigabe,
verspätete alte Erfolge und fehlgeschlagene asynchrone Registrierung. Nach dem
Fix bestanden 37/37; der abschließende erweiterte Lauf bestand **88/88 in neun
Dateien**. Sieben neue Tests ergänzen die bestehende Auswahl; keine früheren
Testzahlen mit diesen überlappenden Läufen addieren.

Nachweisquellen: `tests/collection-prices.test.ts` und
`tests/web-app-polish.test.tsx` enthalten die neuen Regressionen. Die erweiterte
Auswahl umfasst außerdem `collection-price-selections.test.ts`,
`price-alternative-picker.test.tsx`, `auth-provider.test.tsx`,
`web-connection-state.test.tsx`, `web-collection-layouts.test.tsx`,
`private-binder-gallery.test.tsx` und `binder-sharing-owner.test.tsx`, jeweils
unter `tests/`. Maschinenlesbarer GREEN-Nachweis:
`outputs/release27-engineering-20261001/baseline/gate4-lifecycle-green-results.json`.
Der ursprüngliche RED-Lauf ist im Arbeitsprotokoll dokumentiert, nicht als
nachträglich erzeugtes Maschinenprotokoll ausgegeben.

TypeScript `tsc --noEmit --incremental false`, Oxlint und `git diff --check`
bestanden ebenfalls. Eine zunächst zu eng inferierte Owner-Prop im neuen Test
wurde explizit optional typisiert; keine Assertion oder Wartegrenze abgeschwächt.
Vitest nutzte weiterhin `envDir: false` und die Netzsperre.

**Grenze:** Dies sind lokale Hook-/Komponenten-Regressionsprüfungen, kein neuer
Full-Sync-, Firebase-Emulator-, echter Android/Web-Roundtrip- oder Live-Test.
Keine neue Persistenz, Pagination, Schema-/Regeländerung, allgemeine
Preisresolver-Optimierung, Signierung, Build oder Veröffentlichung. Der größere
Initial-/Delta-Sync-Vertrag bleibt ein separater Gate-4-Arbeitsschritt.

## Gate 4: inkrementelle lokale Snapshot-Verarbeitung

Die fünf bestehenden Owner-Datasets (Collection, Layouts, Preiswahl, private
Binder und Platzierungen) verwenden `docChanges()` statt einer Neudekodierung
aller Dokumente bei jedem Event. Queries, Regeln, Schema und Client-Persistenz
bleiben unverändert. Unveränderte Objekte werden weiterverwendet; veröffentlichte
Arrays/Maps werden bei Änderungen neu erstellt und später nicht mutiert.

SDK-Indizes beziehen auch ungültige Dokumente ein. Deshalb bleiben deren rohe
Positionen erhalten, während die UI nur erfolgreich dekodierte Einträge erhält.
Auch niedrigere Revisionen aus SDK-Rollbacks werden verarbeitet. Ein unabhängiges
Review fand einen Decoder-Ausnahmefall bei alten Daten: Ein solcher Eintrag darf
nicht die Verarbeitung aller nachfolgenden Änderungen unterbrechen. Drei neue
Regressionen waren zunächst rot und bestätigen jetzt die vollständige Erholung
nach einer Reparatur, ohne Listener-Neustart.

Nachweise: ursprünglich 16 RED / 16 GREEN vor der Optimierung, anschließend
61/61 Fokusfälle; nach dem zusätzlichen Reviewfix **64/64** Fokusfälle.
Typecheck, Lint und Diffprüfung bestehen. Die SDK-Adapter werden lokal mit
synthetischen Snapshot-Sequenzen geprüft, nicht mit einem produktiven Account.

Bei 1k/5k/20k Einträgen erzeugt eine einzelne Änderung jeweils einen `data()`-
Aufruf und ein neues dekodiertes Objekt statt N. Die Array-/Map-Projektion bleibt
O(N). Lokale synthetische Zeiten (0,118/0,443/1,837 ms gegenüber
0,086/0,265/4,810 ms beim minimalen kompletten Neuaufbau) belegen **keine pauschale
Latenzverbesserung**. Initiale Netzwerk-Reads und SDK-Speicherhaltung bleiben
unverändert; keine Heap-/Cloud-Kosteneinsparung daraus ableiten.

Rohbelege liegen im ignorierten `outputs/release27-engineering-20261001/baseline/`:
`gate4-incremental-red-results.json`, `gate4-incremental-scale.json` und
`gate4-incremental-review-{red,green}-results.json`. Frühere 789/789 aus
`gate4-incremental-full-results.json` stammen ausdrücklich vor dem Reviewfix.
Der erneute Root-Lauf nach Reviewfix und dem separat geprüften Guide-Snapshotfix
besteht **836/836 Tests in 57 Dateien**; Beleg
`gate4-and-price-root-final-results.json`. Neu angelegte bewusste RED-Proben zur
Root-Preisidentität gehören nicht zu dieser bestandenen Auswahl.

## Gate 5: konsistente Guide-Preissnapshots

`lib/server/cardmarket-anniversary-prices.ts` ersetzt beim Vorliegen eines neuen
gültigen Guide-Datensatzes nun alle zehn verwalteten Preis-/Zeitfelder gemeinsam.
Zuvor konnten fehlende `avg`-, `low`- und Vergleichsfelder aus dem älteren
TCGdex-Snapshot erhalten bleiben und mit dem neuen Guide-Datum erscheinen.
Identität, Nicht-Preis-Metadaten, Variantenfamilien und Quarantäne bleiben erhalten.

44 neue synthetische Regressionen ergänzen die bestehende Guide-Suite. Vorher
41 Fehler in 76 Fällen, danach **76/76 bestanden**, zusätzlich **165/165** in der
Preis-/Katalogauswahl. Der abschließende gemeinsame Root-Lauf besteht 836/836;
das umfasst auch den oben dokumentierten Snapshot-Listener-Reviewfix.
Ein fehlender/duplizierter/nicht erreichbarer Guide übernimmt weiterhin den
vorhandenen vollständigen Quellsnapshot unverändert, ohne ein neues Datum zu
erfinden. Fehlende echte Preise bleiben fehlend. Keine Providerdaten heruntergeladen.

Dies behebt weder sämtliche Preisabdeckung noch die separat untersuchte
Root-Produktvererbung oder gemeinsame zentrale Preisversorgung. Keine
Veröffentlichung oder Registry-Neuzuordnung durch diesen Snapshotfix.

Separater Classic-Nachzug: Die am 25.09.2026 bereits im Android-Projekt belegten
Zuordnungen `30th-c-002/005/018/019/020/023/025` wurden unverändert in die Web-
Registry übernommen. Dadurch sind dort 30 statt 23 Classic-Identitäten hinterlegt;
insgesamt 205 gepflegte Bridges. Die Quelle ist die bestehende Android-Dokumentation
`docs/catalog-30th-classic-cardmarket-20260925.md` mit Collectorlabel- und
Produktbild-ID-Prüfung. Dies ist kein neuer Live-Preisnachweis. Beide LEGEND-Hälften
bleiben getrennt; Sonderdrucke und fremde explizite Produkte werden nicht ersetzt.
Vorher 9/91 RED; nachher 152/152 in Guide-/Katalog-/Routentests bestanden, außerdem
Typecheck/Lint/Diffprüfung. Andere Zuordnungen wurden nicht geändert.

## Sharing, Domains und Preiswahl: bestehender Vertrag

- Kanonische öffentliche Domain: `https://domidex.web.app`; Sharing:
  `/share/{token}` und `/api/shared-binders/{token}`. Intern vorhandene
  `NEXT_PUBLIC_SITE_URL`-/Discord-Overrides müssen bei einem späteren Deployment
  geprüft werden. Aktueller Source-Fallback des Discord-Links:
  `https://discord.gg/fc9XgwtVTE`. Lokale/Preview-Domains nicht öffentlich einsetzen.
- `backend/security/sharing.mjs`: zufälliges 256-Bit-Linkgeheimnis; nur dessen
  SHA-256 wird gespeichert. Freigabe ist explizit, Optionen für Preis/Gesamtwert/
  Anzeigename standardmäßig aus. Empfänger benötigen für diese reine Linkansicht
  keinen Account; Besitzerrechte und Widerruf werden serverseitig erneut geprüft.
- Öffentliche DTO-Allowlist in `lib/shared-binder.ts`; keine Besitzer-UID,
  privaten Notizen oder beliebigen Bild-URLs. Native App-Link-Verifikation und
  Play-Zertifikat/Hosting-Association separat prüfen; historische Nachweise ersetzen
  keinen aktuellen Test. Kein Signing-/Domainwechsel in diesem Abschnitt.
- Sharing liest neun Plätze pro Seite, höchstens 5.000 Platzierungen, Katalog mit
  sechs parallelen Abrufen und gemeinsamer 12-s-Grenze. Mit freigegebenem Gesamtwert
  werden alle belegten Plätze aufgelöst. Große Binder benötigen einen Lasttest.
- Die zunächst bestätigte Abweichung beim Sharing-Katalogpfad ist lokal gezielt
  korrigiert: vorhandene Supplement-/Guide-Anreicherung und exakt gebundene
  `collectionPriceSelections` werden nach den unten beschriebenen Preis-Opt-ins
  berücksichtigt. Das ist kein Nachweis über den aktuell ausgelieferten Dienst;
  pauschale Preisvollständigkeit aller Karten bleibt ausdrücklich unbewiesen.
- Web-Preiswahl: `users/{uid}/collectionPriceSelections/{entrySyncId}`, Schema 1.
  Metadaten: `ownerUid`, `entrySyncId`, `revision`, `lastMutationId`, serverseitiges
  `updatedAt`, `updatedAtClient`, `cleared`. Preisidentität: `sourceSetId`,
  `sourceCardId`, `collectorNumber`, `language`, `finish`, `variant`, `productId`,
  `metric`, `amountMinor`, `currency: EUR`, `sourceAt`, `selectedAt`.
- Die sieben stabilen Metriken sind `normal_avg_sell`, `normal_low`, `normal_avg_1d`,
  `normal_avg_7d`, `normal_avg_30d`, `reverse_holo_avg_sell`, `reverse_holo_low`.
  Zurücksetzen erzeugt einen versionierten Tombstone mit genullten Preisfeldern.
  Keine zusätzliche personenbezogene Information erforderlich.
- `lib/collection-prices.ts` priorisiert einen gültigen Trendpreis; nur wenn er
  fehlt, darf die explizit gewählte, exakt identische Alternative greifen.
  Ein Netzwerkfehler ist nicht automatisch ein fehlender Trendpreis. Die UI
  bestätigt nicht vorausgewählt und kennzeichnet Abweichungen/Quellzeitpunkt.
- `lib/server/cardmarket-anniversary-prices.ts` ergänzt nur geprüfte Anniversary-
  Produktidentitäten; dies ist **kein Nachweis für jedes Set/jede Karte**.
  Identität/Variante/Produkt bleiben zwingend, kein Matching nur nach Name.

## Offene Abnahmekriterien vor produktiver Freigabe

### Lokaler Gate-5-Nachtrag: genaue Variantenidentität (2026-10-01)

Die Web-App erbt keine Cardmarket-Produkt-ID und keinen Preis mehr ungeprüft vom
Kartenwurzelobjekt. Auch eine einzige Variante ist kein Beleg: die lokal belegten
Paare `bw1-1`/`bw1-2` und `sm1-162`/`sm1-168` teilen jeweils eine problematische
Root-ID. Variantenpreis-ID und explizite `variant.thirdParty.cardmarket` müssen,
sofern vorhanden, gültig sein und übereinstimmen. Die bereits geprüften Anniversary-
Zuordnungen bleiben unverändert nutzbar. Suche und Binder bieten weiterhin eine
hinzufügbare Normal-Variante ohne erfundenen Preis an.

Collection und geteilte Binder zeigen weder unbelegte Root-Preise noch deren Datum.
Gespeicherte Preiswahlen werden nicht umgeschrieben; eine bisher nur durch Root
belegte Zuordnung kann nun ausdrücklich unbepreist sein. Bei einer belegten
Variantenidentität bleibt die vorhandene Auswahl nutzbar, bis ein echter Trendpreis
wieder Vorrang hat. Dies verbessert die Preisidentität, behauptet aber keine
vollständige Preisabdeckung oder aktuelle Anbieterpreise.

Vor dem Fix waren 38/50 gezielte neue/erweiterte Assertions rot. Danach 297/297
gezielte Tests, Typecheck, Oxlint und Diffprüfung bestanden. Der anschließende
isolierte Gesamt-Web-Testlauf bestand 912/912 Tests in 58 Dateien. Drei bisherige
Root-positive Tests wurden bewusst in belegte Varianten-Positive mit separaten
Root-Ablehnungsfällen überführt; Preisvalidierungen bleiben unabhängig geprüft.
Unabhängiger Code-Review ohne verbleibenden konkreten Befund. Beleg:
`outputs/release27-engineering-20261001/baseline/gate5-root-identity-final-results.json`.
Keine API-Abfrage, Provider-Downloads, Regeln oder Deployments durch diesen Fix.

### Gate 5: inkrementelle Collection-Preisauflösung (2026-10-01)

Der Hook löst bei Mengen-/Notizänderungen oder Umordnung nicht mehr sämtliche
unveränderten Einträge erneut auf. Wiederverwendet werden nur Ergebnisse derselben
Owner-/Listenergeneration, desselben vollständigen Resolver-/Preiswahl-Fingerprints
und desselben Retry-Versuchs innerhalb der ursprünglichen Katalog-Cachefrist.
Geänderte Einträge werden einzeln neu aufgelöst, entfernte Einträge verworfen;
ungeänderte Ergebnisse bleiben währenddessen sichtbar. Bereits laufende identische
Arbeit wird wiederverwendet. Verspätete Ergebnisse aus alten Generationen oder
nach Unmount dürfen die aktuelle Auswahl nicht überschreiben.

Der öffentliche Katalog-Cache bleibt auf 600 Einträge und zehn Minuten begrenzt.
`loadCard` behält seine Promise-API; `loadCardWithCacheInfo` liefert zusätzlich die
ursprüngliche Ablaufzeit. Ein Cachetreffer oder langsamer Abschluss verlängert diese
nicht. Ein spät fehlschlagender, schon verdrängter Request löscht keinen neueren
Eintrag derselben Karten-ID. Preispriorität, Variantenregeln, Retry und die bestehende
Sechsergruppen-Barriere bleiben unverändert. Private Ergebnisse werden nicht global
gecacht. Ohne freigegebenen Owner werden keine privaten Preise aufgelöst; einziger
Produktaufrufer ist die bereits zugangsgeschützte Web-App.

Reproduktion: Nach einer Mengenänderung stiegen bei 18 Karten die Resolveraufrufe
vorher von 18 auf 36, jetzt bleiben es 18. Bei 601 Karten verursachte der bisherige
Neudurchlauf zusätzliche 601 Resolver-/Loader-/Fetch-Aufrufe; jetzt bleiben die
jeweiligen Gesamtzähler bei 601. Fetch-Aufrufe in diesen lokalen Tests sind **kein
Nachweis über echte Netzwerktransfers oder eingesparte Cloud-Kosten**.

50 neue Regressionen decken Identitäts-/Sidecarfelder, TTL-Grenzen, Pending-Arbeit,
Fehler/Retry, Ownerwechsel, Rechteentzug/-wiedererteilung und Unmount ab. Erste
Reproduktion: 22 FAIL / 5 PASS; finale gezielte Auswahl 365/365. Unabhängiger Review
ohne konkreten Restbefund. Root-Gesamtlauf: **962/962 Tests in 60 Dateien**, Typecheck,
Oxlint und Diffprüfung bestanden. Beleg im ignorierten Evidence-Verzeichnis:
`gate5-6-root-incremental-sharing-results.json`. Keine Live-Abfrage oder Veröffentlichung.

### Gate 6: Binder-Löschung während einer Freigabeabfrage (2026-10-01)

Nach langsamer Katalogauflösung wird neben Freigabewiderruf und Besitzerzugang
jetzt auch der Binder erneut geprüft: Er muss weiterhin existieren, zur erwarteten
UID/ID gehören und darf keinen Tombstone tragen. Andernfalls folgt 404 ohne private
Antwortdaten. Zuvor konnte die bereits geladene Binderkopie trotz zwischenzeitlicher
Löschung noch ausgegeben werden. Es wird ein zusätzlicher Dokument-Read benötigt;
dies ist eine Integritätskorrektur, keine Read-/Latenzoptimierung.

Vier neue In-flight-Fälle (Tombstone, physisch fehlendes Dokument, fremder Owner,
falsche Binder-ID) lieferten zuerst 200 statt 404. Danach 23/23 fokussierte Tests.
Root-Verifikation: 87/87 Tests in neun Sharing-/Lösch-/Packaging-Dateien sowie 4/4
separate Node-Kompatibilitätstests bestanden. Diese Auswahl überschneidet sich mit
den 962 Webtests und wird nicht dazuaddiert. Belege: `gate6-root-final-guard-results.json`
und `gate6-root-deletion-compat.log`. In diesem abgegrenzten Guardfix blieben DTO,
Freigabeoptionen, Cache, Schema, Preise und Sidecars unverändert; die spätere lokale
Preisparitätskorrektur ist separat dokumentiert. Keine Live-Firebase- oder signierte-v26-E2E-Prüfung.

Die größere Skalierungsarbeit bleibt offen: Die jetzige globale Slotkollisions-
auflösung reserviert alle belegten Plätze und verschiebt Überläufe kontrolliert.
Eine naive Slotbereichs-Abfrage würde Karten/Seitenzahl verlieren. Materialisierte
Seiten und Gesamtwerte benötigen einen eigenen kompatiblen Invalidierungsvertrag.
Rechte-/Binder-/Share-Daten bleiben ungecacht, Antworten `no-store`. Der unten
beschriebene öffentliche Katalog-Cache enthält keine privaten Preiswahlen.
Fremde Bildhosts bleiben ausgeschlossen; bestätigte Alternativen werden nur unter
den unveränderten expliziten Preis-/Gesamtwert-Opt-ins ausgegeben.

### Gate 6: reproduzierbare 5.000-Platzierungen-Simulation

`node tests/sharing-scale/run.mjs` startet einen separaten Prozess mit bereinigter
Umgebung, `envDir:false` und Netzwerksperren vor dem Produktimport. Keine Firebase-App
wird initialisiert. Der tatsächliche `readBinderShare` läuft gegen synthetische
Firestore/Auth/Katalog-Doubles. Der Standardlauf wiederholt repräsentative Seiten
dreimal; ein optionales Argument 1–10 steuert diese Wiederholungen. Der dedizierte
Runner ist nötig, der normale Vitest-Lauf führt diesen Scale-Benchmark nicht aus.

Root-Nachprüfung: **9/9 Tests bestanden**, 4,74 s Vitest-Gesamtdauer. Alle 5.000 Karten
erscheinen exakt einmal über 556 Seiten, einschließlich fünf Slotkollisionen mit
Overflow. Query-Reihenfolge, erste/mittlere/letzte Seite, vier getrennte Preis-/Total-
Opt-ins, unveränderte Ownerdaten, Widerruf während Katalogauflösung und Ablehnung
von 5.001 Platzierungen sind geprüft. Beleg: `gate6-root-scale-simulation.log`.

| Aktueller Handler, je volle Seite | Ohne Gesamtwert | Mit Gesamtwert |
|---|---:|---:|
| Placement-Dokumente aus einer Query | 5.000 | 5.000 |
| Einzelne Dokumentabfragen | 8 | 8 |
| Collection-Dokumente via getAll | 9 | 5.000 |
| Katalogaufrufe | 9 | 5.000 |
| Maximale Katalogparallelität | 6 | 6 |

Das sind **logische Aufrufe der Doubles, keine Firebase-Abrechnung**. Ein kompletter
556-Seiten-Durchlauf ohne Gesamtwert verursachte 2.789.448 logische Dokumentlesungen.
Lokale Medianzeiten erster/mittlerer/letzter Seite ohne Opt-ins: 1,96/1,88/1,98 ms;
mit Preisen und Gesamtwert: 111,19/112,91/111,64 ms. JSON maximal 3.308 Bytes in
diesen Fixtures. Die Zeiten enthalten Assertions, Microtasks und Serialisierung,
aber keinerlei Netz-/Cloud-Latenz; sie sind kein Produktions-SLA oder Geschwindigkeits-
vergleich. Das aktuelle O(N)-Lesen je Seite ist damit ausdrücklich sichtbar, nicht
als erfolgreich optimiert abgehakt. Gesamtwert multipliziert weiterhin nicht mit
Exemplaranzahl: dieser bestehende Vertrag wurde im Test erhalten, nicht verändert.

### Weiter offene Abnahme

- Security-Emulatorergebnisse einschließlich der neun erneut registrierten
  Sharing-Regeltests separat grün belegen; keine Testzahlen doppelt zählen.
- Vollständige Karten-/Set-Preisabdeckung mit begründeten Restlücken, Varianten,
  Quarantäne und nicht verfügbaren Anbieterdaten; niemals Preise erfinden.
- Android/Web-Migration und bidirektionale Preiswahl: bestehende Nutzer, parallele
  Änderungen, Offline/Online, Revisionskonflikte, Accountwechsel, Tombstones,
  Wiederkehr eines Trendpreises, Rollenentzug und Löschsperre testen.
- Die unten lokal implementierte Sharing-/Alternativpreisentscheidung separat
  vollständig abnehmen: alte Links, Widerruf, reales Android-Web-Fallback und
  Veröffentlichung sind durch die fokussierten lokalen Tests nicht bewiesen.
- Rate-Limit: Parallelität über Instanzen, Transaktionsretry, Ablauf, 429/UI,
  Infrastrukturfehler und nicht blockierter Widerruf prüfen; IP-Grenze nachweisen.
- Große Sammlung/Binder mit warmem und kaltem Cache end-to-end messen. Der oben
  reproduzierte lokale Komplett-Neudurchlauf ist behoben; Initialabfragen,
  Sechsergruppen-Barriere und tatsächliche Netzwerk-/Cloud-Latenzen bleiben separat
  zu prüfen. Keine Auth-/Sync-Abkürzung aus den lokalen Messungen ableiten.
- Späterer echter Release-/Container-Smoke-Test mit ausdrücklich freigegebenem
  Deployment-Kontext erforderlich. Synthetischer Build ist keine Deploymentfreigabe.
- Gate 9: Functions-Codebase-Überschneidung/`isCurrentEvidence`-Drift zwischen
  Android und Web auflösen, kanonischen Backend-/Deploy-Eigentümer dokumentieren
  und Regressionstest gegen versehentliches Überschreiben vorsehen.

## Gate 9: lokaler Functions-Deploy-Vertrag (2026-10-01)

Canonical Functions source: `DomiDex-Web/backend/scan-knowledge`

Dieser Abschnitt löst den oben noch als offen geführten **lokalen** Eigentümer-
und Überschreibschutz auf. Die bestehende Web-`firebase.json` mit Codebase `default`
ist maßgeblich; Triggerexport, Region und Runtimecode werden hier nicht verändert.
`isCurrentEvidence` liest aktuelle Evidence-Version und Kontolöschsperre innerhalb
derselben Transaktion vor der Aggregation. Eine alte Android-Kopie ohne diese
Prüfung darf das Backend nicht ersetzen. Android erhält daher ausschließlich einen
unbedingt abbrechenden Functions-Predeploy-Guard; historische Exports bleiben
vorhanden, Firestore-/Storage-only bleiben davon unberührt. Kein automatischer
Redirect zum Web-Deployment und keine Env-/Flag-Ausnahme.

`tests/scan-knowledge-trigger.test.mjs` importiert den tatsächlichen exportierten
Handler. Nur SDK-Grenzen sind gemockt; `current-evidence.js` und
`knowledge-aggregate.js` laufen echt. Geprüft werden aktuelle Evidence, ersetzte
Version, fehlendes Dokument, aktive Löschsperre, bereits verarbeiteter Beitrag,
Guard-Lesefehler sowie fehlende/ungültige Events. Abgelehnte aktuelle Zustände lesen
keine Aggregate und schreiben keine öffentlichen oder privaten Stimmen. Der Test
prüft ebenfalls Exportoptionen und lokalen Eigentümervertrag. Er benötigt die
regulären Web-Testdependencies und die Dependencies von `backend/scan-knowledge`,
aber weder globale Firebase-CLI noch Credentials, Emulator oder Android-Checkout.

Zusätzlich wurde der lokale Windows-Lifecycle-Runner der vorhandenen Firebase-CLI
15.28.2 isoliert untersucht: `$PROJECT_DIR` kommt aus `projectRoot`, `cross-env`
führt den Guard auch bei anderem Arbeitsverzeichnis aus. Functions-, Codebase- und
Funktionsfilter müssen abbrechen; Firestore-/Storage-only wählen keinen Guard.
Das ist ein separat ignorierter rechnerabhängiger Harness, keine neue Testdependency
oder ausgeführte CLI-Anmeldung/Deployment. Konfigurationsschutz ersetzt keine IAM-
Grenze gegen absichtlich andere Werkzeuge/Konfigurationen.

Offen bleiben Live-Verifikation und eine gesondert autorisierte Veröffentlichung.
Der SDK-gemockte Trigger-Test beweist die Guardverdrahtung, nicht echte konkurrierende
Firestore-Transaktionsretries oder den derzeit in Produktion laufenden Code.

Lokale Verifikation: **11/11 Export-/Vertragstests bestanden**, 284 ms Vitest-
Gesamtdauer, `envDir:false` und gesperrte echte Netzwerkpfade. Im ersten Lauf war
nur der noch fehlende Dokuvertrag rot (1 FAIL/10 PASS); kein erfundener vorheriger
Triggerdefekt. Zusätzlich bestehen die drei unveränderten Node-Aggregationstests.
Gezieltes Oxlint und beide Git-Diffprüfungen sind grün. Belege unter
`outputs/release27-engineering-20261001/baseline/`: `gate9-trigger-first.log`,
`gate9-trigger-green.json`, `gate9-trigger-green.log`, `gate9-trigger-lint.log`
und `gate9-aggregation-green.log`. Die Testdatei ist jetzt in der bestehenden
expliziten `npm test`-Auswahl enthalten; sie erweitert keine Runtime-Abhängigkeit.
Der abschließende Typecheck ist ebenfalls grün (`gate9-typecheck-final.log`). Ein
vorheriger Lauf sah nur die noch unfertige parallele Preiswahlmatrix-Testdatei;
diese Zwischenfehler wurden von deren Bearbeiter korrigiert, nicht unterdrückt.

Es existiert aktuell keine CI-Pipeline in diesem Repository. Für einen sauberen
Checkout müssen vor den Tests sowohl die Root- als auch die bereits deklarierten,
gelockten `backend/scan-knowledge`-Dependencies installiert sein (`npm ci` und
`npm --prefix backend/scan-knowledge ci`). Ein Root-Install allein installiert
`firebase-functions` nicht. Der Test überspringt sich bei fehlender Installation
nicht; er scheitert sichtbar. Hier wurde nichts nachinstalliert, keine CI erfunden
und kein installierender Pretest-Hook eingeführt. Automatische CI-Abdeckung bleibt
offen, bis eine Pipeline mit diesen Voraussetzungen separat eingerichtet wird.

## Gate 5: Kartenhinzufügen mit teilweise fehlgeschlagener Preiswahl (2026-10-01)

Suche und fehlender Set-Binder-Platz schrieben zuerst die Karte und danach separat
die optionale Preiswahl. Scheiterte nur die zweite Transaktion, meldete die UI einen
allgemeinen Fehler; erneutes Hinzufügen konnte die bereits bestätigte Menge nochmals
erhöhen. Echte Komponenten-/Picker-Tests reproduzierten dies: **4 FAIL / 4 PASS**,
darunter zweimal tatsächlich zwei Add-Aufrufe statt eines.

Der lokale UI-Ablauf trennt jetzt bestätigten Kartenwrite und Preiswahl. Bei einem
Teilerfolg erscheint ausdrücklich „Karte wurde hinzugefügt. Die Preisauswahl konnte
nicht gespeichert werden.“ Ein eigener Button wiederholt nur die Preiswahl mit
festgehaltener UID, Eintrags-ID und kopiertem Kandidaten. Kein Rollback, Re-Add,
automatischer Retry, erfundener Preis oder neue Backend-/Rule-/Schemaänderung.
Auch wenn der Collection-Listener die Karte inzwischen als vorhanden liefert,
bleibt der ausstehende Vorgang sichtbar, ohne erneut Add/Menge freizugeben.

Synchrone Busy-Guards fangen Doppelklicks ab. Kontextgenerationen verwerfen späte
Antworten nach Account-/Karten-/Variantenwechsel oder Unmount. Bereits das Auswählen
einer anderen Karte invalidiert den alten Vorgang, nicht erst deren fertiger
Detaildownload. Picker-Bestätigung und Parent-Kandidat werden bei Accountwechsel
und erneuter Kartenauswahl gemeinsam zurückgesetzt. Ein echter erster Kartenfehler
bleibt regulär retrybar. Der Preiswahl-Retry ist bewusst **nur UI-lokal**, keine
persistente Offline-Outbox; beim Verlassen bleibt die bereits gespeicherte Karte
erhalten, eine fehlende Preiswahl kann später in der Sammlung bestätigt werden.

27 neue Tests in `tests/card-add-partial-success.test.tsx` sind Bestandteil der
normalen `npm test`-Auswahl. Finale gezielte Auswahl: **40/40**; reguläre explizite
Paket-Auswahl: **722/722 in 50 Dateien**, 33,58 s lokal. Anschließend wurde ein
unsicherer Select-Testcast durch eine echte `instanceof`-Prüfung ersetzt; die 27
Fälle erneut grün, finaler Typecheck/Oxlint/Diffcheck grün. Ein unabhängiger Read-only-
Review fand keinen konkreten Blocker. Bestehende JSDOM-Canvas-/React-act-Warnungen
blieben sichtbar, keine Assertions oder Timeouts abgeschwächt.

Nachweise im ignorierten Baseline-Verzeichnis: `gate5-partial-add-red.{json,log}`,
`gate5-partial-add-context-red.{json,log}`, `gate5-partial-add-confirmation-red.{json,log}`,
`gate5-partial-add-focused-green.json`, `gate5-partial-add-package-final.{json,log}`,
`gate5-partial-add-final-test-guard.json`, `gate5-partial-add-typecheck.log` und
`gate5-partial-add-lint.log`. Alle UI-Läufe nutzten `envDir:false` und gesperrte echte
Netzwerkpfade. Dies ist kein Live-Firestore-/Android-E2E-Nachweis; kein Deployment.

Root-Gegenprüfung der erweiterten expliziten Regression: **1.000/1.000 Tests in
62 Dateien bestanden**, 32,52 s, einschließlich inkrementeller Preisauflösung,
Owner-/App-Check-/Rate-Limit-Grenzen und der 27 neuen Teil-Erfolgsfälle.
`gate4-5-root-price-regressions.{json,log}` im selben ignorierten Verzeichnis.
Die bekannten React-act-/Canvas-Testumgebungswarnungen bleiben sichtbar.

### Reale lokale Zwei-Client-Preiswahlmatrix

`tests/price-selection-two-client.rules.test.ts` ergänzt 21 echte SDK-/Rules-Fälle;
zusammen mit den vier vorhandenen Sync-Fällen bestehen **25/25 Tests**. Abgedeckt:
alle sieben Metriken, Original-Quelldatum, Clear/Update-Konflikte, Offline-Queue,
Widerruf/Disabled/Löschlock, Owner-/Parent-Isolation, bestätigte Listenerdaten und
Transportabbruch. `permission-denied` bei konkurrierenden Revisionen ist nicht
zwingend ein vom SDK automatisch wiederholter Konflikt. Ein bewusster neuer Retry
ist getrennt geprüft; Rules wurden dafür nicht gelockert.

Da `disableNetwork()` im installierten Node-SDK direkte Transaction-RPCs nicht
vollständig unterbricht, prüft ein eigener Loopback-Proxy zusätzlich echten Ausfall.
Er nutzt den validierten lokalen Emulator-Endpunkt und einen OS-zugewiesenen Port;
er beendet nur seine eigenen Verbindungen. Kein Replay nach Reconnect und keine
Bestätigung bei fehlgeschlagenem Write. Das ist kein Android-Worker-/Web-UI-E2E.

`npm run test:sync-emulator` verwendet jetzt eine getrennte serielle Konfiguration
ohne .env-Laden; Demo-Projekt und lokaler Emulator sind verpflichtend. Es nutzt
die vorhandene Firebase-CLI, startet keinen Produktionsdienst und ändert keine
Projekt-Emulatorports. Der Root-Gegenlauf über den credential-freien isolierten
Engineering-Runner besteht **25/25 in 20,51 s / 29,73 s gesamt**. Alle belegten
Rules-Kopien blieben identisch; alle reservierten Ports waren danach frei.
Ein anfänglicher Konfigurationslauf fand wegen falschem Arbeitsverzeichnis keine
Tests; der neue explizite root-Pfad behebt diese Harness-Abweichung. Der fehlende
Testlauf wurde nicht als Produkt-RED oder PASS gezählt.

Rechnerlokale Rohbelege im Android-Checkout:
`artifacts/release27-engineering-20261001/security-gate4-two-client/run-20261001-051731-ae8a5231/`.
Node-Netzschutz ist kein OS-/Java-Firewallnachweis. Echte Nutzer, Cloud-Dienste,
Release-AAB, Signing und Deployment blieben unberührt.

## Gate 6: Offene Großansicht folgt aktuellen Freigabedaten (2026-10-01)

Ein erfolgreicher Refresh aktualisierte zuvor nur die Binderübersicht, während der
offene Dialog sein altes `SharedCard`-Objekt behielt. Damit blieben selbst nach
Empfang eines aktuellen DTO ausgeblendete Preise und entfernte Karten sichtbar.
Die echte Komponenten-Reproduktion ergab zunächst **5 FAIL / 2 PASS**, erweitert
auf Identität/Neigung/Antwortreihenfolge **10 FAIL / 3 PASS**; keine echten API-Aufrufe.

Der Dialog speichert jetzt ausschließlich die vorhandene DTO-Identität aus Slot,
`cardId`, Finish und Sammlernummer. Preis, Bild, Holo und Darstellungsdaten stammen
bei jedem Render aus dem jüngsten Binder-DTO. Eine fehlende/ausgetauschte Identität
zeigt sofort keine alte Karte mehr; der Dialog schließt und setzt die Neigung
zurück. Dieselbe Identität bleibt offen und behält die manuelle Neigung. Ein später
wieder vorhandener Eintrag öffnet sich nicht automatisch. Keine erfundene
Varianten-/Placement-ID und keine Änderung an Backend, Freigabe-Flags, Polling,
Requestversion oder Abort-Prüfung. Die unveränderte Aktualisierung erfolgt weiterhin
bei Sichtbarkeit bzw. im 15-Sekunden-Intervall; dies ist keine Echtzeit-Push-Zusage.

`tests/shared-binder-viewer-refresh.test.tsx` enthält 13 neue Fälle und gehört zur
normalen `npm test`-Auswahl. Zusammen mit den vier vorhandenen Viewer-Tests:
**17/17 PASS**. Reguläre explizite Paket-Auswahl mit `envDir:false` und Netzschutz:
**735/735 in 51 Dateien**, 18,18 s lokal. Typecheck, gezieltes Oxlint und Diffcheck
sind grün; unabhängiger Read-only-Review ohne konkreten Blocker. Bekannte
JSDOM-Canvas-/React-act-Warnungen wurden nicht unterdrückt. Kein Live-/Browser-E2E,
kein Deployment und keine Änderung bereits ausgelieferter Daten.

Nachweise im ignorierten `outputs/release27-engineering-20261001/baseline/`:
`gate6-viewer-refresh-red.{json,log}`, `gate6-viewer-refresh-expanded-red.{json,log}`,
`gate6-viewer-refresh-green.{json,log}`, `gate6-viewer-refresh-package-green.{json,log}`,
`gate6-viewer-refresh-typecheck.log` und `gate6-viewer-refresh-lint.log`.

Unabhängiger Root-Gegenlauf der erweiterten Regression: **1.013/1.013 Tests in
63 Dateien bestanden**, 22,05 s. Nachweis: `gate6-root-viewer-regressions.{json,log}`
im selben ignorierten Verzeichnis, ohne Umgebungsdateien oder externes Netzwerk.

## Gate 6: Preisparität freigegebener Binder — lokal, nicht deployed (2026-10-01)

Zwei eng begrenzte Abweichungen wurden test-first korrigiert: Der Share-Handler
berücksichtigte weder die gespeicherte bestätigte Alternativpreiswahl noch die
vorhandenen geprüften Supplement-/Jubiläums-Guide-Ergänzungen des Kartenresolvers.
Geändert sind der Share-Pfad, reine Decoder-/DTO-Helfer, die öffentliche Cache-
Moduswahl, der Web-Preistext und deren Standalone-Packaging. Keine neuen Rules,
Dokumentschemata, Produktzuordnungen, Dependencies oder Cloud-Einstellungen.

### Private Preiswahl: genaue Read- und Freigabegrenze

- `showPrices` und `showTotal` bleiben unabhängig und standardmäßig aus. Nur wenn
  mindestens eines ausdrücklich `true` ist, kommen Preiswahl-Reads infrage.
- Gelesen werden ausschließlich bereits benötigte Collection-Einträge mit exakter
  Dokument-/Sync-ID, aktiver Ownerbindung, geprüfter Karten-/Set-/Nummer-/Varianten-
  und Produktidentität, Quelle `CARDMARKET_PUBLIC_DOWNLOAD` und **fehlendem gültigem
  Trendpreis**. Kein Read bei vorhandenem Trend, unklarer Druckvariante oder bei
  ausschließlich bildlicher Freigabe. Ohne Gesamtwert werden nur die Einträge der
  angeforderten Seite benötigt; mit Gesamtwert weiterhin alle sichtbaren Plätze.
- Nur die eindeutigen benötigten Pfade
  `users/{owner}/collectionPriceSelections/{entrySyncId}` werden mit `getAll`
  gelesen, jeweils **höchstens 100 Referenzen pro Batch**, keine Owner-weite Query.
  Bis zu 5.000 unterschiedliche geeignete Einträge bedeuten höchstens 50 solcher
  Batches zusätzlich, nicht konstante Kosten für einen beliebig großen Binder.
- Der vorhandene Decoder wurde ohne Vertragsänderung in
  `lib/collection-price-selection-codec.ts` extrahiert und clientseitig re-exportiert;
  der Server importiert kein Firebase-Clientmodul. Decoder und bestehendes
  `manualSelectionPrice` prüfen Schema, Owner, Eintrag, genaue Identität, Metrik,
  Währung und Werte. Fehlende, gelöschte, widersprüchliche oder ungültige Wahlen
  erfinden keinen Preis. Ein gültiger Trend hat weiterhin Vorrang.
- Sidecars bleiben in einer **Request-lokalen** Map, niemals im öffentlichen Cache.
  Bei nur `showTotal` wird die intern benötigte Einzelpreisprojektion vor Ausgabe
  entfernt. Summen zählen sichtbare Platzierungen, nicht die private Exemplaranzahl.
  Abschließende Prüfungen von Widerruf, Auth-/Zugangsstatus, Löschsperre und Binder
  nach der Katalog-/Sidecararbeit bleiben erhalten; Antwort weiterhin `no-store`.

### Öffentlicher Katalog und Zeitbudgets

Die bestehende Supplement-/Guide-Anreicherung läuft **vor** der Cache-Projektion,
damit unter anderem Sonderdruck-/Subtype- und Produktkonflikte noch geprüft werden.
Die vorhandene exakte EN-Bildfallback-Prüfung und `assets.tcgdex.net`-Allowlist
bleiben unverändert. Supplemente mit anderem Bildhost können daher eine korrekt
zugeordnete Karte/Preis liefern, aber weiterhin `image: null`; kein neuer Bildhost.

`public-catalog-cache.mjs` unterscheidet ausschließlich die festen öffentlichen
Modi `raw` (Default, keine Guide-Anreicherung) und `prices`, samt fester Resolver-
Version. Keine UID, Freigabetokens oder Sidecars in den Keys. Beide Modi teilen
**dieselben** Grenzen: 8.192 Einträge, 32 MiB serialisierte Nutzdaten, 128 KiB je
cachebarem Eintrag, 60 Sekunden ursprüngliche TTL und höchstens 64 registrierte
In-flight-Jobs. Letzteres begrenzt die Deduplizierungsverwaltung, **nicht** global
alle parallelen Providerarbeiten; der bestehende ungecachte Overflow bleibt.

Ein erster Wechsel `raw` → `prices` oder umgekehrt benötigt bewusst einen eigenen
Providerabruf, damit ein unaufgelöster Raw-Treffer keinen Preisdatensatz ersetzt.
Danach wird nur innerhalb desselben Modus wiederverwendet. Ein synthetischer
Raw/Prices/warmer-Prices-Lauf ergab Provideraufrufe **1/1/0**, private logische Reads
weiterhin **9/9/9**. Das ist keine Behauptung eingesparter Firestore-Reads oder
gemessener Cloud-Latenz. Request-/Jobabbruch verhindert spätes Cache-Wärmen.

Der Share-Katalog behält sechs Worker und sein gemeinsames **12-Sekunden-Consumer-
Budget**. Der wiederverwendete, pro Prozess geteilte Guide hat weiterhin sein
eigenes **6-Sekunden-Budget**. Beginnt er spät, darf die Share-Antwort vorher abbrechen;
der geteilte Guide kann bis zu seiner eigenen Grenze weiterlaufen, weil andere
Aufrufer ihn verwenden könnten. Keine Zusage, dass ein Consumerabbruch sofort
sämtliche zugrunde liegende Netzwerk-/SDK-Arbeit beendet. Lokale Tests verwenden
nur Provider-Doubles, keine neuen Preisdownloads.

### DTO-Kompatibilität und Preisgrenzen

Quelle `Cardmarket`, Währung `EUR` und ursprüngliches Quelldatum bleiben erhalten.
Bei akzeptierter manueller Alternative enthält der Einzelpreis optional
`basis: "selection"`; Web zeigt „Gewählte Cardmarket-Kennzahl“, nicht „Trend“.
Der bestehende Android-Parser ignoriert dieses additive Feld und zeigt weiterhin
die generische Cardmarket-Quelle. Dieser Schritt ändert keine Android-UI.

Der bestehende Android-Wirevertrag erlaubt endliche Beträge von 0 bis einschließlich
**1.000.000.000 EUR**. Ein größerer Einzelbetrag wird im öffentlichen DTO `null`,
ohne irreführendes `basis`, ohne Clamp und ohne Änderung des gespeicherten oder
regulären Sammlungspreises. Dadurch sinkt nur die echte Zahl verfügbarer Preise.
Übersteigt ausschließlich die vollständige Summe den Bereich, fehlt das optionale
`total`-Feld ganz. Keine erfundenen Counts: Android verlangt gleichzeitig
`complete == (pricedCards == visibleCards) == (amount != null)`. Unvollständige
Summen behalten ihre tatsächlichen Counts und `null/false`; leere Binder behalten
den bisherigen vollständigen Null-Euro-Gesamtwert. Web zeigt fehlende Beträge
nicht als 0 an. Die Summenrechnung bleibt bei 5.000 × 100.000.000.000 Cent innerhalb
des sicheren Integerbereichs.

### Enger lokaler Nachweis und verbleibende Grenzen

- A: zunächst **10 FAIL / 23 PASS**; sechs Preisfälle und vier Fälle, deren neuer
  Sidecar-Read-Hook vorher nicht erreicht wurde. Letztere nicht als früheren
  eigenständigen Berechtigungs-Exploit ausgeben.
- B: **10 FAIL / 21 PASS** für Loader-/Modusparität vor der Korrektur.
- Android-Domain: **3 FAIL / 38 PASS** für zwei übergroße Einzelpreise und eine
  übergroße Gesamtsumme vor der DTO-Grenze.
- Abschließend **103/103 in sechs Testdateien**, 8,14 s, isoliert mit
  `envDir:false`, Netzwerk-Preload und einem Worker: Preisparität 41,
  Katalogparität 11, Cache 20, Handler 15, Viewer 15 und sauberer Paketimport 1.
  Der echte Handler-Cache-Test prüft zwei Owner mit unterschiedlichen Wahlen,
  nur einem Providerfetch und frischem Clear. Tests nutzen keine produktiven Daten.
- Unabhängiger Source-Review ohne konkreten Blocker; Diffprüfung bestanden.
  Dies ist **keine neue vollständige Regression, kein Browser-/Android-E2E und
  keine Live-Verifikation**. Ein zusätzlicher lokaler Lintversuch wurde vom
  Test-Preload beim `tsgolint`-Kindprozess blockiert und zählt nicht als Lint-PASS;
  kombinierte Typecheck-/Lint-/Gesamtläufe werden getrennt dokumentiert.

Ignorierte lokale Nachweise unter `outputs/release27-engineering-20261001/baseline/`:
`gate6-price-parity-a-red.log`, `gate6-price-parity-b-red.log`,
`gate6-price-parity-domain-red.log`, `gate6-price-parity-ab-focused.log`.
Die neuen Tests liegen versionierbar in `tests/shared-binder-price-parity.test.mjs`
und `tests/shared-binder-catalog-parity.test.mjs`; bestehende Cache-/Viewer-/Package-
Tests wurden gezielt ergänzt. Die 103 nicht zu früheren überlappenden Zahlen addieren.

### Unabhängige Abschlussläufe dieses lokalen Teilblocks

Root-Gesamtauswahl: **1.104/1.104 in 68 Dateien**, 24,72 s; beide neuen Paritäts-
Dateien sind dauerhaft in `tests/release-local/selection.mjs` enthalten. Nachweis:
`outputs/release-local/2026-10-01T04-22-32-835Z-21860.{json,log}`. Separater Cache-
Runner **69/69**, einschließlich der 20 Cachefälle, unter
`outputs/public-catalog-cache/2026-10-01T04-29-26-723Z-10596.log`.

Echte lokale Auth-/Firestore-/Storage-Dienste: **27/27**, zusätzlich **13/13**
Harness-Safety. Nachweis:
`outputs/private-operations-local/2026-10-01T04-28-36-922Z-a113a180/manifest.json`.
Nur Demo-Projekt und synthetische Konten, vorhandene geprüfte JARs, keine Downloads;
die ausdrücklich erfassten Inputs unverändert und alle sechs Ports danach frei.
Dies bleibt ein lokaler Backendtest, kein produktiver Android/Web-Roundtrip.

Normaler Typecheck und Lint bestanden, nachdem neun Befunde ausschließlich im
Testharness korrigiert wurden. Die Assertions und Netzsperren wurden nicht
abgeschwächt. Ergänzend Kostenmodell **6/6**, Sharing-Simulation **9/9** und
sauberer Paketimport **1/1**; `baseline/gate6-harness-*-final.log`.
Concurrency **12/12** mit neun gleichen bzw. 18 getrennten kalten Modusabrufen und
jeweils null zusätzlichen warmen Abrufen. Der alte gemischte Test erwartete noch
neun über beide Modi; dessen **10 PASS / 1 FAIL** bleibt dokumentiert. Die
bewusste Vertragsänderung und erweiterten Privacy-/Owner-Checks stehen in
`tests/sharing-concurrency/README.md`. Aktuell:
`outputs/sharing-concurrency/2026-10-01T04-31-30-334Z-2832.{log,metrics.json}`;
danach nochmals Lint und Typecheck bestanden. Keine Messzeit als Speedup verwenden.

Isolierter Build: **PASS**, 14,944 s, 299 kopierte Quelldateien, synthetische
Konfiguration und bestehender Node-Netzschutz. Root-`dist` plus neun explizite
Build-/Deployment-Konfigurationsdateien bleiben per kompaktem Vorher/Nachher-
SHA-256 gleich: 3.267 Dateien / 70.962.371 Bytes,
`fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`.
`node_modules` und private Env-Dateien gehören nicht zu diesem Hashnachweis.
Nachweise: `baseline/build-gate6-final{.log,-result.json,-integrity.json}`.
Keine neue Deployment-Freigabe; Produktcode in diesem Teilblock nur lokal.

**Offen:** das O(N)-Placement-Lesen pro Seite, Auflösen aller benötigten Einträge
bei Gesamtwert, zentrale Preisversorgung/volle Anbieterabdeckung und belastbare
Cloud-Kosten-/Lastmessung. Anonyme öffentliche Read-Limits sind weiterhin nicht
implementiert; eine vertrauenswürdige Ingress-/Client-IP-Grenze ist nicht bewiesen.
Der öffentliche Cache ersetzt weder Rate-Limiting noch Owner-/Widerrufsprüfungen.
Keine Veröffentlichung, neue Deployment-Freigabe oder Zusage über den Live-Stand.

### Gate 6: kleinere Placement-Nutzdaten, keine Seitenabfrage (2026-10-01)

`backend/security/sharing.mjs` projiziert die unveränderte, auf 5.001 Dokumente
begrenzte Binderabfrage nun ausschließlich auf `ownerUid`, `entrySyncId`,
`slotPosition`, `deleted`, `holoEffectId` und `holoIntensity`. Die Dokument-ID
bleibt für die stabile Kollisionsauflösung erhalten; fehlende Legacyfelder werden
nicht ergänzt. Filter, 5.000-Cap einschließlich Tombstones, Preis-/Namensfreigaben,
DTO und abschließende Widerruf-/Owner-/Binderprüfungen sind unverändert.
Das entfernt unbenutzte Felder aus dem gelesenen Payload, **spart aber keine
Dokument-Reads** und belegt weder Cloud-Latenz noch einen Pagination-Speedup.
Globale Kollisionsauflösung und Seitenzahl benötigen weiterhin alle Platzierungen
(O(N) Reads, mit Sortierung); der Gesamtwert benötigt weiterhin den vollständigen
Entry-/Preis-Fan-out. Kein neues Schema, Index, Backfill oder Deployment.

Root bestätigte für `tests/shared-binder-placement-projection.test.mjs` zunächst
**23 PASS / 3 FAIL**, danach **26/26 PASS**. Die Fixture projiziert tatsächlich
Felder; ein Full-Document-Vergleich prüft identische DTOs und logische Reads über
acht Freigabekombinationen, globale Kollisionen, Legacy-/Nullfälle und genaue
Preiswahl. Gesondert bleiben ungültige Daten, der Tombstone-Cap und spätere
Widerrufe abgesichert. RED-Nachweis: `outputs/release-local/anchor-and-projection-red.log`.
Dies ist ein isolierter synthetischer Vertragstest, kein neuer SDK-/Live-Lastnachweis.
Nur die Query-Doubles in `tests/shared-binder-collisions.test.mjs`,
`tests/shared-binder-price-parity.test.mjs`, `tests/shared-binder-catalog-parity.test.mjs`,
`tests/public-catalog-cache/handler.test.mjs`, `tests/sharing-scale/read-binder-scale.test.mjs`
und `tests/sharing-concurrency/read-binder-concurrency.test.mjs` wurden für dieselbe
reale Feldprojektion angepasst; ihre bisherigen Ergebnis-/Read-Assertions bleiben erhalten.

### Gate 4: authentifizierter Zeitanker, noch kein aktiver Delta-Client (2026-10-01)

Neu im lokalen Quellstand: `GET /api/private-sync/time-anchor`, mit unveränderter
aktueller App-/Admin-Berechtigung. Das DTO enthält ausschließlich Version 1,
authentifizierte eigene UID und exakte Sekunden/Nanosekunden des bereits vorhandenen
letzten Auth-Löschlock-Reads. `actorFor` behält Form, Regeln und bisherige Readanzahl.
Keine Geräteuhr, kein Token-Zeitstempel und kein zusätzliches Zeitmarker-Dokument.
Ein fehlender/ungültiger SDK-`readTime` verweigert nur diesen Endpunkt mit 503.

Eine getrennte, immer erzwungene Quote erlaubt 60 Anker pro UID/60-Sekunden-Fenster.
Ihr einzelner gehashter technischer Zähler wird mit derselben Löschsperre in einer
Firestore-Transaktion geprüft. Account-Löschung umfasst genau den eigenen Zähler.
Das begrenzt erfolgreiche Antworten, **nicht Ingress, Auth-Arbeit oder alle Kosten**.
`expiresAt` ist nur Aufbewahrungsmetadatum; keine TTL-Policy wurde aktiviert und
keine automatische Löschfrist behauptet. Alte Write-Quoten/App-Check-Policy/Rules
bleiben unverändert. Der interne Vertrag steht in `docs/openapi.release27.yaml`.

Rootnachweise (alle lokal, keine echten Konten/Produktionszugriffe):

- Neue Handler-Verträge zunächst 32 FAIL / 2 PASS; Quota-Modul fehlte bewusst,
  exakter neuer Löschinventar-Key zunächst FAIL. Dies ist teilweise Feature-RED,
  kein Beleg eines zuvor existierenden Laufzeitfehlers.
- Fokussiert **68/68 PASS**, inklusive sauberem Standalone-Paketimport; vollständige
  Unit-Regression **1.197/1.197 in 73 Dateien**, 44,06 s. Lint und Typecheck PASS.
- Tatsächliche lokale Auth-/Firestore-/Storage-SDK-Suite **30/30 PASS**, 33,47 s:
  exakter ReadTime eines fehlenden Lock-Snapshots, 59 echte Reservierungen plus
  zwei konkurrierende Handler über zwei SDK-Instanzen (genau 200/429), eigener
  Zähler für das zweite Konto, Rollen-/Disabled-/Löschsperren einschließlich nach
  Auth, sowie bisherige Sharing-/Upload-/vollständige Löschregressionen.
  Manifest: `outputs/private-operations-local/2026-10-01T05-11-28-535Z-5493909c/manifest.json`.
  Ein rein testseitiger numerischer Sort-Comparator wurde nach Lint korrigiert;
  der finale 30er-Lauf erfolgte danach. SDK-/Java-Harnesswarnungen bleiben sichtbar.
- Public-Cache **69/69**, synthetische Sharing-Concurrency **12/12** und 5.000-
  Placement-Scale **9/9** PASS. Keine Zeit daraus als Cloud-Speedup ausgeben.
- Isolierter Produktionsmodus-Build **PASS**, 15,761 s, 302 Quelldateien, nur
  Demo-Umgebung. Root-`dist` plus neun Build-/Deployment-Konfigurationen bleiben
  per SHA-256 unverändert (3.267 Dateien / 70.962.371 Bytes; identisch zum vorherigen
  Nachweis). Belege: `baseline/build-anchor-projection{-result,-integrity}.json`.

**Nicht geschlossen:** Android-SDK-Reader, Aktivierung/Rollout, historische oder
administrativ zurückdatierte `updatedAt`-Werte, fairer persistenter Nachlauf und
vollständige geräteübergreifende Konvergenz. Der Zeitanker beweist weder einen
Collection-Snapshot noch Dokumentexistenz. Kein Deployment oder Live-Speedup.

### Technische Read-Quota: explizite Client-Rules-Sperre (2026-10-01)

Das bestehende Catch-all-Deny bleibt unverändert. Vier additive Fälle in Android
`firebase-tests/release27-security.rules.test.mjs` prüfen den echten aktuellen
`privateReadRateLimits/syncTimeAnchor_<Hash>`-Datensatz für Owner, Fremdnutzer,
Client-Admin und anonym: Create, Get, Listen einschließlich exakter Dokument-ID,
Update/Overwrite und Delete werden verweigert; Serverkontrollen bestätigen keine
erfolgte Mutation. Bisherige Fälle und sämtliche Rules bleiben unangetastet.

Der versionierte Web-Starter `tests/rules-local/run.mjs` führt die drei aktuellen
Android-Rules-Suiten aus, ohne historische Web-Snapshots. Aufruf/Voraussetzungen:
[`tests/rules-local/README.md`](../tests/rules-local/README.md). Er verwendet die
bestehenden geprüften CLI-/JAR-, Clean-Environment-, Loopback- und Prozessbaum-
Hilfen; zwei fest zugeordnete Demo-Suites, keine freie Projekt-/Befehlswahl.
Node 24+, Java 21+, CLI 15.28.2 und vorhandene geprüfte JARs sind erforderlich.
Frische APPDATA-/Home-Verzeichnisse und Node-Netzschutz ersetzen keine OS-/
Java-/Native-Sandbox. Der bisherige Private-Operations-Default und seine eigene
30-Fälle-Auswahl bleiben getrennt.

Rootnachweis: **17/17 Safety** (1,600 s), **84/84 Rules**, null Skips/Fehler
(TAP 35,604 s), anschließend kompletter Web-Lint und Typecheck PASS. Die 84 sind
11 Firestore + 7 Storage + 62 bestehende Security- + 4 neue Quota-Fälle; TAP-Prüfung
verlangt zusätzlich jeden der vier neuen Titel genau einmal. Zähländerungen
erfordern erneuten Quellreview, nicht das Absenken einer Erfolgsschwelle.
Manifest: `outputs/rules-local/2026-10-01T05-23-40-780Z-a9b6f6b4/manifest.json`:
Exit 0, Ports vorher/nachher frei, Inputs unverändert. Keine Rules-, Backend-,
Produktions- oder Deploymentänderung in diesem Testblock. Reale lokale Client-
SDK-/Rules-Prüfung, kein Android-/Google-Account-/Produktions-Ende-zu-Ende-Beweis.
Die anschließende Root-Regression des unveränderten Private-Operations-Aufrufs
bestand ebenfalls **30/30**, 33,487 s Testdauer (35,04 s Vitest gesamt);
`outputs/private-operations-local/2026-10-01T05-24-48-401Z-2ebfe9c5/manifest.json`.

### Gate 6: Karten-Großansicht und begrenzte Providerantworten (2026-10-01)

Bei einem erfolgreichen Refresh, der die ausgewählte Karte ersetzt oder entfernt,
war der native Dialog bereits inhaltlich leer, aber erst nach dem Commit geschlossen.
Nur dieser Invalidierungs-Effekt läuft jetzt als Layout-Effect. Gültige Auswahlen,
Freigabeoptionen, Request-Generationen und Datenzugriffe bleiben unverändert. Ein
neuer Profiler-Test beobachtet alle passenden Commits: zunächst **15 PASS / 1 FAIL**,
danach **16/16 PASS**. Das belegt den JSDOM-Dialogzustand zur Commit-Zeit, keinen
gemessenen Browser-Paint, Fokus oder GPU-Effekt. RED/GREEN bleiben erhalten:
`outputs/release-local/shared-viewer-commit-{red,green}-20261001.{log,json}`.

Der vollständige Folgelauf deckte zusätzlich eine Bereitschaftslücke im Owner-UI-
Test auf: Das Formular erscheint vor dem zweiten GET der aktiven Freigaben. Der
Test klickte auf den noch deaktivierten Button. Die Tests warten nun auf echte
Bereitschaft; die E-Mail-Sperre wird getrennt vom Ladezustand bewiesen. Ein neuer
zurückgehaltener GET zeigt: kein POST während des Ladens, kein automatischer POST
nach dessen Ende, exakt ein korrekter POST erst nach ausdrücklichem Klick.
Keine Produktänderung am Owner-Formular. Beide UI-Dateien bestehen **22/22**:
`outputs/release-local/sharing-ui-green-20261001.{log,json}`.

Der tatsächliche DE-/EN-Einzelkartenabruf in `backend/security/sharing.mjs` liest
jetzt höchstens **1 MiB dekodierte Antwortbytes** vor JSON-Parsing. Ein zu großer
Content-Length wird früh abgewiesen; fehlende oder falsche Header umgehen die
gezählte Bytegrenze nicht. Nicht erfolgreiche, zu große oder abgebrochene Bodies
werden bestmöglich gecancelt, ohne auf einen hängenden Cancel-Hook zu warten.
Auch ein festhängender Read endet beim bestehenden Abort; Listener und Reader
werden freigegeben. Der neue lokale Helper ist in der Standalone-Copyliste.

Das ist eine technische Grenze je Einzelkarte, **keine Anbieter-SLA, Gesamt-Heap-
oder globale Parallelitätsgrenze**. Preisguide-Downloads, private Request-JSON-
Verarbeitung, 12-Sekunden-Deadline, Cachebudget, Queuepolitik, Auth und DTO bleiben
unverändert. DE-Supplement und EN-Bildfallback erhalten ihre Identitätsregeln;
fehlende oder abgewiesene Antworten erzeugen keinen erfundenen Preis.

Root-RED: **73 PASS / 10 FAIL**; die vier gültigen Kontrollen der 14 neuen Fälle
bestanden bereits. GREEN: **83/83** einschließlich sauberem Standalone-Paketimport,
Freigaberechten, UTF-8, exakter Grenzgröße, hängendem Cancel und verhindertem spätem
Cache-Warming. Belege unter `outputs/public-catalog-cache/`:
`2026-10-01T13-44-21-785Z-4180.log` und `2026-10-01T13-48-01-868Z-19060.log`.
Keine echte Providerantwort, Cloud-Latenz oder vollständige Preisabdeckung gemessen.

Vollständige lokale Web-Regression **1.199/1.199 in 73 Dateien** (21,66 s):
`outputs/release-local/2026-10-01T13-48-02-237Z-19188.{json,log}`. Bekannte JSDOM-
Canvas-/React-act-Warnungen bleiben sichtbar; sie sind kein Browser-Visualtest.
Typecheck und fokussierter Lint bestehen nach einer reinen URL-Typkorrektur in der
neuen GET-Fixture. Danach besteht auch der vollständige erneute Lauf **1.199/1.199**
in 54,61 s (`outputs/release-local/2026-10-01T13-50-31-363Z-19396.{json,log}`,
parallel zum Android-Build; keine Performancevergleichsmessung).
Der isolierte Produktionsmodus-Build besteht in **13,973 s**,
303 Quelldateien, synthetische Umgebung und Netzschutz. Root-`dist` und dieselben
neun Konfigurationsdateien bleiben unverändert (Integritätshash wie zuvor).
Belege: `outputs/release27-engineering-20261001/baseline/build-sharing-body-ui-oct01*`.
Kein Deployment, Firebase-/Signing-/Release-Eingriff. O(N)-Reads, Gesamtkosten,
globale Fan-out-Grenzen und vertrauenswürdige Ingresslimits bleiben offen.

## Echte Android/Web-Preiskonflikte, lokaler Nachweis 2026-10-01

Der separate Harness `tests/android-web-price-conflict-local/` prüft die bestehenden
Produktfunktionen, ohne deren Verhalten oder den älteren ACK/Pull/Clear-Harness zu
ändern. Zwei frische Demo-Läufe bestehen: explizit Cloud behalten und explizit
Lokal behalten. Jeweils drei Android- und zwei Web-Phasen sowie fünf unabhängige
vollständige Admin-Readbacks; Bereinigung zählt nicht als fachlicher Erfolgsfall.

Nach Android-ACK 532/rev1 speichert Web 450/rev2. Eine lokale Android-Auswahl
500 mit veralteter Basis 1 wird in zwei echten Worker-Pässen als Konflikt gehalten;
Payload, ursprüngliche Mutation und Basis bleiben erhalten, Server-rev2 ebenfalls.
Cloud-Entscheidung übernimmt rev2 ohne Serverwrite. Lokale Entscheidung erzeugt
erst nach explizitem Rebase mit neuer Mutation rev3/500; sourceAt 1000 und
selectedAt 3000 bleiben erhalten. Die abschließende echte Web-Subscription schreibt
nichts. Parent, alleiniger Google-Owner mit nur appAccess, Accountzustand und die
genau eine Sidecar-Zeile bleiben in jeder Phase separat geprüft.

PASS-Belege unter `outputs/android-web-price-conflict-local/`:

- `2026-10-01T14-28-51-954Z-cloud-46dbb61bb54245eaac5f5a7744799fb2/`
- `2026-10-01T14-30-05-496Z-local-d938e2045fde4aae8fdc7542e01d12a2/`

Beide Manifeste: Exit 0, Servernachweis und eigene Room-Bereinigung bestätigt,
Quell-/APK-Hashes unverändert, Ports frei, Reverse-Mappings leer, keine laufende
Instrumentation. Sieben reine Negativvalidatorfälle, Typecheck und fokussierter
Lint bestehen ebenfalls. Androids genaue Installationsbelege und der vollständige
371/371-Emulatorlauf in 270,701 s stehen im Schwesterrepository unter
`artifacts/android-regression/20261001T142307Z-3a9a405f/manifest.json`.

Dies beweist nicht Settings-UI/WorkManager-Scheduling, alle Auflösungsrennen,
große Sammlungen oder Produktionslatenz. Gate 4 bleibt offen. Keine Produkt-,
Rules-, Dependency-, Firebase-Produktions- oder Deploymentänderung durch diesen
Testblock; kein Xiaomi, Signing oder Release-AAB.

## Öffentliche Katalogabrufe: echte Parallelitätsgrenze, 2026-10-01

Der bestehende öffentliche Metadaten-Cache begrenzt jetzt zusätzlich alle tatsächlichen
Loader-Promises, auch ungetrackten Overflow: 32 aktiv, 512 wartend, FIFO pro Instanz.
Beide Resolvermodi teilen diese Grenze. Warme Cachetreffer benötigen keinen Platz.
Die bisherigen 64 Deduplizierungsplätze, TTL-/Bytebudgets, Preisidentitäten und
privaten Auth-/Widerrufsprüfungen sind unverändert. Queuezeit verbraucht die bestehende
Deadline; voller Puffer wird vorübergehend als nicht verfügbar beantwortet und nicht
negativ gecacht. Aktive Abrufe geben ihren Platz erst bei tatsächlichem Abschluss frei,
auch wenn sie Abort ignorieren. Keine Behauptung über physische Sockets oder Cloud-
Replikate, kein Umgehen fehlender vertrauenswürdiger Ingresslimits.

20 neue isolierte Fälle reproduzierten 16 Fehler vor der Änderung. Die vollständige
gezielte Auswahl besteht mit 103/103. Die echte Sharing-Handler-Simulation besteht
mit 12/12 bei 10/40/80 gleichzeitigen Lesern, je drei Wiederholungen. Alle Kartendaten,
Preise und privaten Prüfungen bleiben enthalten. 16/32/64-Slot-Messungen und deren
Latenz-/Kapazitätskompromiss sind in `tests/sharing-concurrency/README.md` dokumentiert;
32 ist eine konservative lokale Vorgabe, kein bewiesenes Produktionsoptimum oder
genereller Speedup. O(N)-Placement-Reads und globale Limits bleiben offen.

Typecheck/fokussierter Lint bestehen. Isolierter Produktionsmodus-Build: 13,058 s,
303 Quelldateien, synthetische Umgebung/Netzschutz, kein Deployment. Root-dist und
neun Build-/Deploydateien behalten Hash
`fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`.
Beleg: `outputs/release27-engineering-20261001/baseline/build-loader-pool-final*`.

Abschließende vollständige Web-Regression am finalen 32er-Stand: **1.199/1.199**,
keine Fehler/Skips, zusätzlich zur 103er-Cacheauswahl. Beleg:
`outputs/release-local/2026-10-01T14-47-32-920Z-13920.{json,log}`.
Die bestehenden React-act-/JSDOM-Canvas-Warnungen bleiben offen als Harnessgrenze;
dies ersetzt keinen Browser-Visualtest. Keine Signierung oder Veröffentlichung.

## Langsame öffentliche Binder-Antworten und begrenztes Warten (2026-10-01)

Der tatsächliche Viewer startete alle 15 Sekunden eine neue Anfrage und erklärte
dadurch noch laufende Antworten für veraltet. Im reproduzierten 20-Sekunden-Fall
kam trotz erfolgreicher Antworten kein Binder zur Anzeige. Ein hängender Fetch
oder JSON-Body hatte außerdem keine eigene Frist.

Periodische Ticks überspringen jetzt eine laufende Anfrage einschließlich ihres
JSON-Bodys, ohne die Antwortversion zu verändern. Expliziter Retry und erneute
Tab-Sichtbarkeit behalten ihre Priorität und brechen den Vorgänger ab. Eine
30-Sekunden-Frist pro Anfrage entfernt alte Binder-/Modalinhalte bei fehlendem
Abschluss und gibt den lokalen Anfrageslot frei. Der nächste reguläre Tick oder
ein manueller Retry kann erneut laden. Share-/Seitenwechsel und Unmount brechen
die zugehörige Anfrage ab und entfernen Frist/Listener. Verspätete alte Antworten
oder finally-Blöcke dürfen weder Inhalte wiederbeleben noch neuere Anfragen freigeben.

Vorher: 1.204 PASS / vier gezielte Fehler; nachher **1.208/1.208 PASS**, keine Skips.
Sieben neue Fälle decken langsame Header/JSON, beide Fristabläufe mit Wiederanlauf
und Token-/Seiten-/Unmount-Wechsel ab. Typecheck und fokussierter Lint bestehen.
Belege: `outputs/release-local/2026-10-01T16-00-29-476Z-20668.{json,log}` (RED)
und `outputs/release-local/2026-10-01T16-07-05-543Z-18044.{json,log}` (GREEN).
Isolierter Produktionsmodus-Build: 13,181 s, 303 Quelldateien, synthetische
Umgebung und Netzsperre, Exit 0. Root-dist und neun Konfigurationsdateien behalten
Integritätshash `fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`.
Beleg: `outputs/release27-engineering-20261001/baseline/build-viewer-deadline-green*`.

Die Frist ist lokal, kein Server-SLA und keine Garantie über das Ende bereits
laufender Serverarbeit oder deren Kosten. Unter ignoriertem Abort wird nur der
logische Slot freigegeben. Widerruf bleibt requestbasiert, nicht Push; 15-Sekunden-
Ticks garantieren bei langsamen Antworten keine exakt 15-sekündige Sichtbarkeit.
Die API bleibt no-store mit ihren bestehenden Berechtigungsprüfungen. Bestehende
React-act-/JSDOM-Canvas-Warnungen bleiben Harnessgrenzen. Kein Deployment.

## Öffentliche Binder: begrenzte Entry-Felder (2026-10-01)

Die bestehenden 100er-Entry-Batches verwenden nun die echte Admin-SDK-Feldmaske
mit 13 benötigten Feldern: Owner, Sync-ID, Löschstatus, Menge, Karten-/Set-ID,
Legacy-Set-ID, Sammlernummer, Sprache, Finish/Variante und externe Produktbindung.
Private Notizen, Anschaffungsdaten und eigene Fotos werden dadurch schon beim
internen Lesen weggelassen. Das bisherige öffentliche DTO war bereits eine
Allowlist; diese Änderung behauptet keine zuvor nachgewiesene öffentliche Datenpanne.
Preis-Sidecars, Zugangs-/Widerrufsprüfungen und fehlende Snapshots bleiben unverändert.
Die Menge bleibt Zulassungsprüfung, kein neuer Multiplikator für Binderwerte.

Fünf neue Handlerfälle prüfen vollständige DTO-Parität über alle acht Freigabe-
Optionen, Normal/Reverse, Trend und manuelle Alternative, Legacy-/Missing-Fälle
sowie ausgeschlossene große private Felder. SDK-nahe Doubles wenden die Maske
tatsächlich an und zählen die abschließende ReadOptions nicht als Dokument.
Vorher: 1.211 PASS / zwei gezielte Feldmaskenfehler, danach **1.213/1.213 PASS**.
Belege: `outputs/release-local/2026-10-01T16-47-16-602Z-19900.{json,log}` und
`outputs/release-local/2026-10-01T16-49-14-243Z-1940.{json,log}`.
Auch der abschließende Lauf nach der SDK-Test-Lintkorrektur besteht mit
**1.213/1.213**, keine Skips: `outputs/release-local/2026-10-01T17-02-26-915Z-23000.{json,log}`.

Zusätzlich wurde die unveränderte echte Admin-SDK-getAll-Methode im isolierten
Auth-/Firestore-/Storage-Demoharness beobachtet: gespeichertes privates Original
unverändert, tatsächliches Ergebnis nur 13 Felder, fehlendes Dokument weiterhin
fehlend, Preise/DTO unverändert. RED **30 PASS / ein Maskenfehler** unter
`outputs/release27-engineering-20261001/security-gate10-deletion/run-20261001-184742-57bd042d/`;
final **31/31 PASS**, keine Skips und keine verbliebenen Emulatorports, unter
`run-20261001-190044-a6926128/` im selben Verzeichnis. Keine Produktivkonten/-daten.

Typecheck und fokussierter Lint bestehen. Scale **9/9**, Concurrency **12/12**,
je drei Wiederholungen der vorgesehenen synthetischen Lastfälle; Zählverträge
und maximal 32 Loader bleiben unverändert. Logs:
`outputs/release27-engineering-20261001/entry-projection-{scale,concurrency}-final.log`
und `outputs/sharing-concurrency/2026-10-01T17-01-45-754Z-22248.metrics.json`.
Isolierter Produktionsmodus-Build: **13,229 s**, 303 Quelldateien, synthetische
Umgebung/Netzsperre, Exit 0. Root-dist und neun Konfigurationsdateien behalten
Hash `fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`;
Belege: `outputs/release27-engineering-20261001/baseline/build-entry-projection-green*`.

Dies reduziert unnötige geladene Felder, **nicht die Anzahl abgerechneter Reads**.
Keine gemessene Cloud-Latenzverbesserung, keine O(page)- oder Kostenbehauptung;
O(N)-Placements, Gesamtsummenarbeit und öffentliche Ingresslimits bleiben offen.
Keine Rules-/Signing-/Releaseänderung, kein Deployment.

## Geteilte Binder: signalisierten Request-Abbruch respektieren (2026-10-01)

`readBinderShare` prüft nun an Await-/Batch-Grenzen und vor der Antwort, ob sein
Request abgebrochen wurde. Weitere 100er-Entry-/Sidecar-Batches, Katalogjobs und
abschließende Reads starten dann nicht mehr. Bereits gestartete SDK-Aufrufe
werden normal abgewartet. Die Katalogphase erhält einen eigenen Consumer-
Controller mit Request-Brücke und unveränderter 12-Sekunden-Frist. Cleanup entfernt
Listener/Timer und beendet eigene übrige Worker auch bei Fehlern. Kein Cache-
Loadercontroller wird von einem einzelnen Leser übernommen. Normales Timeout
liefert weiterhin partielle Ergebnisse; Request-Abbruch liefert nur den festen
sanitisierten bestehenden 503-Fehler, niemals einen Binder-DTO oder abort.reason.

Acht neue Fälle zunächst **1.214 PASS / sieben gezielte FAIL**, danach
**1.221/1.221**. Zwei zusätzliche Kontrollen für manipulierten Abbruchgrund und
Workerfehler-Cleanup: final **1.223/1.223**, kein Skip. Belege unter
`outputs/release-local/`: `2026-10-01T17-06-42-655Z-9088.{json,log}` (RED),
`2026-10-01T17-08-27-202Z-17524.{json,log}` (GREEN),
`2026-10-01T17-10-09-358Z-22832.{json,log}` (final).
Typecheck, fokussierter Lint und zehn Auswahl-/Umgebungsschutztests bestehen.
Die bestehende Katalog-/Runtime-/Standalone-Auswahl besteht mit **103/103**:
`outputs/public-catalog-cache/2026-10-01T17-09-30-794Z-22624.log`.
Echte isolierte SDK-Regression **31/31**, eigene Ports anschließend frei:
`outputs/release27-engineering-20261001/security-gate10-deletion/run-20261001-191032-f0ea80d1/`.
Scale **9/9** und Concurrency **12/12**, je drei vorgesehene Wiederholungen,
bleiben ebenfalls grün: `outputs/release27-engineering-20261001/request-abort-{scale,concurrency}-green.log`
und `outputs/sharing-concurrency/2026-10-01T17-12-47-075Z-8612.metrics.json`.
Isolierter Produktionsmodus-Build: **18,983 s**, 303 Quelldateien, synthetische
Umgebung/Netzsperre. Root-dist und neun Konfigurationsdateien behalten den
Integritätshash `fbc3b489d56287d0dd84b2a4bedcbf0b17113621f5d3e74872fcc76e95fdf95f`.
Belege: `outputs/release27-engineering-20261001/baseline/build-request-abort-green*`.

**Wesentliche Grenze:** Im installierten vinext-Node-Produktionspfad erzeugt
`nodeToWebRequest` kein Browser-Disconnect-Signal. Unser eigener Einstieg ergänzt
ebenfalls keines. Dieser Fix schützt korrekt signalisierte Web-Requests; er
beweist derzeit keine reale Einsparung bei Browser-Disconnects. Framework,
Packaging und Produktion wurden nicht geändert. Bereits gestartete RPCs,
abortignorierende Provider sowie der unabhängige geteilte Preisguide dürfen bis
zum eigenen Abschluss weiterlaufen. Keine Kosten-/Socket-/Cloud-SLA-Behauptung,
kein Deployment; Gate 6 und das externe Ingressgate bleiben offen.
