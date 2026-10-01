# Web-App: Übergabe für Release 27

Stand: 01.10.2026. Dieses Dokument gehört ausschließlich zum separaten Repository
`DomiDex-Web`; Android liegt im benachbarten Repository `CardVault`. Keine Kopie der
Web-Implementierung im Android-Repository pflegen.

## Geltungsbereich und belastbarer Stand

- Eingefrorene Web-Baseline: `6caa46a`; Android-Baseline des übergeordneten Runs:
  `53b4e40d`. Die Baseline enthält bereits vor diesem Run vorhandene Änderungen.
- **In diesem Prüfabschnitt umgesetzt:** ausschließlich typkorrekte Test-Fixtures,
  eine Laufzeit-Typprüfung für den Select-Test und korrekte synchrone Registrierung
  der neun `node:test`-Regeltests. Keine Assertion abgeschwächt, keine Suppression.
- **Gate 2 danach lokal implementiert, noch nicht veröffentlicht:** verteilter
  UID-Schreib-Limiter, serverseitige Revalidierung der Rollenvergabe, zugehöriger
  exakter Kontolösch-Cleanup und Packaging-Importfix. Zusätzliche
  Preis-/Sharing-Optimierungen sind weiterhin nicht umgesetzt.
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
sein enger Kopierpfad enthält das neue Rate-Modul nicht und nutzt eine archivierte
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
- Große Sammlung/Binder mit warmem und kaltem Cache messen; aktuelles
  `use-collection-prices` setzt bei Zustandsänderungen Preiszustand zurück und lädt
  gebündelt neu. Optimierung erst nach Reproduktion, ohne Auth-/Sync-Abkürzung.
- Späterer echter Release-/Container-Smoke-Test mit ausdrücklich freigegebenem
  Deployment-Kontext erforderlich. Synthetischer Build ist keine Deploymentfreigabe.
- Gate 9: Functions-Codebase-Überschneidung/`isCurrentEvidence`-Drift zwischen
  Android und Web auflösen, kanonischen Backend-/Deploy-Eigentümer dokumentieren
  und Regressionstest gegen versehentliches Überschreiben vorsehen.
