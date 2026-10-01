# Release 27 – Observability, Ressourcenbedarf und Kostenmessung

Stand: 01.10.2026. Rein lokaler Bestandsaudit zu Gate 11/12 und Kostenabschnitt 15.
Gelesener Web-Stand: `1113d57`; Android-Stand während des Audits: `843dc07`.
Parallel erstellte Änderungen anderer Agents gehören nicht zu diesem Audit.
Keine Cloud-, Billing-, Auth-, Provider- oder Produktionsabfrage; kein Deployment.
Neu sind ausschließlich dieses Dokument und das offline ausführbare Modell in
`tests/cost-model/`. Keine Runtime-, Budget-, Rollen- oder Logging-Einstellung geändert.

## Ergebnis und Beleggrenze

- **Kostenmessung vorbereitet**, aber **produktives Monitoring nicht nachgewiesen**.
- Es existieren einzelne sichere Ereignisse, jedoch kein durchgängiger lokaler
  Nachweis für HTTP-Status-/Latenzmetriken, Dashboards, Alarmwege oder Budgetalarme.
- Keine Euro-/Dollarpreise, kostenlosen Kontingente, Steuern oder Wechselkurse
  angenommen. Geldkosten bleiben `null`, bis Region/SKUs, reale Mengen und
  genehmigte aktuelle Einheitspreise vorliegen. Das ist keine Monetarisierungsentscheidung.
- Simulierte logische Dokumentzugriffe sind **keine Rechnungsvorhersage**:
  Index-/Rules-Reads, leere Queries, SDK-Retries, Abrechnungsminimums und Plattform-
  Overhead sind nicht vollständig modelliert.
- Weder „95 % unter 500 ms“ noch „unter 1 % Produktionsfehler“ sind abgenommen.
  Die lokale 10/40/80-Matrix ersetzt keinen Cloud-Run-/Firestore-Lasttest.

## Tatsächliche Infrastruktur und bestehende Signale

| Bereich | Lokal belegt | Nicht belegt / fehlt im untersuchten Stand |
|---|---|---|
| Hosting/Cloud Run | `firebase.json`: Hosting-Rewrite auf `domidex-web`, `europe-west1`, `pinTag` | Aktuelle Instanzgrenzen, CPU/RAM, Parallelität, Billingmodus, produktive Revision und Dashboard |
| Functions | `backend/scan-knowledge/index.js`: Firestore-v2-Trigger, `maxInstances: 10` | Tatsächlich aktive Konfiguration, Retry-Policy, Ausführungs-/Fehler-/Kostenwerte |
| Write Rate Limit | `backend/security/rate-limit.mjs`: feste `policy`/`mode`, Ereignis `WRITE_RATE_LIMIT_EXCEEDED` | Zähler für erlaubte Requests; produktiver Modus; Alarm |
| App Check | `backend/security/app-check.mjs`: feste Route/Reason; standardmäßig `off`, nur optional `monitor` | Aktivierung/Verifizierungsrate in Produktion; kein Enforce-Modus |
| Auth-Fehler | `backend/security/firebase.mjs`: `PRIVATE_AUTH_REJECTED`, grammatisch begrenzter Fehlercode | Vollständige 401-/403-Zählung und feste Code-Allowlist |
| Serverfehler | `lib/server/server-failure.ts`: UUID, feste Operation am Aufruf, begrenzter Fehlercode, 503 | Einheitliche Anwendung auf alle APIs; gemeinsamer Latenz-/Status-Interceptor |
| Öffentliche Binder | Tatsächlicher Handler und lokale Zugriffszähler in Sharing-Tests | Produktive Request-/Cache-/Read-Metrik; anonymer Read-Limiter |
| Scannerberichte | Größen-/Auth-/Quota-/Ownership-Prüfungen in `backend/security/images.mjs` | Aggregierte Erfolgs-, Abbruch-, Cleanup- und Traffic-Metrik |
| Firestore/Storage | Explizite Client-, Admin-, Upload- und Triggerpfade | Tatsächliche Reads/Writes/Storage/Traffic und Retention-/TTL-Konfiguration |

