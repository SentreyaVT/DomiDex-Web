# Binder-Freigabe und Scanner: 25.09.2026

## Binder – Ursache und produktiver Fix

Die angegebene Freigabe lieferte HTTP 503 (`SERVER_OPERATION_FAILED`), während ihre HTML-Seite HTTP 200 lieferte. Zwei verschiedene synchronisierte Kartenplatzierungen beanspruchen Slot 5. Der bisherige Backend-Guard verwarf dadurch die gesamte Freigabe. Fehlende Empfängerrechte waren nicht die Ursache.

`backend/security/sharing.mjs` löst Kollisionen jetzt ausschließlich für die schreibgeschützte Freigabeansicht auf: eindeutige Positionen werden reserviert, Gewinner bei Kollisionen nach stabiler Dokument-ID bestimmt und weitere Platzierungen auf freie Positionen verteilt. Es werden keine Karten verworfen und keine Eigentümerdaten verändert. Dies repariert die Anzeige; es schreibt das synchronisierte Ursprungslayout ausdrücklich nicht um.

Unverändert bleiben Eigentümerberechtigung, Deaktivierung, Kontolöschungssperre, Freigabewiderruf einschließlich erneuter Prüfung nach dem Katalogabruf, Feld-Allowlist und die bestehenden Anzeigeoptionen. Die Freigabe bleibt über ihren geheimen Link lesbar; neue Rollen oder Rechte wurden nicht vergeben.

### Prüfung

- 68 Vitest-Tests in sechs Sharing-/UI-/Material-Dateien bestanden.
- Vier Node-Tests zur bestehenden Kontolösch-Kompatibilität bestanden.
- Neue Kollisionsfälle reproduzierten den Fehler vor dem Fix; danach erfolgreich: 23 Platzierungen, deterministische Reihenfolge, weitere Seiten, Preise/Holos, fehlender Katalog, ungültige Datensätze und Widerrufe.
- Kandidat und Produktion: jeweils 17 HTTP-/Asset-/Sicherheitsprüfungen bestanden.
- Betroffene Freigabe: alle drei Seiten HTTP 200; 21 referenzierte aktive Einträge, davon 19 gültige Katalogdarstellungen und zwei vorhandene Katalog-Unverfügbarkeitsplätze. Keine doppelte Position. Zwei weitere Platzierungen verweisen nicht auf aktive Einträge und werden gemäß unveränderter bestehender Logik nicht angezeigt.
- Datensätze von Freigabe und Eigentümerlayout vor/nach dem reinen Abruf identisch. Fehlende Katalogauflösung wird nicht durch falsche Karten ersetzt.

### Bereitstellung

Nur `/app/backend/binder-sharing/sharing.mjs` wurde über das unveränderliche Produktionsimage gelegt. Alle 61 bestehenden Image-Layer, Dependencies, Startkonfiguration, IAM und bisherigen Traffic-Zuordnungen blieben erhalten. Die 155 Hosting-Dateien blieben identisch; allein der bestehende Catch-all-Revisionstag wurde aktualisiert. Kein allgemeiner Frontend-Neubau und keine Firebase-Regeländerung.

- Cloud Build: `9410a419-ef1e-48e6-b0a5-2901be9e0c63`
- Revision: `domidex-web-sharing-layout-repair-20260925`
- Image: `sha256:206ffad8c5f428097a7e9699f9937723f98449f5c96cef89d2b33078141ab80a`
- Hosting-Version: `sites/domidex/versions/c71089a842d591bc`
- Vorherige Hosting-Version: `sites/domidex/versions/9e120a8331daa9e6`
- Private Prüf-/Bereitstellungsnachweise: `.domidex/incident-scanner-sharing-20260925/` (nicht versioniert).

## Xiaomi – tatsächlicher Teststand und Vergleich

Vorher installiert war ein Debug-/Teststand mit Versionscode 26, nicht der offizielle Release-26-Laufzeitstand. Der Nutzer bestätigte dies ausdrücklich.

Frische lokale Messung: vollständiger Analyseweg 16,552 s, davon 13,855 s im OCR-Abschnitt und 1,908 s Kandidatensuche. Ein anderer Lauf endete bereits nach der Orientierungsprüfung in manueller Prüfung (4,433 s gesamt); er ist deshalb kein gleichwertiger schneller Erkennungsvergleich. Firebase war in diesen Messungen nicht als Hauptwartezeit belegt. Die neue Reviewed-Knowledge-Anbindung ist im echten v26-AAB nicht enthalten.

Auf ausdrücklichen Wunsch wurde die bereits archivierte `artifacts/closed-alpha26-r8-verification/release-runtime.apk` lokal installiert. Ihre fünf DEX-Dateien und sieben ARM64-Nativbibliotheken wurden bytegenau gegen das signierte v26-AAB geprüft. Die APK verwendet die bereits vorhandene lokale Android-Testsignatur; der Inhalt stammt aus Release 26, es ist keine Google-Play-Installation und es wurde nichts neu signiert oder gebaut.

Vorher vollständige zugriffsgeschützte lokale Sicherung der App-Daten außerhalb des Repositories; anschließend datenbewahrendes `install -r`, keine Deinstallation. Installierte APK SHA-256: `1994801e024d332699871b141cfecd4c331d7f4632648c36be30f38afd929256`. Version `1.0-closed-alpha.5`, Code 26, nicht debuggable und nicht testOnly. Start erfolgreich, kein protokollierter Absturz. Nutzer meldete anschließend: „geht wieder besser“.

Keine neue quantitative Beschleunigung oder höhere Treffgenauigkeit behauptet: Release 26 gibt keine ausführlichen Debug-Stufenzeiten aus. Die Rückmeldung bestätigt die praktische Verbesserung gegenüber dem vorher installierten Teststand. Mögliche OCR-Cache-Optimierungen wurden nur untersucht, nicht eingebaut. Kein Android-Quellcode, AAB, Signing, Scannerprofil oder Google-Play-Release wurde in diesem Incident geändert.
