# Release 27 — öffentliche Binder-Reads: Gate 2/6

Stand: 01.10.2026, lokaler Source-Audit mit getrennt gekennzeichnetem
Retry-Cleanup-Follow-up. Keine Cloud-/Auth-/Netzabfragen, keine Rules-/Ingressänderung
und kein Deployment für diesen Bericht.

## Status und Beleggrenzen

**Anonymes IP-/Token-Rate-Limiting ist nicht implementiert.** Es gibt auch keinen
neu eingebauten, lediglich deaktivierten öffentlichen Limiter. Ein solcher wird
nicht spekulativ ergänzt: Die vertrauenswürdige produktive Ingress-/Client-IP-
Grenze ist im geprüften Repository nicht belegt. Die bestehenden authentifizierten
Write-Limits sind davon unabhängig und kein Nachweis für geschützte öffentliche Reads.

Der lokale Katalogcache spart wiederholte öffentliche Providerabrufe, aber keine
Firestore-Reads und keine Autorisierungsprüfungen. Er ist kein Rate-Limiter.
Dieser Bericht belegt weder aktuellen Cloud-Run-Traffic noch aktive Edge-Policies.
Es wurden keine Secretwerte gelesen; eine im Repository nicht belegte
Konfiguration ist nicht automatisch auch in der Produktion nicht vorhanden.

## Tatsächlich geprüfter Requestpfad

- `firebase.json`, `hosting.rewrites`: Catch-all auf Cloud Run `domidex-web`,
  Region `europe-west1`, `pinTag: true`. Kein Nachweis für gesperrte direkte
  Cloud-Run-/Tag-URLs, bereinigte IP-Header oder einen vorgeschalteten IP-Limiter.
- `Dockerfile`: Node-Port 8080, `VINEXT_TRUST_PROXY=1`, explizite
  `VINEXT_TRUSTED_HOSTS`. Diese Konfiguration beglaubigt keine Client-IP.
- Lokal installiertes `vinext` laut `package.json`: `1.0.0-beta.5`.
  `node_modules/vinext/dist/server/proxy-trust.js` prüft Proto/Host, nicht IPs.
  `prod-server.js`, `nodeToWebRequest`, kopiert HTTP-Header in einen Fetch-Request,
  ohne eine verifizierte Socket-/Client-IP-Identität an unseren Handler zu geben.
  `request-pipeline.js`, `filterInternalHeaders`, entfernt Framework-internen
  Headerzustand, ist aber kein allgemeiner Client-IP-Provenienzprüfer.
- `app/api/shared-binders/[token]/route.ts` delegiert GET über
  `lib/server/private-cloud-operations.ts` direkt an `readBinderShare`.
- Der historische Zusatzrouter `scripts/sharing-runtime.mjs` delegiert denselben
  öffentlichen API-Pfad. `scripts/prepare-sharing-release.mjs` erzeugt dessen
  Runtime-Wrapper, ist aber kein für den aktuellen Stand freigegebener Packer.
  Historische Aktivierungsberichte sind kein Nachweis des heutigen Live-Ingress.

## Last- und Datenschutzbefunde

`backend/security/sharing.mjs`, `createBinderShare`/`readBinderShare`:

- Freigabetokens entstehen aus 32 Zufallsbytes; gespeichert wird ihr SHA-256-Hash.
  Das primäre verbleibende Risiko ist Last-/Kostenmissbrauch, nicht ein praktisch
  erfolgversprechendes Durchprobieren des gesamten zufälligen Tokenraums.
- Ein syntaktisch gültiger unbekannter Token führt derzeit zu einem Share-Read.
  Danach folgt 404, ohne Budgetdokument. Es gibt keine vorgelagerte Anfragenquote.
- Bei einer gültigen Freigabe folgen aktuelle Owner-/Lösch-/Binderprüfungen,
  eine Placementabfrage bis 5.001 Dokumente, benötigte Entry-Reads und Katalogarbeit.
  `showTotal` erweitert die Entry-/Katalogarbeit auf den gesamten Binder.
  Finale Widerruf-/Owner-/Binderprüfungen bleiben sicherheitsrelevant.