`scripts/activate-sharing-runtime.mjs` übernimmt vorhandene externe Revisions-
Annotationen einschließlich `maxScale`; es setzt keine lokal belegte Grenze „2“.
Das Script wurde nicht ausgeführt. `Dockerfile` setzt Proxy-/Hostparameter, aber
keine verifizierte Client-IP-Provenienz. Siehe `RELEASE_27_PUBLIC_READ_LIMITS.md`.
Cloud Run nicht blind höher skalieren: mehr Instanzen vervielfachen auch isolierte
Cachebestände und mögliche Kaltstarts/Provideranfragen.

## HTTP-Status und Logging

401, 403, 409, 429 und 5xx sind in API-Antworten unterscheidbar, aber die Antwort
allein ist noch kein Monitoring. `failure()` in `backend/security/firebase.mjs`
gibt bekannte Codes beziehungsweise `SERVER_OPERATION_FAILED` zurück; viele
503-Antworten erzeugen dort kein eigenes Anwendungslog. Admin-Routen benutzen
teilweise `serverFailure()`, teilweise eigene sichere Fehlerantworten.

`429` entsteht für begrenzte Writes nur im Modus `enforce`; Standard `monitor`
lässt Quota-Überschreitungen durch, protokolliert aber jede Überschreitung.
App-Check-Beobachtung erfolgt erst nach Auth/Entitlement-Prüfung und deckt somit
nicht pauschal 401/403 ab. Öffentliche Reads sind ausdrücklich ausgeschlossen.

### Datenschutzprüfung der vorhandenen Logstellen

- App-Check- und Quota-Ereignisse enthalten keine UID, IP, Tokens, vollständige URL,
  Bildpfade oder Request-Bodies. Routen und Gründe sind kleine feste Mengen.
  Tests: `tests/app-check.test.mjs`, `tests/write-rate-limit.test.mjs`.
- `serverFailure()` gibt keine Stacktraces/Providertexte an Clients aus. Seine
  UUID ist ein Log-Korrelationswert, **kein geeignetes Metriklabel**. Fehlercode
  und Auth-Code sind regex-begrenzt, aber nicht beide feste Enum-Allowlists:
  für Metriken auf bekannte Kategorien/`other` normalisieren.
- Kein direkter Token-/Passwort-/Notiz-Logger in den untersuchten vier Backend-
  Logpfaden gefunden. Das ist keine Garantie für SDK-/Plattformlogs oder das
  vollständige Repository und kein Nachweis über historische Produktionslogs.
- Android `ui/ScannerDiagnosticLog.kt` ist `BuildConfig.DEBUG`-geschützt, aber
  `ui/CardVaultApp.kt` schreibt dort Roh-OCR, Scan-/Dateikennungen und Kandidaten.
  Lokale Diagnose ist nicht automatisch personenbezugsfrei; Logs vor Weitergabe
  prüfen/redigieren. Nicht als globale Telemetrie oder hochkardinale Labels übernehmen.
- Vier normale Android-Fehlerstellen in `ui/CardVaultApp.kt` übergeben vollständige
  Throwable (Mastersets, Bindervarianten, Preisverknüpfung, manuelles Speichern).
  Sie sind nicht durch den Debug-Logger geschützt. Provider-/DB-Ausnahmen können
  Kontext enthalten: gesonderte Redaktionsprüfung erforderlich, kein tatsächlicher
  Secret-Abfluss durch diesen rein statischen Audit nachgewiesen.
- Binder-Links tragen eine Zugriffsmöglichkeit im URL-Pfad. Anwendungscode loggt
  den Raw-Token hier nicht; Hosting-/Cloud-Run-/Proxy-Requestlogs könnten vollständige
  Pfade enthalten. Tatsächliche Felder, Logzugriff, Export und Retention müssen
  extern geprüft werden. Keine Raw-URL oder Token-/UID-/IP-Hashes als Metriklabels.
