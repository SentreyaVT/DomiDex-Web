# Release 27: Datenschutz- und Konto-Lifecycle – technisches Audit

Stand: 2026-10-01. Lokaler Quell-/Teststand beider Repositories, keine juristische
Prüfung oder Freigabe. Auftrag: Gate 10 des Nutzerbriefs
`6b259aed-d8bd-458b-b4b5-636ed284fe22/Eingefügter Text.txt`.
Android-Pfade beziehen sich auf das benachbarte Repository `../CardVault/`.
Zeilenangaben sind Orientierung im geprüften Stand, keine unveränderlichen Permalinks.

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
Der neue Aktions-/Kontowechselschutz benötigt einen separaten RED/GREEN-Nachweis.
