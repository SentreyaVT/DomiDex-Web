# Release 27: Datenschutz- und Konto-Lifecycle – technisches Audit

Stand: 2026-10-01. Lokaler Quell-/Teststand beider Repositories, keine juristische
Prüfung oder Freigabe. Auftrag: Gate 10 des Nutzerbriefs
`6b259aed-d8bd-458b-b4b5-636ed284fe22/Eingefügter Text.txt`.
Android-Pfade beziehen sich auf das benachbarte Repository `../CardVault/`.
Zeilenangaben sind Orientierung im geprüften Stand, keine unveränderlichen Permalinks.

## Ergänzung 02.10.2026: begrenzter Live-Konfigurationsnachweis

Die historische lokale Ausgangsprüfung und spätere Fixnachweise bleiben unten
erhalten. Provider-Einstellungen sind jetzt teilweise read-only belegt, nicht
die Durchführung oder Vollständigkeit einer Löschung. Minimierte Belege:
`retention-metadata-20261001T233605Z.json` und
`serving-metadata-20261001T234426Z.json` unter
`../CardVault/artifacts/release27-engineering-20261002/lifecycle-gates-review/`.
Abfragen 01.10.2026, 23:36–23:49 UTC; Projekt `cardvault-715ac`, gcloud 583.0.0.
Keine Einstellungen, Kontorechte oder Produktdaten geändert. Keine Nutzerdokumente,
Objektinhalte oder Rohlogs gelesen. CLI-Ausgabeprojektion ist clientseitig, kein
Server-Field-Mask- oder Netzwerk-/Speicherlimitnachweis.

- Logging-**Initialseite**: `_Default` 30 Tage, `_Required` 400 Tage und gesperrt,
  beide aktiv. Kein vollständiges Bucketinventar, Export- oder Logfeldnachweis.
- Firestore `(default)`: Native/Standard in `eur3`, PITR und Delete-Protection
  deaktiviert, Versionsspanne 3600 Sekunden. Diese Spanne ist keine Dokument-TTL.
- Erfolgreiche TTL-, Backup-Schedule- und Backup-Abfragen lieferten jeweils
  exakt `[]`, nicht `null` oder einen Fehler. Das belegt nicht die Abwesenheit
  externer Kopien, eine Wiederherstellung oder eine abgeschlossene Löschung.
- Storage `cardvault-715ac.firebasestorage.app`: `US-EAST1`, Soft Delete
  **604800 Sekunden = sieben Tage**, effectiveTime `2026-08-31T23:07:56.099+02:00`.
  Bestätigt ist die Wiederherstellungsfrist nach Löschung, **nicht** automatisches
  Löschen lebender Bilder nach sieben Tagen. Lifecycle-Regeln und Objektversionen
  wurden nicht inventarisiert; fehlende projizierte Werte sind kein Deaktivierungsbeleg.
- `publicAccessPrevention:inherited` und `uniformBucketLevelAccess:false` wurden
  gelesen. Daraus folgt weder öffentliche Lesbarkeit noch eine IAM-/ACL-Freigabe.

Produktfristen, lokale Kopien, Betreiberfortsetzung des Löschjobs, tatsächlicher
Provider-Purge und vollständiger Konto-Löschlauf bleiben offen. Unterschiedliche
Regionen ersetzen keine Datenfluss-/Vertragsprüfung. Keine Compliancefreigabe.

## Ergebnis und offene Prioritäten

1. **Bestätigte Export-Isolationslücke:** Androids lokale Scan-Feedback-Dateien
   besitzen keinen Owner und werden ungefiltert in jeden Sammlungs-ZIP-Export
   übernommen. Eine andere angemeldete Person auf demselben Gerät kann damit
   Bilder, OCR und Notizen des vorherigen Kontos exportieren. Der eigentliche
   Room-Sammlungsgraph ist dagegen ownergefiltert. Minimalfix separat freigegeben,
   zum Zeitpunkt dieses Audits noch nicht umgesetzt.
2. **Löschung ist ein wiederaufnehmbarer Betreiberprozess, kein nachgewiesener
   automatischer End-to-End-Dienst.** Nach der anfänglichen Sperre sind weitere
   Aufrufe nach Sitzungs-/Providerfristen erforderlich. Kein Scheduler und keine
   nach Abmeldung erreichbare Nutzer-Statusabfrage wurden im Quellstand gefunden.
