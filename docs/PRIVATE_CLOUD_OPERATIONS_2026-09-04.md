# Geschützte Bilder und Kontolöschung – Betriebsanleitung

## Grenzen

Nur Web-Backend, Firebase-Regeln und bestehender serverseitiger Evidence-Trigger. Android, Aufnahme-/Erkennungslogik und alle Browser-/Designassets bleiben unverändert. Die Function-Quelle in `backend/scan-knowledge` wurde aus der tatsächlich deployten Source übernommen. Einzige fachliche Ergänzung ist die transaktionale Prüfung, ob die Evidence noch dieselbe Version hat und keine Kontolöschsperre besteht.

## Privater Bildpfad

`POST /api/pretester/scan-reports`: bestehender Multipart-Vertrag `image` und `report`, weiterhin ausschließlich bestätigte `MANUAL_CAPTURE`-Uploads. Maximal 10 MiB Bild und 11 MiB Request. Prüfung von Signatur, Tokenwiderruf, Kontosperre, aktuellen UND Session-Rollen. Bestehende Report-Normalisierung wird wiederverwendet. Neue Reports haben eine unveränderliche servergesetzte `ownerUid`.

Vor Bildbytes wird eine private Eigentümer-/Uploadoperation gespeichert. Bildspeicherung über Google Cloud Storage IAM statt Firebase-Download-URL. Nachfolgender Report-Commit prüft dieselbe Löschsperre erneut. Bei unklarem Commit wird ein tatsächlich bereits angelegter Report nicht durch Bildlöschung beschädigt. Unvollständige Aufräumversuche behalten ihre Eigentümerzuordnung.

`GET /api/admin/scan-reports/{reportId}/image`: aktueller Admin erforderlich; Report und normalisierter exakter Bildpfad werden geprüft; Antwort private/no-store/nosniff. Keine langlebigen Downloadtokens. Storage-Clientzugriff auf `scanner-report-images/**` einschließlich Admin-Metadatenlesen ist gesperrt, damit Firebase keine neuen Downloadtokens generiert. Referenzbilder sind ein separater unveränderter Pfad.

Vorhandene Tokens werden per GCS-Metadatenpatch widerrufen, mit Generation-/Metageneration-Vorbedingungen. Größe, Generation, MD5 und alle übrigen Metadaten müssen erhalten bleiben. Keine produktiven Bilder werden dabei gelöscht. Bereits heruntergeladene Kopien lassen sich nicht zurückrufen.

## Autorisierter Löschprozess

Öffentlicher Einstieg bleibt die kontaktbasierte Anfrage unter https://domidex.web.app/konto-loeschen. Keine zusätzliche UI und kein unangemeldeter Löschbutton.

Geschützte Server-API auf der vorhandenen Adminroute, ohne deren bestehende Tester-/Rollenfunktionen zu ersetzen:

- `POST /api/admin/testers?action=delete-account`
- `Authorization: Bearer <gültiges Firebase-ID-Token>` – nur über HTTPS, niemals in URL, Repository oder Log.
- JSON zum Start: `{ "uid": "VERIFIZIERTE_ZIEL_UID", "confirm": "DELETE_DOMIDEX_ACCOUNT" }`
- Eigenes Konto oder aktuell berechtigter Admin nach dokumentierter Identitäts-/Umfangsprüfung. Authentifizierung höchstens fünf Minuten alt. Eine E-Mail allein ist keine Löschberechtigung.
- Resume: dasselbe JSON zusätzlich mit zurückgelieferter `jobId`; der Betreiber muss nach `nextActionAt` erneut fortsetzen. Es gibt absichtlich keinen neuen Scheduler.
- `GET /api/admin/testers?action=delete-account&jobId=...`: Admin-Statusabfrage ohne Mutation.
- `ACCOUNT_DELETION_READY=verified-v1` darf erst gesetzt werden, wenn Regeln und Function-Schutz nachweislich live sind.

Der initiale Eigentümer kann die eigene Löschung anstoßen. Nach Kontosperre/Widerruf ist sein Token nicht mehr für API-Aufrufe gültig. Der legitime Administrator setzt den Vorgang fort und kommuniziert den Status. Kein Refresh-Token, Passwort oder Service-Account-Schlüssel gehört in den Client.

### Inventar und Schutz

- Auth einschließlich Providerlink/Rollen; `users/{uid}` rekursiv, auch Subcollections ohne existierendes Elterndokument.
- Sammlung einschließlich Tombstones, Binderzuordnung, Kaufdaten, Notizen; beliebige vorhandene eigene Preferences-/Portfolio-/User-State-Unterpfade.
- Eigene Evidence; Contributor-ID `sha256(uid)` auch ohne noch vorhandene Evidence; verbleibende Beiträge werden transaktional mit derselben Aggregationsfunktion neu berechnet.
- Reports über neue `ownerUid` oder bestehende Bildmetadaten; private Bilder einschließlich verwaister Uploads.
- Eigene Nutzerbilder, Katalogbeiträge, Community-Bilder; eigene Community-/Supportdokumente und Uploadoperationen.
- Persönliche Review-/Audit-Attribution wird durch `deleted-account` ersetzt, ohne fremde Reportdaten zu löschen.
- Alte soft-gelöschte Versionen werden unabhängig von der aktuellen Bucket-Policy ebenfalls inventarisiert.

