# Scanner Lab: Einstieg, geprüfte Erkennungshinweise und sichere Löschbestätigung

Stand: 24.09.2026. Web-Version veröffentlicht und auf domidex.web.app verifiziert. Android-Anbindung nur als getesteter Quellstand, noch nicht ausgeliefert.

## Ziel und Umfang

- Berechtigte Nutzer erhalten einen sichtbaren Scanner-Lab-Einstieg auf Desktop/Mobil und auch im Zugangshinweis, wenn sie ausschließlich Lab-Zugang haben.
- `Karte bestätigen und speichern` speichert eine kataloggeprüfte Karte/Variante und stellt bei vorhandener originaler Analysekennung einen getrennten, konservativen Erkennungshinweis für Android bereit.
- Löschen nach Ablauf der bestehenden 15-Minuten-Sicherheitsfrist bietet eine ausdrückliche erneute Google-Bestätigung; danach ist die Löschung nochmals zu bestätigen. Kein automatischer Lösch-Retry.
- Keine echten Nutzerrechte geändert, keine echten Scans bestätigt oder gelöscht. Manuelle Fotoübermittlung unverändert. Keine R8-, Signing-, Release-/Versions- oder Play-Änderungen.

## Verbindung statt vorgetäuschtem Training

Vorher änderte das Lab lediglich den Reviewstatus. Uploads enthielten keine ursprüngliche Analysekennung; der Android-Scanner las diese Reviews nicht.

Android überträgt künftig beim ausdrücklich gewünschten Foto-Upload optional `knowledgeContext` mit Schema 1, SHA-256-Fingerprint der ursprünglichen Analyse, `scanner-v2.1` und Wissensversion 1. Der Fingerprint wird vor dem Entfernen visueller Merkmale aus dem Queue-Zustand erhalten; er wird weder aus dem JPEG-Hash noch aus OCR-Ausschnitten nachgebaut.

Der Web-Server erstellt `recognitionReference` ausschließlich nach Katalogvalidierung einer ausdrücklich bestätigten Karte und Variante. Report und Audit werden atomar geschrieben. Die Firestore-Updateversion schützt gegen zwischenzeitliche Bearbeitung/Löschung und Wiederanlage gelöschter Reports.

`POST /api/scanner/reviewed-knowledge` prüft aktuelle Tester-/Adminberechtigung und gibt nur Version, Fingerprint und kanonische Karten-/Set-/Nummer-/Variantenidentität zurück. Quelle sind weiterhin die privaten, aktuell bestätigten `scannerReports`, keine zusätzliche öffentliche Datensammlung. Keine Bilder, Report-/Nutzer-IDs, Notizen oder OCR-Texte verlassen diese Grenze. Konflikte/Überlauf geben keinen Hinweis; laufende Kontolöschung wird berücksichtigt. Re-Review und Reportlöschung nehmen den Hinweis zurück.

Keine künstlichen Community-Stimmen, kein erzwungener `STABLE`-Status, keine Freigabe von Scannerprofilen oder Benchmark-Umgehung. Bestehende Community-Aggregation und Firebase-Regeln bleiben unverändert.

### Wichtige Grenzen

- Release 26 kann diesen neuen Endpunkt noch nicht nutzen. Android-Quellen für den nächsten Teststand wurden ergänzt, aber keine APK/AAB erstellt oder installiert.
- Alte Reports ohne originale Kennung bleiben gespeichert/zugeordnet, aber sind nicht rückwirkend scannerwirksam. Die Oberfläche erklärt den notwendigen neuen Scan mit einer aktualisierten App.
- Dies ist kein allgemeines KI-/Bildmodelltraining. Exakter Fingerprint ist vorausgesetzt; eine andere Aufnahme kann einen anderen Fingerprint haben.
- Android liest den Hinweis parallel, maximal 1,5 Sekunden lang, ohne auf die Antwort zu warten oder dauerhaft zu cachen. Zu spät kommende Hinweise wirken nicht auf einen abgeschlossenen Scan.
- Nur bereits vorhandene, eindeutige, offiziell passende und widerspruchsfreie Kandidaten erhalten einen kleinen Rankingbonus. Keine neuen Kandidaten, keine automatische Annahme; unklar gemappte Sondervarianten werden nicht geraten.

## Löschproblem

`RECENT_LOGIN_REQUIRED` war eine absichtliche serverseitige Sicherheitsprüfung, kein fehlendes Adminrecht. Reines Token-Aktualisieren erneuert `auth_time` nicht. Die Oberfläche bietet deshalb `reauthenticateWithPopup` für dasselbe Google-Konto und anschließend eine frische Tokenabfrage. Abmelden/Kontowechsel und automatische erneute DELETE-Aufrufe finden nicht statt.