3. **Aufbewahrung ist überwiegend nicht zeitlich begrenzt.** Für Berichte,
   Evidence, Tombstones, Auditdaten und Löschbelege fehlen allgemeine technische
   Ablaufregeln. Fachliche Aufbewahrungs-/Betriebsentscheidungen sind offen;
   dieses Audit erfindet weder Fristen noch rechtliche Erfordernisse.
4. **Öffentliche Beschreibung weicht an konkreten Stellen ab:** Delegierte
   Scanner-Lab-Mitglieder dürfen Bilder lesen, nicht nur Administratoren.
   Die veröffentlichte Sieben-Tage-Storage-Angabe wurde hier nicht live verifiziert.

## Tatsächliche Konto- und Datenflüsse

| Bereich | Erzeugung / Nutzung | Schutz und Löschpfad |
| --- | --- | --- |
| Firebase Authentication | Google-Anmeldung, UID und Claims; Android und Web teilen das Konto. | Backend verifiziert widerrufene Tokens und aktuellen Benutzer, `accountAccess` und Löschlock. Vollständige Löschung deaktiviert, widerruft und löscht Auth. Google-Konto selbst bleibt bestehen. |
| `users/{uid}` | Sammlung, private Binder, Seiten/Placements, Layouts, Preiswahl, Evidence. | Owner-/App-Zugang in Rules; Löschung inventarisiert rekursiv auch Subcollections unter fehlenden Eltern. |
| Room und lokale Dateien | Android besitzt lokale Sammlung, Fotos, Feedback, Einstellungen und Knowledge-Cache/Outbox. | Abmeldung wechselt Konto, löscht aber nicht alle lokalen Daten. Cloud-Löschung entfernt keine lokalen Geräte-/Exportkopien. |
| Binderfreigaben | Bewusste Freigabe erzeugt zufälligen Link; gespeichert wird sein SHA-256-Hash mit Owner, Binder und Anzeige-Flags. | Öffentlicher Abruf prüft aktuellen Ownerzugang/Lock/Widerruf; nur DTO-Felder, keine privaten Kaufnotizen. Widerruf bzw. Kontolöschung entzieht weitere Abrufe. Bereits kopierte Inhalte sind nicht rückrufbar. |
| Freiwillige Scanberichte | Expliziter Upload, privates Bild plus `scannerReports`; unfertige Uploads über `privateUploadOperations` erfasst. | Auth vor Body, Owner-/Hash-/Generation-Kontrolle; Lesen über berechtigtes Scanner-Lab, Löschen über Admin bzw. Konto-Löschprozess. |
| Knowledge-Evidence | Android benötigt eigene accountgebundene Zustimmung; kein automatischer Bild-Upload als Evidence. | Eigene Evidence, private gehashte Contributor-Daten und öffentlicher Aggregatdatensatz. Konto-Löschung entfernt Beitrag und berechnet verbleibendes Aggregat neu. |
| Support / Beiträge / Audits | Supportanfragen, Community-Beiträge, private Uploadvorgänge und Auditzuordnungen. | Bekannte Ownerwurzeln werden entfernt; fremde Reviews/Audits werden gezielt von UID-Zuordnungen bereinigt, gemeinsame Scanner-/Katalogdaten nicht blind gelöscht. |

Primärstellen: `backend/security/firebase.mjs:35`, `deletion.mjs:9–108`,
`sharing.mjs:28–54,148–199`, `images.mjs:40–94,99–181`,
`backend/scan-knowledge/index.js:10–55`, `firestore.rules:4,365–415,471–511`,
`storage.rules:5–67`; Android `auth/FirebaseGoogleAuthGateway.kt:61–119`,
`data/knowledge/ScanKnowledgeConsent.kt:21–50` (jeweils unter
`app/src/main/java/com/dominik/cardvault/`).

## Auth, Löschsperre und laufende Operationen

- Web `components/auth-provider.tsx:48–91` verwirft veraltete Claim-/Zugangsantworten
  anhand Generation und UID; Account-Access wird live beobachtet und bei nicht
  bestätigbarem Zustand gesperrt. Abmelden ist kein Löschauftrag.
- `backend/security/firebase.mjs:35–68` prüft Auth, aktuellen Benutzer, Claims,
  Access und `accountDeletionLocks` vor optionalem App-Check-Monitor. App Check
  ersetzt keine Autorisierung und ist im neuen Vertrag standardmäßig aus.
- Firestore-/Storage-Rules verweigern normale Zugriffe bei Löschlock oder
  deaktiviertem `accountAccess`. Der eigene Access-Status bleibt gezielt lesbar.
