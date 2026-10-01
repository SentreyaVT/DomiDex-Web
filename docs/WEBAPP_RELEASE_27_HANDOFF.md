# Web-App: Übergabe für Release 27

Stand: 01.10.2026. Dieses Dokument gehört ausschließlich zum separaten Repository
`DomiDex-Web`; Android liegt im benachbarten Repository `CardVault`. Keine Kopie der
Web-Implementierung im Android-Repository pflegen.

## Geltungsbereich und belastbarer Stand

- Eingefrorene Web-Baseline: `6caa46a`; Android-Baseline des übergeordneten Runs:
  `53b4e40d`. Die Baseline enthält bereits vor diesem Run vorhandene Änderungen.
- **Im initialen Baseline-Prüfabschnitt umgesetzt:** ausschließlich typkorrekte Test-Fixtures,
  eine Laufzeit-Typprüfung für den Select-Test und korrekte synchrone Registrierung
  der neun `node:test`-Regeltests. Keine Assertion abgeschwächt, keine Suppression.
- **Gate 2 danach lokal implementiert, noch nicht veröffentlicht:** verteilter
  UID-Schreib-Limiter, serverseitige Revalidierung der Rollenvergabe, zugehöriger
  exakter Kontolösch-Cleanup und Packaging-Importfix. Zusätzliche
  Umfangreiche Preis-/Sharing-Architekturänderungen sind weiterhin nicht umgesetzt.
- **Gate 3 danach lokal implementiert, noch nicht aktiviert:** optionale
  App-Check-Beobachtung, Default-off; keine neue Zugangssperre oder Enforcement.
- **Gate 4: isolierter Listener-Lifecycle-Fix lokal implementiert:** Preiswahl-
  Abonnement erst nach App-Freigabe, veraltete Callbacks abgefangen und expliziter
  Wiederverbindungsbutton. Die vorhandenen Owner-Listener verarbeiten jetzt
  inkrementelle SDK-Dokumentänderungen; die Remote-Queries bleiben unverändert.
  Noch keine paginierte allgemeine Initial-/Delta-Sync-Architektur.
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
- **Bestätigte Architekturabweichung:** dieser Sharing-Katalogpfad lädt TCGdex
  direkt; er übernimmt weder den Anniversary-Priceguide-Zusatz des Web-Resolvers
  noch `collectionPriceSelections`. Eine identische alternative Bewertung in einer
  freigegebenen Ansicht ist daher noch nicht zugesichert.
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
und `gate6-root-deletion-compat.log`. DTO, Freigabeoptionen, Cache, Schema, Preise
und Sidecars bleiben unverändert. Keine Live-Firebase- oder signierte-v26-E2E-Prüfung.

Die größere Skalierungsarbeit bleibt offen: Die jetzige globale Slotkollisions-
auflösung reserviert alle belegten Plätze und verschiebt Überläufe kontrolliert.
Eine naive Slotbereichs-Abfrage würde Karten/Seitenzahl verlieren. Materialisierte
Seiten und Gesamtwerte benötigen einen eigenen kompatiblen Invalidierungsvertrag.
Rechte-/Binder-/Share-Daten bleiben ungecacht, Antworten `no-store`. Ein späterer
Katalog-Cache darf ausschließlich validierte öffentliche Daten verwenden; fremde
Bildhosts und private alternative Preiswahlen werden nicht still veröffentlicht.

### Weiter offene Abnahme

- Security-Emulatorergebnisse einschließlich der neun erneut registrierten
  Sharing-Regeltests separat grün belegen; keine Testzahlen doppelt zählen.
- Vollständige Karten-/Set-Preisabdeckung mit begründeten Restlücken, Varianten,
  Quarantäne und nicht verfügbaren Anbieterdaten; niemals Preise erfinden.
- Android/Web-Migration und bidirektionale Preiswahl: bestehende Nutzer, parallele
  Änderungen, Offline/Online, Revisionskonflikte, Accountwechsel, Tombstones,
  Wiederkehr eines Trendpreises, Rollenentzug und Löschsperre testen.
- Sharing-/Alternativpreis-Entscheidung explizit treffen; Sichtbarkeitsoptionen und
  Datenschutz-Allowlist erhalten, alte Links/Widerruf/Android-Web-Fallback testen.
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