- `components/shared-binder-viewer.tsx`: sofortiges Laden, sichtbares Tab alle
  15 Sekunden erneut laden, zusätzlich Visibilitywechsel, Seitenwechsel und
  manueller Retry. Grob vier periodische Requests pro Minute und offenem Tab,
  zuzüglich Initial-/Interaktionsaufrufen. Langsame Requests können überlappen.
- Android: `CardVault/app/src/main/java/com/dominik/cardvault/data/sharing/`
  `SharedBinderReader.kt` wartet jeweils 15 Sekunden nach einem Ladeversuch;
  `ui/SharedBinderScreen.kt` bindet die Subscription an Sichtbarkeit/Lifecycle.
  Das ist kein identischer fester Web-Intervalltakt.
- Ein gemeinsames knappes Tokenlimit kann legitime viele Zuschauer desselben
  Streamer-Binders aussperren. Grenzwerte benötigen eine bewusste Betriebsentscheidung.
- Keine neuen Roh-IP-/Token-/URL-Speicherungen und keine Logs mit solchen Werten
  oder Fingerprints einführen. Begrenzte HMAC-Budgetkeys bedürfen eines eigenen Vertrags.
  Provider-Requestlogs und deren URL-/IP-Behandlung sind zusätzlich extern zu prüfen;
  die vorhandenen privaten Antwortheader lösen dieses Infrastrukturthema nicht.

## Web-Viewer: konkrete Request-Lebensdauerbefunde

Ergänzender Source-Audit von `components/shared-binder-viewer.tsx`,
`tests/shared-binder-ui.test.tsx` und `tests/shared-binder-viewer-refresh.test.tsx`.
Die folgenden Abläufe sind aus dem Code abgeleitet, keine gemessenen
Produktionslatenzen und keine Aussage über eine Provider-SLA.

- Initialer Aufruf, 15-Sekunden-Intervall und Visibility-Aktualisierung verwenden
  denselben Controller der Effect-Lebensdauer. Ein weiterer Aufruf erhöht
  `requestVersion`, bricht den Vorgänger aber nicht ab. Der Versionsvergleich
  verhindert die Veröffentlichung veralteter Antworten, nicht parallele Requests.
- Konkreter Verwerfungsfall: Bei durchgehend sichtbarem Tab und angenommenen
  20 Sekunden Antwortdauer starten Requests bei Sekunde 0, 15 und 30. Die erste
  Antwort bei Sekunde 20 ist bereits veraltet, die zweite bei Sekunde 35 ebenfalls.
  Setzt sich dieser Ablauf fort, wird keine erfolgreiche Antwort veröffentlicht.
  Ohne vorherige Daten bleibt die Ladeanzeige stehen; bereits dargestellte Daten
  werden durch diese verworfenen Antworten nicht aktualisiert. Zusätzliche
  Visibility-Aufrufe können weitere Requests und Versionen erzeugen.
- **Historischer Retry-Befund, inzwischen lokal korrigiert:** „Erneut versuchen“
  erzeugte einen eigenen `AbortController`, ohne ihn für das Cleanup zu speichern.
  Dieser manuelle Request wurde deshalb bei Unmount oder Freigabewechsel nicht
  durch den Effect-Controller abgebrochen. Der minimale lokale Fix hält den
  bestehenden Effect-Controller in `requestLifetime`; manuelle Retries teilen
  jetzt dessen Signal und damit das Cleanup bei Seiten-/Tokenwechsel und Unmount.
  Das Cleanup leert die Referenz nur, wenn sie noch auf seinen eigenen Controller
  zeigt. Es gibt weder Abbruch vor jedem Refresh noch Coalescing oder neue Timeouts.
  Mehrfache Retries können während derselben Lebensdauer weiterhin überlappen.
  Die bereits vorhandene Versionsprüfung gegen alte Antworten bleibt unverändert;
  diese Korrektur ist kein neu eingeführter Schutz vor veralteten DTOs.