- Uploads prüfen Zugang nochmals nach der Bildübertragung und transaktional vor
  Report-Commit. Generationengebundene Bereinigung und ein Operationsdokument
  sichern Teilfehler ab. Funktionen prüfen aktuelle Evidence und Löschlock in
  derselben Transaktion vor Aggregation; historische Android-Functions sind durch
  lokalen Predeploy-Abbruch gegen versehentlichen Deploy geschützt.
- Öffentliche Shares prüfen Owner-Zugänglichkeit vor und nach der Aufbereitung.
  Client-DTO-Anzeige und Backend-Widerruf sind getrennte Grenzen; Polling ist
  weiterhin kein sofortiger Push. Der inzwischen korrigierte Großansicht-Dialog
  verwendet keine veralteten Preis-/Kartendaten nach erfolgreichem Refresh.

Hier wurden keine echten gesperrten Konten, Provider-Sitzungen oder produktiven
Rules getestet. Die Aussagen beschreiben implementierte Guards und lokale Tests.

## Konto-Löschung: implementiert und nicht automatisiert

Web: Einstellungen verlinken `/account/delete` und die öffentliche Kontaktseite.
`components/account-deletion.tsx:15–40` verlangt ausdrückliche Bestätigung und
erneute Google-Authentifizierung. `/api/account/delete` akzeptiert nur den
Bestätigungswert; mitgeschickte fremde UID/Job-ID wird nicht als Ziel übernommen
(`app/api/account/delete/route.ts:8–15`). Backend ist zusätzlich über
`ACCOUNT_DELETION_READY=verified-v1` freizuschalten; dessen Livewert wurde nicht gelesen.

`backend/security/deletion.mjs:163–310` implementiert:

- Vorabinventar; unklare alte Bild-/Report-Owner und persönliche Zuordnungen in
  geschützten Scannerwurzeln führen zu `REVIEW_REQUIRED`, nicht zu geratenen Löschungen.
- Transaktionalen Lock/Job und Access-Sperre; Lease, erneuerbare Checkpoints und
  idempotente Inventaritems. Bildlöschung verwendet konkrete Objektgenerationen.
- Auth deaktivieren und Refresh-Tokens widerrufen; mindestens 65 Minuten
  Sicherheitsfenster **ab bestätigtem Widerruf**, danach erneutes vollständiges Inventar.
- Evidence zuerst entfernen, verbleibende Aggregate neu berechnen, Owner-Dokumente
  und Bilder löschen, Auth-Abwesenheit verifizieren. Fremde Inhalte bleiben erhalten.
- Tatsächliche Bucket-Soft-Delete-Konfiguration und ältere gelöschte Generationen
  prüfen; keine Abschlussmeldung solange kontrollierbare Restobjekte existieren.
- Erst bestätigter Abschluss entfernt Job/Lock und erzeugt einen Beleg mit
  Zufallsreferenz, Zeiten/Zählern ohne gespeicherte UID, E-Mail oder Bildpfade.

**Betriebs-/UX-Lücken:**

- `advanceDeletion` läuft auf Anforderung; kein zeitgesteuerter Fortsetzer wurde
  gefunden. `docs/PRIVATE_CLOUD_OPERATIONS_2026-09-04.md:27–31` verlangt ausdrücklich
  Betreiber-Fortsetzung/Kommunikation. Fehlerretry und Zuständigkeit müssen im
  Betrieb abgesichert sein, sonst kann ein deaktiviertes Konto im Job verbleiben.
- Der Nutzer erhält nur die erste Antwort/Jobreferenz. Keine gespeicherte Referenz,
  Status-Polling oder Nutzer-Statusroute nach Auth-Sperre; `deletionStatus` ist admin-only.
  Das UI meldet nur bei `COMPLETE` Abschluss, ist insofern ehrlich.
- `components/account-deletion.tsx:59` benennt alte `WAITING_*`-Statuswerte, während
  das Backend `PENDING_SESSION_EXPIRY`, `ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION`
  und `PROVIDER_PURGE_NOT_CONFIRMED` liefert. Unbekannte Werte bleiben generisch in Bearbeitung.
- Android `ui/SettingsPrivacy.kt:118–164` bietet nach Bestätigung einen E-Mail-Entwurf,
  keine direkte API-Löschung. Das wird ausdrücklich erklärt; `mailto` enthält keine
  automatisch eingesetzten Kontodaten. Online-Kontolöschung existiert separat im Web.
