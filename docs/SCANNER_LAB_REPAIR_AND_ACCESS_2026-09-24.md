# Scanner Lab: Lesefehler, getrennte Freigabe und einfachere Bedienung

Stand: 24. September 2026. Dieses Dokument trennt den bereits veröffentlichten Lesefix von der anschließenden Erweiterung der Berechtigungen und Oberfläche.

## Veröffentlichungsstand

- Der erste Lesefix ist laut bestätigtem Deployment auf Hosting-Version `88bf771063281795` und Cloud-Run-Revision `domidex-web-scanner-admin-repair-20260924` aktiv.
- Die anschließende Erweiterung um `scannerLabAccess`, die vereinfachte Oberfläche und den serverseitigen Referenzzugriff ist ebenfalls veröffentlicht und live geprüft: Hosting-Version `f60dd0f69845ded4`, Cloud-Run-Revision `domidex-web-scanner-lab-access-20260924`.
- Die Vorbereitung vergibt keine Nutzerrechte. Die Freigabe einzelner Nutzer erfolgt später ausdrücklich durch einen Administrator in „Tester & Berechtigungen“.

## Ursache und Lesefix

Die tatsächlich ausgelieferten älteren Scanner-Admin-Routen verwendeten das Firebase-ID-Token des Browsernutzers auch für ihre Firestore-Abfragen. Die aktuelle Quellfassung nutzte bereits eine aktuelle serverseitige Rollenprüfung und anschließend Serverzugangsdaten. Der ausgelieferte Stand entsprach damit nicht dieser Quellfassung.

Der Upload war davon getrennt: Es wurden erfolgreiche Antworten und gespeicherte neue Reports nachgewiesen. Beim anschließenden Laden der Reports und Scannerprofile antworteten die älteren Webrouten mit einer generischen HTTP-400-Fehlermeldung. Dadurch wirkten korrekt übermittelte Fehlscans im Lab unsichtbar.

Der Lesefix prüft zuerst die aktuelle Berechtigung und verwendet danach die angehängte Serveridentität für Firestore. Unerwartete Infrastrukturfehler erhalten HTTP 503 und eine sichere Fehler-ID. Eigentümer- und Bildmetadaten bleiben beim Bearbeiten eines Reports erhalten.

Der alte Browserclient fordert `GET /api/admin/scan-reports` ohne Parameter an und kennt keine weiteren Cursorseiten. Deshalb liefert ein Aufruf ohne `pageSize` und ohne `pageToken` weiterhin die vollständige Liste, neueste zuerst. Sobald mindestens einer dieser Parameter explizit vorhanden ist, gilt das bestehende paginierte Verhalten. Die neue Oberfläche lädt zunächst 48 Reports und kann weitere Seiten nachladen.

## Getrennte Scanner-Lab-Freigabe

`scannerLabAccess` ist ein eigener Custom Claim und ein eigenes Feld im serververwalteten `accountAccess`-Dokument. Es vergibt weder allgemeine Administratorrechte noch automatisch Web-App- oder Pretesterrechte.

Die private Serverprüfung verlangt den passenden Claim sowohl am aktuellen Auth-Nutzer als auch im vorgelegten Session-Token und berücksichtigt die aktuelle Zugriffssperre. Ein aktiver Administrator darf das Lab weiterhin nutzen. Kontosperre, Löschsperre, ungültige Session und ausdrücklicher Entzug werden berücksichtigt; unbekannte Rollen werden abgewiesen.

| Aktion | Scanner-Lab-Freigabe | Administrator |
|---|---|---|
| Fehlscans lesen und Originalbilder/Vorschauen ansehen | erlaubt | erlaubt |
| Kartenreferenz, Variante, Review-Notiz und Bearbeitungsstand ändern | erlaubt | erlaubt |
| Referenzkatalog und Referenzbilder ansehen | erlaubt | erlaubt |
| Scannerprofile zur Einordnung lesen | erlaubt | erlaubt |
| Scannerprofile ändern | gesperrt | bestehender Entwurfsablauf |
| Reports und private Bilder löschen | gesperrt | bestehender expliziter Löschablauf |
| Nutzerrechte, Website-Inhalte oder allgemeine Administration ändern | gesperrt | bestehende Adminrechte |
| Produktion veröffentlichen oder zurückrollen | gesperrt | weiterhin durch fehlende Engine-Benchmarks gesperrt |

Die Berechtigungsverwaltung bleibt selbst ausschließlich Administratoren zugänglich. Ein PATCH akzeptiert genau eine gültige Änderung aus `pretester`, `appAccess` und `scannerLabAccess`; andere Claims werden erhalten. Auch Nutzer mit ausschließlich Scanner-Lab-Zugang werden in der Verwaltungsliste angezeigt. Ein Hinweis erklärt, dass der Zugang private Fotos anderer Nutzer umfasst. Unmittelbar vor einer Lab-Freigabe ist zusätzlich eine Bestätigung mit Anzeigename, E-Mail und konkretem Rechteumfang erforderlich. Abbrechen sendet keine Änderung an den Server. Andere Freigaben und der bestehende Entzugsablauf bleiben unverändert.