- Die bisherigen Viewer-Tests belegen die jüngste zulässige DTO-Veröffentlichung,
  das Entfernen widerrufener Preise/Karten und den Schutz vor verspäteten alten
  Antworten. Zwei neue reale Komponententests prüfen zusätzlich einen manuellen
  Retry mit offenem Fetch bei Unmount sowie einen offenen Retry-JSON-Body bei
  Tokenwechsel einschließlich verspäteter alter Antwort. Der lokale RED-Lauf
  vor dem Fix ergab 1.199 PASS / 2 FAIL, beide exakt am noch nicht abgebrochenen
  Retry-Signal: `outputs/release-local/2026-10-01T15-08-35-416Z-4664.json`
  und die gleichnamige `.log`-Datei. Anschließend **1.201/1.201 PASS, kein Skip**:
  `outputs/release-local/2026-10-01T15-10-38-849Z-8752.{json,log}`.
  Typecheck und gezieltes Lint bestanden ebenfalls; der isolierte Produktionsmodus-
  Build dauerte 19,304 Sekunden. Root-`dist` und neun Build-/Deploymentdateien
  blieben unverändert (`baseline/build-viewer-manual-retry-*` unter
  `outputs/release27-engineering-20261001/`). Kein Deployment. Die Tests sind kein Nachweis
  einer Obergrenze tatsächlich laufender Requests oder von beendetem Serveraufwand.

Der Viewer ruft direkt Browser-`fetch` mit einem Signal auf. Der API-Router und
`privateOperations` reichen das `Request`-Objekt an `readBinderShare` weiter;
die Operation wertet dessen `request.signal` aber nicht aus. Die Katalogphase
verwendet ihren eigenen 12-Sekunden-Abbruch, und die Firestore-Reads sind nicht
an den Browser-Abbruch gebunden. Ein Client-Abbruch ist somit kein Nachweis dafür,
dass die bereits gestartete Server-/Firestore-/Providerarbeit endet oder deren
Kosten entfallen. Die Katalogdeadline ist außerdem keine Gesamtdeadline der
HTTP-Anfrage einschließlich Datenbank- und abschließender Berechtigungsprüfungen.

Der lokal ergänzte Pool mit 32 aktiven Loadern und 512 FIFO-Wartenden begrenzt
Loader-Promises pro Cacheinstanz. Er löst weder diesen Browser-Lebensdauerbefund
noch anonymes Rate-Limiting, deploymentsweite Parallelität oder garantierte
Socket-/Gesamtspeichergrenzen.

**Noch keine Polling-/Timeout-Änderung:** Abbruch vor jedem Intervallrequest würde
den beschriebenen Verwerfungsfall nicht beheben. Automatisches Zusammenfassen
gleichzeitiger Aktualisierungen könnte eine langsame Antwort fertig werden lassen,
würde aber die Frequenz neuer Widerrufprüfungen ändern; ohne weitere Grenze könnte
ein hängender Request diese dauerhaft aufhalten. Über den separat korrigierten
Controllerbesitz hinaus müssen Frische-/Timeout-Semantik und ihre Tests vor einer
weiteren Produktänderung bewusst entschieden werden. Der bestehende 15-Sekunden-Takt,
die finalen Berechtigungsprüfungen und die Darstellung privater Auswahlen bleiben unverändert.

## Vorhandene Technik, die gezielt wiederverwendbar wäre

`backend/security/rate-limit.mjs` limitiert nur verifizierte UID-Schreibaktionen:
Upload, Share-Erstellung und Rollenvergabe. Der Default ist `monitor`.
Firestore-Transaktionen verwenden serverseitige `readTime`, einen begrenzten Zähler
pro UID/Policy, den Account-Löschlock, feste Fenster und ein `expiresAt`-Feld.
Dieses Feld allein ist kein Beleg einer eingerichteten Firestore-TTL-Policy.
SDK-Retries erzeugen keine doppelte Beobachtung; 429 enthält `Retry-After` und eine
abgesicherte Fehlerhülle. `tests/write-rate-limit.test.mjs` und
`tests/write-rate-limit.emulator.test.mjs` enthalten die einschlägigen Tests.
Für dieses Read-only-Audit wurden sie nicht neu ausgeführt.

Diese Technik darf nicht blind mit anonymen IPs oder Tokens als angeblicher UID
aufgerufen werden. Insbesondere verursacht der Write-Monitor Datenbankzugriffe
und kann bei Infrastrukturfehlern 503 liefern: kein regressionsfreier Read-Default.
Ein zukünftiger verteilter Tokenzähler dürfte höchstens für tatsächlich bestehende
Freigaben entstehen, transaktional mit Existenz/Widerruf/Löschsperre geprüft.
Keine neuen Dokumente pro Rate-Limit-Versuch, unbekanntem Token oder IP×Token-Paar.
Löschung/Retention wären vor neuer Persistenz ausdrücklich zu ergänzen und zu testen.