- Alte unzuordenbare Reports können die Vorprüfung für ein betroffenes Löschverfahren
  blockieren. Keine automatische Fremdzuordnung oder gefährliche Globallöschung vornehmen.

## Export-/Importgrenze und bestätigte lokale Lücke

Android `data/backup/UserBackupStore.kt:21–39` exportiert in einer Room-Transaktion
acht freigegebene Tabellen, Owner-gefilterte Sammlung/Binder/Layouts/Preiswahl und
nur referenzierte Katalogdaten. Kein Raw-Preiscache, Auth oder Consent. Import prüft
Format, Datenbankversion, erlaubte Spalten, Mengen/Relationen, bindet an das Zielkonto,
remappt IDs und erhält bestehende Daten; Journal/Transaktion machen Fehler rückrollbar.
Fotos werden als geprüfte portable Referenzen exportiert, nicht als fremde Dateipfade.

**P1 – lokales Feedback überschreitet diese Grenze:**

- `data/feedback/ScanFeedbackStore.kt:24–45` besitzt kein Ownerfeld und verwendet ein
  gemeinsames `filesDir/scan_feedback`. `list()`/`exportTo()` (`60–83`) exportieren
  alle dortigen Metadaten/Bilder mit OCR, Prediction, Notizen und Annotationen.
- `ui/CardVaultApp.kt:778–794,822–837` hängt diese ungefilterten Dateien an das korrekt
  begrenzte Sammlungsarchiv. Kein gemeinsamer über die vollständige Exportoperation
  gehaltener Konto-/Generationsbeleg schützt den letzten Schreibschritt zur Ziel-URI.
- `save()` (`ScanFeedbackStore.kt:47–57`) ersetzt gleichnamige lokale IDs ohne
  Ownerprüfung. Import überspringt vorhandene Metadaten-IDs statt Owner zu unterscheiden.
- `RoomCollectionRepository.kt:49–57` erfasst für Export/Import zwar einen Owner,
  aber der Backup-Wrapper bewahrt noch keine durchgehende Sessiongeneration; reine
  UID-Gleichheit genügt nicht zum Nachweis gegen A→B→A während einer Operation.

Minimalfix muss neues Feedback eindeutig binden, unbekannte Altdateien unverändert
lassen und vom Kontoexport ausschließen. Archiv-Owner darf niemals Importautorität
sein; Import benötigt den ausdrücklich bestätigten Zielkonto-/Generationsbeleg.
Kein Cloud-Upload, keine Consentmigration und keine neue Room-Tabelle erforderlich.

Ein gleichwertiger Self-Service-Webexport oder Export aller Reports/Evidence wurde
im untersuchten UI/API nicht gefunden. Auskunft über den bestehenden Kontaktweg ist
kein hier getesteter vollständiger Datenexport. Bereits ausgegebene ZIPs werden
durch spätere Cloud-Löschung nicht entfernt.

## Tatsächliche Aufbewahrung statt erfundener Fristen

| Datenklasse | Implementierter Stand / offene Entscheidung |
| --- | --- |
| Sammlung / Tombstones | Kein allgemeiner TTL-Job; Tombstones schützen Sync gegen Wiederherstellung. Vollständige Kontolöschung entfernt den User-Unterbaum. Nicht ohne Sync-Vertrag ausdünnen. |
| Reports und private Bilder | Explizite Admin-/Kontolöschung, keine automatische Alterslöschung. Soft-Delete wird providerseitig geprüft; Produktfrist/Zweckfestlegung offen. |
| Evidence / Contributor / Aggregate | Keine serverseitige Altersbereinigung; Ownerlöschung und Neuberechnung vorhanden. Androids sieben Tage sind Hinweisgültigkeit, **keine Cloud-Löschfrist**. |
| Revokete Shares | Widerrufsmarkierung mit Owner/Binder/Hash bleibt bis Kontolöschung; keine allgemeine TTL. |
| Write-Quoten | Drei deterministische Owner-Policy-Dokumente; `expiresAt = Fensterende + 24 h` (`rate-limit.mjs:61`). Feld allein aktiviert keine Firestore-TTL; Kontolöschung erfasst die drei Referenzen. |
| Löschjobs/-locks/-items | Bis verifiziertem Abschluss; kein pauschaler Ablauf, der unvollständige Löschung verstecken würde. Abschlussbelege ohne direkte UID haben keine automatische Frist. Die externe Zuordnung einer Jobreferenz kann dennoch bestehen. |
| Scanner-/Access-Audits | Persönliche UID-Zuordnungen werden im Löschprozess bereinigt; keine allgemeine Altersfrist im Quellstand. |
| Knowledge lokal | Cache max. 512, Quellalterprüfung sieben Tage beim Zugriff; pro Owner Outbox max. 128, Receipts max. 512. Counts ersetzen keine zeitliche Aufbewahrung; alte Ownerverzeichnisse bleiben. |
| Lokales Feedback / Room / Fotos | Feedback vor Fix global, keine allgemeine Alters-/Mengenbereinigung. ZIP-/Importgrenzen sind keine Store-Retention. Logout und Cloud-Löschung sind kein lokaler Wipe. |
| Providerlogs / externe Backups / Mail | Außerhalb dieses Löschengines; aktuelle Einstellungen/Betreiberprozesse nicht geprüft. Separater dokumentierter Betriebs-/Rechtsentscheid erforderlich. |