## Private Bilder und Referenzen

Private Uploadbilder werden weiterhin ausschließlich über den authentifizierten Serverendpunkt ausgeliefert. Die Beziehung zwischen Report, Eigentümer, Bildpfad, Hash und Bildmetadaten wird vor der Ausgabe geprüft. Direkter Firebase-Storage-Zugriff auf `scanner-report-images/**` bleibt gesperrt; es werden keine öffentlichen Downloadtokens erzeugt.

Der Referenzzugriff verwendet nach erfolgreicher Lab-Berechtigungsprüfung einen auf das Referenzarchiv begrenzten Server-OAuth-Lesepfad. Dieser liest nur `scanner-reference/master-index.json` und passende WebP-Dateien unter `scanner-reference/images/`. Lokale Referenzbrücke und erlaubte Katalogbildquellen bleiben erhalten. Auch bei einem Cachetreffer findet die Rollenprüfung an der Route vorher statt.

## Oberfläche

Das Lab öffnet mit den Fehlscans. Eine kurze Anleitung führt durch drei Schritte: Foto ansehen, passende Karte auswählen und Ergebnis speichern. Bearbeitungsstände erscheinen auf Deutsch; die Speicheraktion erklärt ausdrücklich, dass die Karte bestätigt und gespeichert wird. Eine erfolglose Suche bietet „Alle Fehlscans anzeigen“ zum Zurücksetzen der Filter.

Vor der ersten erfolgreichen Antwort wird der Bestand ausdrücklich als noch unbekannt behandelt: Ladehinweis beziehungsweise Fehlermeldung statt „0 Fehlscans“ und leerer Warteschlange. Erst eine erfolgreiche leere Antwort zeigt tatsächlich null Fehlscans. Während einer Aktualisierung bleiben die zuletzt geladenen Reports sichtbar; ein fehlgeschlagener Abruf benennt diesen alten Stand und bietet einen erneuten Versuch an.

Die Aufnahme bleibt im Prüfbereich sichtbar. Technische Zusatzinformationen, Analysezonen und Scannerprofil-Kalibrierung sind vom einfachen Prüfablauf getrennt und nur Administratoren zugänglich. Für Nutzer mit Lab-Freigabe werden Lösch- und Profiländerungsaktionen ausgeblendet. Ihr Rücklink führt zur Startseite statt in die allgemeine Administration.

Die Veröffentlichung ist auf die beiden Oberflächen `/admin/scanner-lab` und `/admin/testers` sowie deren notwendige Serverrouten begrenzt. Die übrige Web-App und das allgemeine Website-Design gehören nicht zum Umfang.

## Android und Uploadvertrag

Android-Release 26 verwendet weiterhin den vorhandenen Endpunkt `/api/pretester/scan-reports`. Ein Upload verlangt ein berechtigtes Admin- oder Pretesterkonto, eine bewusste manuelle Aufnahme und die ausdrückliche Sendeaktion. `scannerLabAccess` allein berechtigt nicht zum Upload.

Die Android-Uploadimplementierung, die Aufnahme-/Erkennungslogik und das Datenformat wurden für diese Webänderung nicht verändert. Keine Hintergrundübertragung und kein automatischer Wiederholungsversuch werden hinzugefügt.

## Bisherige lokale Prüfungen

Die folgende gezielte Testgruppe bestand nach den beiden abschließenden Reviewkorrekturen mit 119 von 119 Tests:

```text
tests/scanner-admin-read-auth.test.ts
tests/scanner-report.test.ts
tests/scan-reports-route.test.ts
tests/scanner-lab-ui.test.tsx
tests/scanner-profile.test.ts
tests/scanner-references.test.ts
tests/auth-provider.test.tsx
tests/tester-permissions.test.tsx
tests/tester-permissions-route.test.ts
tests/scanner-lab-access-routes.test.ts
```

Geprüft wurden unter anderem die vollständige Legacy-Liste über mehrere Firestore-Seiten, explizite Pagination, sichtbare Serverfehler, Berechtigungsprüfung vor dem Datenzugriff, Lab-only-Review mit erhaltener Eigentümerschaft, verweigerte Profil- und Rollenänderungen, der Entzug bestehender Rechte und die vereinfachten Bedienelemente. Die zusätzlichen Tests sichern Ladezustand, fehlgeschlagenen Erstabruf, erfolgreichen Wiederholungsversuch, erhaltene Reports beim Aktualisieren sowie die bewusste Freigabebestätigung ab. `tsc --noEmit --incremental false` bestand ebenfalls.