- Firestore-`scannerAudit`/`accessAudit` sind geschützte Fachdaten mit Identitäten,
  keine anonymen Metriken. Keine automatische Übernahme in öffentliche Dashboards.

Kein bestätigter öffentlich erreichbarer Secret-/Cross-Owner-Abfluss festgestellt.
Die fehlende Prüfung externer Logs darf trotzdem nicht als „Logs garantiert tokenfrei“
abgehakt werden. Log-Retention ist lokal nicht vollständig deklarativ festgelegt.

## Konkrete Zugriffs- und Kostentreiber

1. **Shared Binder:** `backend/security/sharing.mjs` liest pro erfolgreicher Seite
   zweimal Share/Access/Deletion-Lock/Binder: acht einzelne Dokumentzugriffe plus
   sämtliche maximal 5.000 Placements plus referenzierte Collection-Dokumente.
   Ohne Gesamtwert: `R = 8 + P + E_page`; bei 5.000/9 also **5.017**. Mit Gesamtwert
   und eindeutig referenzierten 5.000 Einträgen: **10.008**. Zwei Auth-`getUser`-
   Aufrufe kommen hinzu; sie sind nicht als Firestore-Reads gezählt.
2. **Polling:** Websichtbarkeit löst alle 15 s sowie beim Wiederanzeigen neue
   Requests aus (`components/shared-binder-viewer.tsx`). Android pollt nach dem
   jeweiligen Laden mit 15 s Abstand. Initialaufruf/Seitenwechsel kommen dazu.
   Auch HEAD kann über den aktuellen Routing-Fallback GET-Arbeit auslösen.
3. **Öffentlicher Katalogcache:** 60 s, 8.192 Einträge, 32 MiB serialisierte Daten,
   128 KiB/Eintrag, 64 geteilte Inflight-Jobs; keine privaten Dokumente/DTOs.
   Er senkt Providerloads, nicht die oben genannten Firestore-Reads. Overflow lädt
   ungecached weiter: kein globales Netzparallelitätslimit. EN-Bildfallback kann
   einen zweiten Providerfetch verursachen. Body-Limit des Legacy-Sharing-Fetches
   ist davon nicht abgedeckt; Cachegröße ist kein gesamter Heap-/Download-Cap.
4. **Eigene Sammlung/Binder:** Android `CollectionFirebaseSync.kt` nutzt einen
   Collection-Listener mit DocumentChanges, Private Binder einen begrenzten
   vollständigen Durchlauf; alle 15 min ist periodische Arbeit vorgesehen, nicht
   garantiert ausgeführt. 1.000 logische Reads/Lauf begrenzen einzelne Läufe, nicht
   Kosten über viele Fortsetzungen. Delta-Watermark ist nicht aktiviert. Web-
   Listener in `lib/collection.ts`, Layout-/Preis-/Privatbinder-Modulen haben
   initiale Snapshots plus Änderungen. Reduceroptimierung spart CPU, nicht automatisch Reads.
5. **Bericht-Upload:** `images.mjs`: maximal 10 MiB Bild, 11 MiB Multipart, genau
   ein privates Storage-Objekt. Ohne Retry im normalen Quota-Modus: zehn logische
   Firestore-Reads, drei Creates/Sets und ein Delete (Ownership-Operation).
   Bildabruf: drei Dokumentreads, GCS-Metadatenabruf und vollständiger Download;
   auch ein Thumbnail lädt zuerst das Original und verarbeitet es mit Sharp.
6. **Knowledge:** Qualifizierte neue Evidence: ein Clientwrite, anschließend vier
   Transaction-Reads (Evidence, Löschlock, Summary, Contributor) und drei Writes.
   Listenerzustellungen/Ruleschecks/SDK-Retries kommen hinzu. Ältere/Doppelte Events
   können früh abbrechen. Derselbe Fingerprint bleibt ein gemeinsam beschriebenes
   Summary-/Public-Dokument; `maxInstances` allein löst Hot-Document-Contention nicht.