Globale Kataloge, Sets und fremde Kontodaten bleiben bestehen. Geschützte Scannerprofile/Manifest werden nicht verändert. Bei persönlicher Attribution in diesen Integritätsdaten: `PROTECTED_SCANNER_ATTRIBUTION`, vor Sperre/Löschung gesondert prüfen. Unklare Legacy-Eigentümer oder widersprüchliche Bild-/Reportzuordnungen führen ebenfalls zu `REVIEW_REQUIRED`, niemals zu geratenen Löschungen.

### Zustände und Wiederholung

1. Preflight; bei Blocker keine destruktiven Änderungen.
2. Durable Job und Schreibsperre außerhalb `users/{uid}`; Auth deaktivieren und Sessions widerrufen.
3. Privates Inventar dauerhaft sichern, bevor Reports/Bildmetadaten entfernt werden. Evidence vor Contributors löschen. Operationen sind wiederholbar; Generationsbedingungen schützen Objekte.
4. `PENDING_SESSION_EXPIRY` bis mindestens 65 Minuten nach bestätigter Sperre/Widerruf, nicht nach bloßem Jobstart. Bei erst später erfolgreicher Sperre startet die Frist entsprechend später.
5. Abschließender Inventar-/Restbestandssweep; Auth löschen und Nichtexistenz bestätigen.
6. Bei Storage-Restbestand `ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION` bzw. `PROVIDER_PURGE_NOT_CONFIRMED`. Sieben Tage sind die aktuell konfigurierte Soft-Delete-Frist; tatsächliche Generationen/Abwesenheit entscheiden, nicht nur eine abgelaufene Uhrzeit oder spätere Policyänderung.
7. Erst danach Jobinventar entfernen und Job/Schreibsperre/`COMPLETE`-Beleg atomar abschließen. Der Beleg enthält keine UID, E-Mail oder Originalpfade, nur zufällige Vorgangs-ID, Zählwerte und Abschlusszeit.

Teilfehler: `PARTIAL_FAILURE`, Wiederholung erforderlich. Parallele Verarbeitung erhält eine erneuerte, eigentümergeprüfte Lease; ein alter Worker darf keine neue Lease freigeben. Kein `COMPLETE` bei unvollständiger Jobbereinigung. Nicht außerhalb des Prozesses Sperren/Jobs entfernen oder Konten reaktivieren.

Bei Review-Blockern keine globalen Profile oder fremde Daten eigenmächtig bearbeiten. Eigentum bzw. rechtlich/technisch zulässige Behandlung muss zuerst geklärt werden. Protokolle/Mailbox, Anbieter-Backups und lokale Exporte sind getrennte Bearbeitungspunkte und nicht vom Cloud-Erfolg automatisch umfasst.

## Reproduzierbare Prüfungen und Deployment

- `npm run test:privacy-gate`: ausschließlich Demo-Auth-/Firestore-/Storage-Emulatoren, nie produktive Konten.
- `npm run test:android-contract`: Web-Regeln gegen bestehenden Android-Vertrag, keine Android-Dateiänderungen.
- `node scripts/prepare-private-cloud-release.mjs`: exakt drei anhand alter Hashes geprüfte Serverrouten, bestehende Normalisierung transpilieren; keine Client-/CSS-Datei.
- `npx vitest run --config vitest.config.ts tests/private-cloud-delegate.test.mjs`: zusätzliche Framework-Kontextübergabe darf nicht als Firebase-Serviceobjekt verwendet werden.
- `scripts/privacy-rules-snapshot.mjs`: Live-Regeln erfassen, nach Veröffentlichung mit `--verify` vergleichen.
- `scripts/verify-private-images-live.mjs`: ausschließlich zufällige isolierte Testkonten; anonyme/Normal-/Tester-/Adminrolle, Upload und unveränderte reale Bildbytes. Keine Tokenwerte in Ausgaben/Dateien.
- Tokenmigration nur explizit mit `--revoke-existing-tokens`, vollständige Client-Sperren mit `--strict-rules` prüfen.
- `scripts/switch-private-runtime.mjs`: Plan und gesondert `--publish`; alle bestehenden Hosting-Dateihashes und Legal-Rewrites bleiben erhalten.
- Temporäre, ausdrücklich genehmigte IAM-Testberechtigung mit `scripts/privacy-test-permission.mjs --revoke` wieder entfernen.

Rechtliche Einzelfragen stehen in `PRIVACY_LEGAL_DECISIONS_2026-09-04.md`; sie sind keine technische Freigabe.