Die Gesamtgruppe `npm test` lieferte laut Integrationsprüfung zunächst 534 von 535 bestandene Tests. Der einzige Fehler war ein Zeitlimit im unabhängigen Binder-Sharing-Test unter paralleler Last; dessen isolierte Wiederholung bestand mit 5 von 5 Tests. An dieser Funktion wurde nichts geändert.

Die neuen Testdateien sind in die explizite Liste des `package.json`-Testskripts aufgenommen. Der abschließende vollständige Lauf `npm test -- --reporter=dot --no-file-parallelism` bestand mit **583/583 Tests in 46 Dateien**. Der isolierte TypeScript-Lauf bestand ebenfalls. Bestehende Canvas-/React-Testumgebungswarnungen wurden nicht mit Änderungen an anderen Funktionen unterdrückt.

## Artefaktprüfung und Live-Nachweise

- Die beiden konkreten Reviewfunde — unbekannter Bestand als scheinbare Null und sofortige Ein-Klick-Lab-Freigabe — wurden nach ausdrücklicher Freigabe eng begrenzt korrigiert und getestet. Der Quellstand ist anschließend wieder eingefroren.
- Der erste Build der Erweiterung wurde vor einer Veröffentlichung wegen einer fehlenden `sharp`-Laufzeitabhängigkeit abgebrochen. Für das isolierte Lab-Vorschaubildpaket wurde `sharp` 0.34.5 mit Lockfile ergänzt. Die alten Upload- und Appmodule bleiben unverändert.
- 43/43 Tests am tatsächlich gebündelten Router und Backend bestanden, einschließlich aktueller Rollenprüfung, Entzug/Sperren, Nicht-Eskalation, Bild-/Eigentümerprüfung, Server-OAuth und Delegation aller fremden Routen. Test-Hashbindung: `d01f794545b53426e148245f2d80b38691826b3ae5d5e174d893a75a17fdf443`.
- Erfolgreicher Cloud Build: `4f1d684c-6a46-495b-84fc-04baaa65859d`. Containerimage: `europe-west1-docker.pkg.dev/cardvault-715ac/cloud-run-source-deploy/domidex-web@sha256:60a432baa41d6561bdb493646d60fec75108055221890ab6f873be98701d6f7c`.
- Der Build prüft die tatsächliche WebP-Erzeugung mit der isolierten Bildvorschau-Abhängigkeit. Die bisherigen Runtime-Abhängigkeiten werden nicht ersetzt.
- 33/33 Prüfungen der Kandidatenrevision und anschließend 33/33 Production-Prüfungen bestanden: neue Seiten/Assets entsprechen dem geprüften Paket, unberechtigte Zugriffe werden abgewiesen, nicht betroffene Seiten/API-Antworten bleiben unverändert.
- Alle 155 bestehenden Firebase-Hosting-Dateihashes blieben unverändert. IAM, Runtime-Konfiguration und bestehender Traffic wurden erhalten. Hosting verweist ausschließlich mit dem bestehenden Catch-all auf den neuen geprüften Tag. Container-Layer und Änderungen wurden geprüft; außerhalb des gezielten Routers kamen nur isolierte Lab-Dateien hinzu.
- Authentifizierter Browser: **39 Reports, davon 5 heute**, private Originalaufnahme von Strahlendes Quajutsu sichtbar, Vorschaubilder sichtbar. Die Suche nach **Astralglanz + 046/189** liefert die korrekte Referenz **Strahlendes Quajutsu, swsh10-046** mit Bild. Keine Browserfehler bei dieser Prüfung.
- Die bestehende Seite „Tester & Berechtigungen“ zeigt den zusätzlichen Schalter **Scanner Lab freigeben** pro berechtigtem Zielkonto. Es wurde **keinem realen Nutzer eine Rolle gegeben oder entzogen**. Grant/Entzug und Review-Schreibvorgänge wurden ausschließlich mit isolierten Testkontexten geprüft; Liveprüfungen blieben lesend.
- Android/Release 26, manueller Upload-Consent, Sammlung, Binder, Preise und allgemeines Web-App-Design wurden für diesen Run nicht geändert. Kein Android-Build, keine Play-Veröffentlichung, kein Commit/Push.

Die gebündelten Artefakte, Ausgangssicherung und Prüfnachweise liegen lokal unter `.domidex/scanner-lab-access-20260924/`; der vorherige Lesefix unter `.domidex/scanner-admin-repair-20260924/`. Der vorherige Hosting-Stand `88bf771063281795` bleibt als Rückfallstand verfügbar.

Dieses Dokument enthält keine Nutzerkennungen, Zugangsdaten oder Tokens.