7. **Preis-/Katalogverteilung:** Web-Kartencache in `lib/tcgdex.ts`: 10 min/600;
   separater öffentlicher Sharing-Cache. Android `data/sync/CardmarketSync.kt`
   lädt Produktliste und Preisguide direkt beim Drittanbieter, periodisch 24 h
   beziehungsweise manuell; keine zentrale DomiDex-Cloudpreis-Pipeline behaupten.
   Diese direkten Gerätebytes sind nicht pauschal Firebase-Egress. Reale Dateigrößen fehlen.
8. **Retention/Deletion:** Für Scannerbilder, Knowledge, Tombstones und Auditdaten
   kein pauschaler automatischer Ablauf aus diesen Pfaden belegt. Quota-`expiresAt`
   ist ein Feld, kein Nachweis aktivierter Firestore-TTL. Account-Deletion-Inventar
   (`backend/security/deletion.mjs`) scannt teils globale Reports/Bucketversionen/
   Knowledge-Summaries; das muss separat gemessen werden und fehlt im Standardmodell.

## Lokale Gate-12-Messung, nicht Produktionslast

Root-Wiederholung: `outputs/sharing-concurrency/2026-10-01T03-23-31-232Z-20888.log`
und gleichnamige `.metrics.json`. **11/11 PASS**, drei Wiederholungen, 12,34 s.
Echter Handler/Cache, synthetische Firestore-/Auth-Doubles, Fake-Provider mit 2-ms-
Scheduling, `envDir:false`/Netzblockade. Keine Cloud-/Providerrequests.

| Szenario | Gleichzeitige Requests | P50-Bereich ms | P95-Bereich ms | Provider kalt/warm pro Batch |
|---|---:|---:|---:|---:|
| Gleiche Seite, 5.000 Placements | 10 | 24,7–69,7 | 24,8–71,6 | 9 / 0 |
| Gleiche Seite, 5.000 Placements | 40 | 104,5–151,7 | 104,6–151,8 | 9 / 0 |
| Gleiche Seite, 5.000 Placements | 80 | 169,2–276,8 | 169,2–276,8 | 9 / 0 |
| Getrennte Seiten, 1.000 Placements | 10 | 10,0–45,2 | 10,1–48,7 | 90 / 0 |
| Getrennte Seiten, 1.000 Placements | 40 | 29,4–86,0 | 49,6–93,7 | 360 / 232 |
| Getrennte Seiten, 1.000 Placements | 80 | 67,5–259,0 | 79,6–313,1 | 720 / 592 |
| Gesamtwert, bewusst nur 200 Karten | 10 | 24,7–557,3 | 24,8–557,4 | 200 / 0 |
| Gesamtwert, bewusst nur 200 Karten | 40 | 85,1–579,8 | 85,1–579,8 | 200 / 0 |
| Gesamtwert, bewusst nur 200 Karten | 80 | 163,0–620,9 | 163,0–621,0 | 200 / 0 |

Bereiche umfassen kalt/warm und alle drei Wiederholungen, nicht ein gepooltes
Perzentil. 55 gemessene Batches: 2.350 Requests/5.028.810 logische Dokumentreads;
separater Owner-Isolationstest weitere zehn Requests. Erwartete Revoke-404 sind
erfolgreiche Sicherheitstests, keine Serverfehler. Kein Read-Limit/429 für diesen
öffentlichen Pfad implementiert. Kein Test an Cloud-Runs realer Skalierungsgrenze.
Prozess-Maximum beobachtet: ca. 547,1 MiB RSS/383,5 MiB Heap, inklusive Fixtures,
Modul-Neuladungen, Cache und GC; 5-ms-Sampling ist kein exakter Peak/Produktionswert.
Bei 80 getrennten Seiten bis 480 parallele Fakefetches; das dokumentiert den
ungecacheten Overflow, nicht 480 echte Providerverbindungen in Produktion.