Bei der ersten abgelaufenen Bestätigung wird die Stapellöschung gestoppt. Nicht gelöschte Scans bleiben ausgewählt. Der Nutzer bestätigt Google und danach selbst erneut die Löschung. Popup-Abbruch/-Blockierung und falsches Konto werden verständlich angezeigt. Die 15-Minuten-Prüfung und Admin-only-Grenze bleiben erhalten.

Kontowechsel oder Abmeldung während der erneuten Bestätigung brechen den Ablauf ab. Verzögerte Tokenantworten/Callbacks dürfen weder einen früheren Nutzer noch dessen Rechte wieder einsetzen; mit unabhängiger Race-Reproduktion und Regressionstests geprüft.

## Prüfungen

- Web: 639/639 Tests in 48 Suites bestanden (inkl. 37 spezialisierter Feedback-Vertragstests und 21 Auth-Tests); TypeScript erfolgreich.
- Tatsächlich paketierter Router/Backend: 57/57 isolierte Prüfungen, einschließlich Upload mit/ohne Zusatzkennung, Berechtigungen, Rücknahme/Konflikt, Datenschutz, CAS und frischer/veralteter Löschbestätigung.
- Android: 52/52 Tests in 9 Klassen, Debug-Unit-Kompilation erfolgreich. Keine Geräteinstallation/kein Release-Build.
- Produktiver Firestore-Abfragepfad lesend mit leerem Testfingerprint geprüft: unterstützt, keine Schreibzugriffe/keine privaten Felder zurückgegeben.
- Keine echte Aufnahme zu Testzwecken gelöscht oder als richtige Karte bestätigt.
- Kandidat: 41/41 HTTP-/Asset-/Berechtigungsprüfungen bestanden; nach Live-Umschaltung erneut 41/41 bestanden.
- Angemeldete Browserprüfung: neuer Scanner-Lab-Einstieg in `/app` sichtbar und geöffnet, 39 Reports sowie Vorschaubilder/Originalbild geladen, neuer Erkennungshinweis sichtbar. Keine Löschung oder Kartenbestätigung durchgeführt. Offener Kalibrierungsentwurf in ursprünglichem Tab unangetastet; Prüfung in zusätzlichem Tab.

## Bereitstellung

Isolierte Stage: `.domidex/scanner-lab-feedback-20260924`.

Basis: Hosting `sites/domidex/versions/f60dd0f69845ded4`, Run-Revision `domidex-web-scanner-lab-access-20260924`, Image `sha256:60a432baa41d6561bdb493646d60fec75108055221890ab6f873be98701d6f7c`.

Nur Collector-/Lab-Frontend und vorhandenes isoliertes Lab-Routing/Backend werden ergänzt. Unveränderte Ausgangs-Layer, Runtime/IAM und alle 155 Hosting-Dateien werden durch Hashprüfungen gesichert. Bewährtes Collector-CSS bleibt bytegenau erhalten und erhält ausschließlich die zusätzlichen Link-Regeln. Alte gehashte Assets bleiben für offene Sitzungen verfügbar.

Verifiziert live:

- Cloud Build: `165295cf-b372-4907-9615-835d1fb40472` — SUCCESS.
- Artefakt-Hash: `044dd61501fd84aeff2a455b00ad6fb39b031f4b967aabb832e0240fe46e04a4`.
- Run-Revision/Tag: `domidex-web-scanner-lab-feedback-20260924` / `scanner-lab-feedback-20260924`.
- Image: `europe-west1-docker.pkg.dev/cardvault-715ac/cloud-run-source-deploy/domidex-web@sha256:80945348f1ef574f4b27d29524ef0e7fbd6c623f5834e804bdb59280eed58e72`.
- Hosting-Version: `sites/domidex/versions/9e120a8331daa9e6`.
- Hosting-Release: `sites/domidex/releases/1790274254536000`.
- Alle 58 bisherigen Image-Layer, alle 155 Hosting-Dateien, IAM und Runtime-Einstellungen erhalten. Nur freigegebene Overlay-Dateien ergänzt/ersetzt.
- Rollback-Ausgangspunkt bleibt Hosting `f60dd0f69845ded4` mit Tag `scanner-lab-access-20260924`.

Zwei Paketprüfungen stoppten vor Live-Änderungen: eine historische Docker-Whiteout-Markierung wurde zunächst fälschlich als Datei inventarisiert (Snapshot korrigiert); anschließend unterschied sich ausschließlich das historische `Config.Image`-Metadatum. Dieses wurde für genau den geprüften Build getrennt an seine beiden Hashwerte gebunden; alle tatsächlichen Laufzeitfelder werden weiterhin strikt verglichen. Die Bedeutung des Metadatums ist in den [Moby-API-Änderungen](https://github.com/moby/moby/blob/master/api/docs/CHANGELOG.md) dokumentiert. Keine produktive Sicherheitsprüfung wurde gelockert.

Keine Commits oder Pushes; bestehende fremde Working-Tree-Änderungen bleiben erhalten.