## Datenschutztext gegen Implementierung

- `lib/legal-content.ts:48`: nur Administratoren als Bildleser genannt, tatsächlich
  `backend/security/images.mjs:99–101` Rolle `scannerLab` einschließlich gezielter
  Delegation. Normale Tester ohne diese Berechtigung erhalten keinen fremden Zugriff.
- `legal-content.ts:68,96`: konkrete aktuelle siebentägige Storage-Frist ist eine
  überprüfungsbedürftige Betriebsangabe. Engine liest reale Bucket-Metadaten;
  dieses lokale Audit bestätigt keine Livekonfiguration.
- Zustimmung zu Knowledge und freiwilligem Bildversand sind im aktuellen Code getrennt.
  Historische Entscheidungs-/Runbookdateien vom September sind keine aktuelle
  Rechtsfreigabe und teils vor dem jetzigen Consent-/Rollenstand geschrieben.
- Neue Quotenmetadaten und optionales App Check müssen bei Aktivierung in der
  technischen Datenflussbeschreibung berücksichtigt werden. Keine pauschale
  Behauptung, es würden überhaupt keine personenbezogenen Metadaten verarbeitet.
- Öffentlicher Text beschreibt fehlende pauschale Aufbewahrungsfrist, Betreiberprüfung
  und Grenzen lokaler Kopien bereits; das ersetzt nicht die offenen Betriebsentscheidungen.

## Lokale Nachweise und klare Grenzen

Neu ausgeführt, ausschließlich Mocks/Loopbackschutz, `envDir:false`: **102/102 Tests
in neun Dateien, 4,74 s**. Dateien: `account-deletion-route`, `auth-provider`,
`firebase-admin-auth`, `legal`, `scan-knowledge-trigger`, `rate-limit-runtime`,
`write-rate-limit`, `scanner-lab-access-routes`, `scanner-lab-ui` (unter `tests/`).
Beleg: `outputs/release27-engineering-20261001/baseline/gate10-privacy-local-audit.{json,log}`.

Zusätzlich **nur gelesen**, in diesem Audit nicht erneut ausgeführt:

- `tests/private-operations.test.mjs`: echte lokale Emulatorfälle für Ownerinventar,
  verbleibende Contributor, Wiederaufnahme, Teilfehler, Providerrestbestände,
  Löschsperre und geschützte Zuordnungen. Benötigt Auth/Firestore/Storage-Emulatoren.
- Android `BackupRestoreInstrumentedTest` (4), `BackupPhotosSettingsInstrumentedTest`
  (5), `ScanFeedbackStoreTest` (5), `SettingsPrivacyInstrumentedTest` (6): existierende
  Backup-/Rollback-/Pfad-/UI-Fälle, aber keine belegte Feedback-Kontoisolation.
- Rechts-/Texttests prüfen Darstellung, nicht Rechtskonformität oder reale Fristen.

Kein vollständiger produktiver Löschlauf, kein echter Authwiderruf, keine Bucket-
Retentionprüfung, keine Zustellung von Betreiber-Mails und kein Geräte-/Browser-E2E.
Keine Regeln, Cloud-Daten, Release-Artefakte oder Produktdateien für dieses Audit verändert.

## Enger technischer Folgefix: Status und Leserbeschreibung