## Unverzichtbares manuelles externes Gate vor einer Implementierungsentscheidung

1. Produktiven Eingang und sämtliche direkten Origin-/Tag-/Domain-Umgehungswege
   prüfen; effektive Ingress-/IAM-/Proxykonfiguration belegen.
2. Client-IP-Provenienz festlegen: nachgewiesen bereinigte vertrauenswürdige
   Proxykette oder verifizierte Edge-Assertion. Niemals blind den ersten oder
   letzten X-Forwarded-For-Wert, einen Hostnamen oder `request.cf` übernehmen.
3. Kostenbegrenzung vor dem ersten Firestore-Read entwerfen. Ein rein lokaler,
   begrenzter Zähler kann ergänzen, ersetzt aber keinen verteilten Edge-Schutz.
4. Falls die gewählte Lösung HMAC benötigt: dediziertes Secret sicher bereitstellen,
   Zugriff und Rotation über laufende Fenster festlegen. Keine Roh-IP-/Tokenkeys,
   kein Secret im Repository oder Frontend; Fingerprints sind keine Anonymitätszusage.
5. Logging/Redaktion/Retention, normale Pollinglast, populäre Freigaben und
   konkrete Quoten entscheiden. Vor Freigabe weder Monitor noch Enforce aktivieren.
6. Tests: Spoofing und IPv4/IPv6, begrenzte Kardinalität bei unbekannten Tokens,
   zwei Instanzen, Fenstergrenzen/Retry, Revoke-/Löschrennen, GET/HEAD, private
   Fehlerhüllen und nichtprotokollierte Identitäten. Keine Cloud-Latenz aus Mocks ableiten.

## HEAD: konkreter Befund und kleiner möglicher Folgeschritt

`scripts/sharing-runtime.mjs` erlaubt HEAD auch für `/api/shared-binders/{token}`,
ruft die vollständige Read-Operation auf und entfernt erst danach den Body.
Auch der aktuelle GET-only-App-Router ist nicht automatisch geschützt:
`node_modules/vinext/dist/server/app-route-handler-policy.js` übernimmt GET als
Fallback für HEAD; `app-route-handler-runtime.js` führt HEAD entsprechend als erlaubt.

Kein erforderlicher HEAD-Aufruf an diese API wurde in den geprüften DomiDex-
Clients gefunden: Web nutzt `fetch` ohne Methodenoverride; Android
`SharedBinderClient.kt`, `PublicSharedBinderTransport.get`, verwendet explizit
OkHttp `.get()`. Der vorhandene Live-Prüfhelfer nutzt ebenfalls GET.
Das ist ein Sourcebefund, kein Ausschluss externer Crawler/Linkchecker und kein
neuer Nachweis aus dem unveränderten signierten Release-26-AAB.

Kleinster erwägenswerter Folgeschritt: nur API-HEAD bewusst mit bodylosem 405 und
`Allow: GET` vor teuren Reads ablehnen, konsistent im historischen Router und mit
explizitem HEAD-Handler im aktuellen App-Router. Das ist eine zu genehmigende
HTTP-Vertragsänderung, kein bereits implementierter Fix. Eine bloß vereinfachte
200-Antwort würde die bisherigen Existenz-/Seiten-/Fehlerprüfungen verfälschen.
HEAD für `/share/...`, statische Assets und `/.well-known/assetlinks.json` bleibt
davon getrennt; der Association-HEAD ist ausdrücklich in
`tests/sharing-runtime.test.mjs` abgesichert und darf nicht pauschal entfernt werden.
Vor Änderung: Tests für null DB-/Katalogaufrufe bei API-HEAD, leeren Body,
Methoden-/Securityheader, unverändertes GET/Revoke und beide Runtimewege ergänzen.

**Entscheidung zu öffentlichen Read-Limits:** Nur Befunde dokumentiert. Kein
öffentlicher Limiter, keine HEAD-Änderung, keine neue Secret-/Proxy-/Firestore-Konfiguration.
Der oben separat beschriebene lokale Retry-Cleanup-Fix ändert diese Entscheidung
und die offenen Polling-/Serverlastgrenzen nicht.