## Reproduzierbares Nutzungsmodell (ausdrücklich hypothetisch)

`tests/cost-model/model.mjs` rechnet Ressourcen für 1.000/5.000/10.000/50.000 aktive
Personen in einem hypothetischen Monat. Profilwerte sind Szenarien, keine Telemetrie.
Jede Person hat die angegebenen aktiven Tage; keine unbekannte DAU/MAU-Quote erfunden.

| Annahme pro Person | Light | Average | Heavy |
|---|---:|---:|---:|
| Aktive Tage/Monat | 10 | 20 | 30 |
| Collection-Dokumente / private Dokumente | 100 / 60 | 500 / 400 | 2.000 / 1.800 |
| Initiale Collection-Snapshots/aktivem Tag | 1 | 1 | 2 |
| Vollständige Privatdurchläufe/aktivem Tag | 1 | 2 | 4 |
| Änderungen / Evidence je aktivem Tag | 2 / 0,1 | 10 / 2 | 40 / 10 |
| Berichte/Monat; Bildgröße MiB | 0,1; 0,5 | 1; 2 | 4; 8 |
| Share-Sitzungen/Monat; Minuten | 1; 1 | 4; 3 | 15; 10 |
| Placements / Anteil mit Gesamtwert | 54 / 0 % | 500 / 10 % | 5.000 / 25 % |

Weitere Parameter (Listenerkopien, Bildansichten, zusätzliche Seiten, Payload-
Bytegrößen, hypothetischer Overhead und Cachehitquote) sind direkt im Modell
offengelegt. Private Vollzyklen sind **keine** garantierte 15-min-Hintergrundfrequenz:
stark vernetzte Dauernutzung kann deutlich mehr verursachen. Standardhitquote 0
ist bewusst kein aus kurzen Cachetests auf einen Monat extrapolierter Prozentsatz.

| Monatliches Szenario, 1.000 aktive Personen | Light | Average | Heavy |
|---|---:|---:|---:|
| Modellierte logische Reads | 2.086.300 | 61.387.000 | 4.950.781.250 |
| Davon öffentliche Binder | 355.000 | 33.966.000 | 4.604.591.250 |
| Modellierte Writes; zusätzlich Deletes | 26.300; 100 | 365.000; 1.000 | 2.416.000; 4.000 |
| Modellierte Cloud-Run-Requests | 36.200 | 264.000 | 1.961.000 |
| Qualifizierte Evidence-Function-Aufrufe | 1.000 | 40.000 | 300.000 |
| Neue Upload-GiB im Monat, nicht Gesamtbestand | 0,049 | 1,953 | 31,25 |
| Geldkosten | nicht bestimmt | nicht bestimmt | nicht bestimmt |

Unter denselben linearen Modellannahmen skalieren diese Mengen bei 5.000/10.000/
50.000 Personen mit 5/10/50. Der Runner gibt alle zwölf Szenarien vollständig aus.
Reale Caches, Hot Documents, zusätzliche Instanzen, Quotas und Retention sind nicht
linear; daraus darf keine Freigabe für 50.000 reale Nutzer folgen. Heavy illustriert
vor allem das Risiko von 5k-Vollreads pro 15-s-Poll, nicht eine erwartete Kundennutzung.

Geldformel erst nach Zuordnung tatsächlich abrechenbarer Mengen und bestätigter
Einheitspreise: Reads + Writes + Deletes + Dokument-/Index-GiB-Monate + Objekt-GiB-
Monate + Traffic/Operationen + Cloud-Run-CPU/RAM/Requests + Functions + Logging/
Hosting/Build/Registry, jeweils abzüglich nur verifizierter Kontingente. CPU-/RAM-
Sekunden, aktuelle Speichergauges und regionale Trafficwege sind derzeit unbekannt.
Monatliche Neu-Uploadbytes dürfen nicht als vorhandener Speicherbestand eingesetzt werden.