Der Root-Gegencheck hat drei aktuelle Backendstatus zunächst mit echten Komponenten-
Mocks als fehlende konkrete Anzeige reproduziert. Die Labels für
`PENDING_SESSION_EXPIRY`, `ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION` und
`PROVIDER_PURGE_NOT_CONFIRMED` sind jetzt ergänzt; die alten Statusnamen bleiben
kompatibel. Kein Warten wird als vollständige Löschung angezeigt. Nur eine erfolgreiche
HTTP-Antwort mit `COMPLETE` meldet Abschluss. Backend, Scheduler, Fristen und
Löschbefugnisse wurden dadurch nicht verändert.

Der öffentliche ScanLab-Text nennt jetzt auch ausdrücklich freigeschaltete
Scanner-Lab-Mitglieder als berechtigte Bildleser. Normale Tester erhalten weiterhin
keinen Zugriff allein durch ihre Testerrolle. Dies korrigiert die anhand des Codes
belegte Datenflussbeschreibung, vergibt keine Rechte und ist keine rechtliche Freigabe.
Die ungeprüfte tatsächliche Storage-Frist wurde nicht als neu bestätigt dargestellt.

RED: vier Fehler (drei Statuslabels, eine Leserbeschreibung); danach
**1.031/1.031 Tests in 65 Dateien** im isolierten Root-Runner bestanden, inklusive
acht neuen Statusfällen und zehn öffentlichen Texttests. Bekannte Testumgebungs-
Warnungen bleiben sichtbar. Protokolle: `outputs/release-local/2026-10-01T03-37-01-766Z-19716.*`
(RED), `2026-10-01T03-37-40-496Z-14648.*` (GREEN). Noch kein Deployment.

Zusätzlicher bestätigter UI-Befund in Bearbeitung: Die Löschkomponente hielt ihre
Bestätigung/Ergebnismeldung bisher über Kontowechsel. Ein alter COMPLETE-Callback
konnte das inzwischen aktive andere Konto abmelden. Der Server verwendet weiterhin
die UID des Auth-Tokens; kein Löschen von B mit einem A-Token ist damit nachgewiesen.
Der neue Aktions-/Kontowechselschutz wurde anschließend separat nachgewiesen:

- Lokale Auth-UID-Generation invalidiert auch A→B→A vor einem React-Zwischenrender.
  Bestätigung, Busy-Zustand und Ergebnisse sind an genau diese Aktion gebunden;
  gleichbleibende UID bei erneuter Anmeldung bleibt erlaubt.
- Prüfung nach Reauthentifizierung, Token, Antwort und JSON sowie vor Logout;
  alte Fehler/Finallys und Antworten nach Unmount ändern keine neue Sitzung.
  Ein bereits abgesendeter serverseitiger Löschauftrag wird dadurch **nicht** zurückgenommen.
- RED: 13 Fehler/2 bestanden am Ausgangsstand. GREEN: 16 neue Sitzungstests,
  acht Statusfälle, zwei Routenfälle und 21 AuthProvider-Fälle (47/47), anschließend
  Root-Gesamtregression **1.047/1.047 in 66 Dateien, 25,40 s**.
- Belege: `outputs/release27-engineering-20261001/baseline/gate10-account-deletion-session-{red,final}.log`
  sowie `outputs/release-local/2026-10-01T03-41-58-810Z-13204.{json,log}`.

Diese Prüfung verwendete ausschließlich lokale Mocks, keine reale Löschung/Abmeldung.
Der AuthProvider und das Backend wurden nicht geändert. Die neue Testsuite ist im
versionierten lokalen Regressionsrunner enthalten. Kein Deployment.

Ein zweiter unabhängiger Review fand zusätzlich den **noch nicht gestarteten**
Vorgang: nach alter Checkboxbestätigung und beobachtetem A→B→A konnte vor Reacts
State-Commit ein alter Button-Handler eine neue Aktion beginnen. `consentGeneration`
wird jetzt bei Ownerwechsel, Abwahl und Unmount synchron widerrufen und beim Start
geprüft. Eine gleiche UID mit neuer SDK-Userobjektinstanz bleibt zulässig.
Genau dieser Fall war zunächst rot; der finale identische 19er-Teststand gegen eine
isolierte Kopie von `876012b` ergibt **15 FAIL / 4 PASS**, gegen den Fix **19/19 PASS**.
Produktdateien wurden für diesen Gegenvergleich nicht zurückgewechselt.
Fokusregression: **50/50**; Root-Gesamtregression **1.050/1.050 in 66 Dateien, 33,73 s**.
Belege: `gate10-account-deletion-consent-red.log`,
`gate10-account-deletion-final19-original-red.log`, `gate10-account-deletion-session-final.log`
im obigen Baseline-Verzeichnis; Root `outputs/release-local/2026-10-01T03-46-31-932Z-16420.{json,log}`.
Typecheck, enger Lint und finaler unabhängiger Diff-Review ohne weiteren Befund.

## Tatsächliche lokale Firebase-Regression

Die unveränderten `tests/private-operations.test.mjs` wurden zusätzlich mit echten
lokalen Auth-/Firestore-/Storage-Emulatoren gegen die Backendmodule ausgeführt:
**27/27 PASS** (sieben Sharing-, zwölf Bild-/Auth- und acht Kontolöschfälle), 41,76 s
Vitest / 76,94 s gesamter Runner. Ownertrennung, Wiederaufnahme, Teilfehler, finale
Cleanupfehler und überholte Evidence sind enthalten. Keine echten Nutzer oder Cloud-Daten.

Demo-Projekt `demo-domidex-privacy`, leere CLI-/CloudSDK-/APPDATA-Profile, entfernte
Credential-/Proxyvariablen, `envDir:false` und Node-Loopbackguard. Alle sechs reservierten
Emulatorports waren nach dem Lauf wieder frei. Java ist nicht durch diesen Nodeguard
instrumentiert; dies ist keine Behauptung einer Betriebssystem-Netzsperre.
Provider-Retention, Soft-Delete-Versionen und Zeitfortschritt sind gezielte Fixtures,
kein Nachweis eines wirklichen Cloud-Purge oder eines UI-/Worker-End-to-End-Laufs.

Belege: `outputs/release27-engineering-20261001/security-gate10-deletion/evidence.json`
und Unterverzeichnis `run-20261001-054852-250c84e7` mit Log/JSON. Dieser erste lokale
Runner liegt in ignorierten Arbeitsartefakten; ein eigenständig versionierbarer
Runner wird separat geprüft. Die testenden Backendmodule/Rules wurden nicht verändert.

## Enger Android-Folgefix: kontogebundenes Feedback und lokaler Backupbeleg

Der oben festgehaltene Export-Ausgangsbefund ist im lokalen Release-27-Quellstand
behoben. Neue Feedback-Metadaten besitzen eine explizite `ownerUid`; fehlender Owner
bedeutet weiterhin unbekannten Altbestand, niemals automatisch Guest oder das gerade
angemeldete Konto. Alte Metadaten/Bilder werden nicht migriert, gelöscht oder
umgeschrieben. Kontoexport und lokale Auflistung filtern den exakt erfassten Owner.
Im portablen Feedback-Manifest wird die lokale Owner-UID nicht mit ausgegeben.

Die UI erfasst `LocalDataSession` **vor** dem Datei-Auswahldialog bzw. beim Öffnen
des lokalen Feedbackeditors. Room-Backup, Feedback, Importbestätigung und Kopieren
zur gewählten Ziel-URI verwenden anschließend denselben Owner-/Generationsbeleg.
Es erfolgt keine nachträgliche neue Firebase-Authentifizierung, um einen alten
Vorgang in ein inzwischen anderes Konto umzuleiten. Der lokale Guard verlangt
keine Cloud-Freigabe: Guest und offline genutzte Konten ohne App-Zugangsrecht bleiben
für ihre eigenen lokalen Daten nutzbar. Eine getrennte lokale Ownergeneration und
aktueller lokaler Owner verhindern die geprüften beobachteten A→B→A-Wechsel. Gleiche
UID bei Tokenrefresh oder `requestSync` invalidiert diese lokale Lease nicht; der
bisherige strengere Cloud-Konfliktguard bleibt unverändert.

Import benötigt weiterhin die explizite Bestätigung. Feedback wird an diesen
Zielbeleg gebunden, beliebige Ownerwerte im Archiv werden nicht übernommen.
Neue Saves überschreiben keine bereits vorhandene ID; fremde bzw. unzugeordnete
Import-ID-Kollisionen werden vor Änderungen abgelehnt. Derselbe bereits importierte
eigene Eintrag bleibt idempotent. Ein kleiner Prozesslock verhindert kollidierende
lokale Feedback-Dateischreibvorgänge. Dateipfade und vorhandenes Importjournal bleiben
unverändert; keine neue Room-Tabelle, Cloud-/Consentmigration oder Uploadfunktion.