## Manuelle externe Schritte vor Gate-11-Abnahme

Diese Punkte sind ein Ausführungsplan, **nicht durchgeführt**; Console-Menüs können
sich ändern. Keine Billing-/IAM-Änderung ohne verantwortliche Person.

1. Projekt/Region, tatsächlich aktive Cloud-Run-Revision samt min/max Instanzen,
   Parallelität, CPU/RAM und Functions-/Retry-Einstellungen read-only feststellen.
2. In Cloud Monitoring/Service-Metriken ein Dashboard für Firestore Reads/Writes/
   Dokument- und Indexspeicher, Storage Bytes/Operationen/Traffic, Cloud-Run
   Requests/Latenz/Instanzen/CPU/RAM und Functions-Ausführungen/Fehler einrichten.
   Verfügbare tatsächliche Metrikdeskriptoren prüfen statt IDs zu erfinden.
3. HTTP 401, 403, 409, 429 und 5xx getrennt; 5xx-Quote und P50/P95 nach festem
   Routenmuster, nicht Raw-URL. 429 nicht als erfolgreichen Request und nicht
   automatisch als Serverfehler zählen. Requestanzahl als Nenner sichern.
4. Runtime-/Edge-Logfelder und Logging-Retention prüfen, insbesondere Sharetoken-
   Pfade; Logzugriff/Exporte minimieren. Neue Anwendungsereignisse nur mit festen
   `route`, `operation`, `result`/`reason` und Status; Dauer/Bytes als Werte,
   nicht Labels. Keine UID, E-Mail, IP, Fingerprints, Token, Notizen, Bodies.
5. Fehlende Upload-/Share-/Cache-/Retry-Metriken als engen Folgepatch spezifizieren
   und testen; bestehende Response-Erfolge allein sind kein Live-Monitoring.
6. In Billing → Budgets/Alerts Projektfilter und einen vom Verantwortlichen
   gewählten Monatsbetrag festlegen; z.B. 50/80/100-%-Warnstufen und Prognosealarm
   mit bestätigtem Empfänger testen. **Budgetalarm ist kein automatischer Kostenstopp.**
7. Billingexport nur bewusst freigeben (Ziel, Zugriff, Retention und eigene Kosten).
   Reale SKU-/Regionspreise und Messfenster mindestens getrennt nach Storage,
   Request, Compute und Logging in das Kostenblatt übernehmen.
8. Baseline-Zeitraum sammeln und Modellparameter ersetzen; Peak-Last mit gegebenen
   Instanzgrenzen kontrolliert testen. Fehler-/Latenzalarm mit Mindesttraffic und
   sinnvollem Zeitfenster wählen. Keine automatisch erhöhte Skalierung.

## Nachweise und offene Arbeiten

Ausgeführt: `node --test tests/cost-model/model.test.mjs` → **6/6 PASS**, ca. 94 ms;
enger Oxlint für `tests/cost-model` erfolgreich. Modell benötigt nur Node-Builtins.
Reproduktion: `node tests/cost-model/model.mjs` (JSON nach stdout).
Geprüft werden Formel gegen tatsächliche 5k-Fixture, Skalierung, Cache-vs-DB-
Trennung, Poll-/Gesamtwertannahmen, fehlende Geldwerte und ungültige Parameter.

Bestehende App-Check/Quota-/API-Tests wurden für diesen Audit gelesen, nicht erneut
als Testlauf gezählt. Root-Lastlauf ist oben exakt benannt; Messartefakte sind ignoriert.
Keine andere Runtime-/Testkonfiguration verändert. Freigabe bleibt offen für
produktive Monitoringbelege, Log-/Retentionprüfung, gültige Einheitspreise und
kontrollierte reale Infrastrukturmessung. Größte sinnvolle Folgeschritte: sichere
Sharing-Read-Amplification reduzieren, anonymen Readschutz erst nach vertrauens-
würdiger Ingressklärung, tatsächliche Cachehits/Bytes messen und Retention entscheiden.