Der bestehende Importjournal-/Room-Verbund rollt bei ungültiger Sitzung vor Commit
nur neu angelegte Dateien/Daten zurück. Bei bereits bestätigtem Commit wird ein
nachfolgender Kontowechsel nicht als rückrollbarer Importfehler behandelt. Zusätzlich
sichern Guards im alten Backupformat die echte suspendierende Markerabfrage und den
letzten Markerwrite unmittelbar vor Transaktionsende ab.

Lokale RED→GREEN-Nachweise im Android-Repository:

- Fünf neue tatsächliche Storetests zunächst **5 FAIL / 0 PASS**: fremder Export,
  Altbestandexport, fehlende Zielbindung sowie fremde/Legacy-Save-ID-Kollisionen.
- Danach erweiterte Gruppe **44 PASS / 2 FAIL**: die zwei unabhängigen Reviewfälle
  verwenden echte Room-Query-Callbacks an den letzten Legacy-DAO-Grenzen. Nach den
  unmittelbar folgenden Guards **46/46 Instrumentierungstests, 21,099 s** auf
  `emulator-5554`; davon 20 neue Owner-/Journalfälle und 26 vorhandene Backup-/Privacyfälle.
- **6/6 neue JVM-Tests** für lokalen Guard, Guest/offline, ABA und überprüften
  Streamtransfer. Debug-/Test-APK und Release-Kotlin kompilieren; finaler Build 12 s.
- Ein erster Build des erweiterten Tests scheiterte an fehlenden Pflichtfeldern
  meiner Testfixture, nicht am Produktcode; Fixture korrigiert, erneuter Build grün.
  Keine Testaussage wurde dafür abgeschwächt. Unabhängiger read-only Endreview ohne
  verbleibenden konkreten Befund im engen Fix.

Root entdeckte anschließend eine weitere Kopplung im ersten Fix: Die Cloud-
Entitlementgeneration stieg auch bei gleicher UID. Ein Legacy-Import konnte sich
durch seinen eigenen `addManualCard → onSyncNeeded → requestSync` ohne Cloudzugang
selbst abbrechen. Die zuvor gemessenen 46/46 und 6/6 gelten daher ausdrücklich vor
dieser Reviewkorrektur. Das extrahierte Ereignisverhalten wurde zunächst unverändert
mit **1 FAIL / 7 PASS JVM** und **1 FAIL / 0 PASS echtem Legacy-Room-Import** reproduziert.
Die nun getrennte lokale Generation steigt ausschließlich bei beobachtetem UID-Wechsel
oder `close`; Cloud-Entitlement-/Konfliktgenerationen bleiben unverändert.

Final: **8/8 JVM**, **47/47 Emulatorfälle in 20,267 s**, Debug-/Test-APK und
Release-Kotlin grün (12 s), unabhängiger enger UID-Generation-Endreview ohne Blocker.
Zusatzbelege: `gate10-feedback-local-generation-red-{build,emulator}.log` und
`gate10-feedback-local-generation-final-{build,emulator}.log` im selben Android-
Artefaktverzeichnis. Keine große Gesamtregression für diese Zahlen behauptet.

Tests: `ScanFeedbackOwnerInstrumentedTest` (12), `LocalBackupOwnerInstrumentedTest`
(9), `LocalDataSessionTest` (8); bestehende `ScanFeedbackStoreTest` wurde ausschließlich
an die nun explizite Session-API angepasst. Belege unter
`artifacts/release27-engineering-20261001/`:
`gate10-feedback-owner-red-{build,emulator}.log`,
`gate10-feedback-legacy-red-{build,emulator}.log`,
`gate10-feedback-owner-final-{build,emulator}.log`; JVM-XML im üblichen lokalen
`app/build/test-results/testDebugUnitTest/`.

Grenzen: kein echter Storage-Provider-/System-Dateipicker-E2E oder Cloud-Löschtest.
Ein Kontowechsel während des letzten externen Schreibens bricht weitere Chunks ab;
eine bereits teilweise geschriebene Datei kann am gewählten Speicherort verbleiben.
Kein Betriebssystem-weites atomisches Rückholen bereits ausgegebener Bytes behauptet.
Die Scannerqueue **vor** dem expliziten Öffnen des Feedbackeditors wurde nicht neu
modelliert. Keine Aussage über vollständige Scanner-Owner-E2E. Die allgemeine
Retention lokaler Daten und unbekannter Altdateien bleibt eine separate Entscheidung.
Kein Xiaomi-Zugriff, Release-AAB, Release-Signing oder Deployment.
