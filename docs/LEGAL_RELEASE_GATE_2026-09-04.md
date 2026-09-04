# DomiDex Web – Abschluss des Legal-/Privacy-Release-Gates

Stand: 04.09.2026. Umfang: öffentliche Webinformationen, technische Prüfung, sicher begrenztes Hosting-Deployment. Keine Android-Änderung, keine produktive Kontolöschung, keine Play-Veröffentlichung.

## A. GOOGLE-PLAY-WEB-READINESS

**NOT READY.** Die angeforderten Informationsseiten sind veröffentlicht; eine vollständige Release-Freigabe ist damit nicht gegeben.

Konkrete verbleibende Blocker:

1. **Privater Bildzugriff:** 29/29 bestehende ScanLab-Bilder besitzen Downloadtokens; eine unauthentifizierte Stichprobe mit Token lieferte 200. Adminschutz allein schützt diesen Weg nicht. Widerruf vorhandener Tokens und dauerhafte Vermeidung neuer ungeschützter Downloadlinks müssen zusammen geplant und geprüft werden.
2. **Produktive Regeln:** Live-Firestore-/Storage-Regeln entsprechen nicht den lokal getesteten Regeln. Zusätzliche appAccess-Gates fehlen bei einigen eigenen Datenpfaden; Report-Erstellung akzeptiert `reviewedBy` zusätzlich. Nicht blind durch strengere Regeln ersetzen: Auswirkungen auf bestehende Android-Konten/Sync vorher prüfen. Eigentümer-Isolation besteht weiter.
3. **Vollständige Löschbearbeitung und rechtliche Festlegungen:** Erreichbare Anfrage ist umgesetzt, vollständige Cloud-Löschung nicht nachgewiesen. Löschverfahren, Retention, Rechtsgrundlagen, Empfänger-/Transferverhältnisse und SDK-Consent müssen abschließend geklärt werden.

## B. DATENSCHUTZ

Live: https://domidex.web.app/datenschutz

Dominik Muxfeld ausdrücklich als Verantwortlicher benannt; bestätigte Anschrift Krüzbühelweg 8, 6706 Bürs, Österreich; Kontakt Dominik.muxifeld@gmail.com. Datenflüsse für Google-Anmeldung, eigene Sammlung/Notizen/Kaufdaten, manuellen ScanLab-Fotoversand, getrennte foto-freie Evidence, Katalogbeiträge, Browser-Speicher, SDK-Diagnostik und Löschanfragen dokumentiert.

Aktive Dienste: Firebase Auth, Firestore, Storage, Hosting, Cloud Run; bestehende Android-Evidence-Functions und Android-SDKs sind davon abgegrenzt. Keine Analytics-/Ads-/Crashlytics-Freiheit mit vollständiger Telemetrie-Freiheit verwechselt.

Auf Nutzerwunsch stehen interne Rechtsprüfvermerke NICHT auf öffentlichen Seiten. Dadurch sind offene rechtliche Fragen nicht als geklärt erklärt. Details: `LEGAL_PRIVACY_DATA_FLOW_2026-09-04.md`.

## C. SCANLAB

Unverändert: manueller Einzelknopf → Vorschau → ausdrückliches Hochladen. Kein automatischer oder erst nach zwei Fehlscans freigegebener Fotoversand eingeführt. Foto/OCR/Kandidaten/Konfidenz/Fehler/Versionen werden von foto-freier Evidence getrennt erklärt. Adminbildroute schützt regulären Zugriff und setzt private/no-store. Bestehender Downloadtoken-Bypass bleibt bestätigter Blocker; kein Token und kein Foto veröffentlicht.

## D. KONTAKT

Live: https://domidex.web.app/kontakt

Bestätigte Betreiberadresse und Mail für Support, Datenschutz und allgemeine Fragen aufgenommen. Offizieller Discord https://discord.gg/a6DfqBt8N7 per öffentlicher Invite-API überprüft (200, DomiDex TCG). Alle Mailto-Links/Entwurf geprüft; keine Testmail ohne Anlass versendet.

## E. IMPRESSUM

Live: https://domidex.web.app/impressum

Bestätigter Name, Anschrift, E-Mail und Privat-/Non-Profit-/Pre-Beta-Status enthalten. Überholte Platzhalter entfernt. Keine Gesellschaftsform, Register-/Steuer-/Gewerbenummer oder separate Firmenanschrift erfunden. Etwaige darüber hinausgehende österreichische Informationspflichten bleiben zur manuellen rechtlichen Prüfung, nicht als öffentlicher Platzhalter.

## F. ACCOUNT DELETION

Live und ohne Login erreichbar: https://domidex.web.app/konto-loeschen

E-Mail-Anfrage, keine vorgetäuschte automatische Löschung. Durch die Seite selbst werden **keine Daten gelöscht**. Für die spätere tatsächliche Bearbeitung gehören Auth, Collection/Tombstones, Notizen/Kaufdaten/Binderbezug, Evidence, gehashte Contributors, zuordenbare Reports und Storageobjekte einschließlich Orphans zum Prüf-/Löschumfang. Gemeinsame Kataloge/Preise/Profile nicht blind löschen; persönliche Attribution/Aggregate differenziert behandeln. Gerätekopien/Exporte nicht aus der Ferne gelöscht; Anbieterlogs/Backups separat.

Vollständige Cloud-Löschung technisch nachgewiesen: **NEIN**.

Exakter Rest: verifizierte Identität, privilegierter wiederholbarer Löschlauf mit Schreibschutz gegen Sync/Functions, vollständiges Eigentümerinventar, Entfernung personenbezogener Beiträge und konsistente Reaggregation, überprüfter Endzustand/Auth-Abschluss; sichere Emulator-Teilfehlertests. Operator-Ablauf und Lücken: `ACCOUNT_DELETION_RUNBOOK_2026-09-04.md`.

## G. COOKIES / STORAGE / TRACKING

Die fünf veröffentlichten Informationsseiten sind statisches HTML ohne JavaScript/AuthProvider. Datenschutzseite im frischen Browser: keine Cookies, LocalStorage, SessionStorage oder IndexedDB; nur domidex.web.app angefragt. Kontoseiten unverändert: Firebase LOCAL-Auth, SDK-Heartbeat, mögliche Google-Auth-Verbindungen schon vor dem Klick auf manchen Browsern. Kein aktiver eigener Werbe-/Analytics-Tracker gefunden. Einwilligungsbedarf: **juristisch zu prüfen**, kein dekorativer Banner eingebaut.

## H. DATA SAFETY

Aktualisierte Matrix: `LEGAL_PRIVACY_DATA_FLOW_2026-09-04.md`. Sie enthält Sammlung/Empfänger, Zwecke, optional/erforderlich, Speicher/TLS, Nutzerkontrolle, Löschbarkeit und gesonderte Play-Weitergabe-Einordnung. Ergänzt gegenüber Android-Handoff: Browserpersistenz/Vorabkontakte, öffentlich erreichbare Löschanfrage, tatsächliche Live-Regelabweichung, bestätigter Tokenzugriff und Contributor-/Orphan-Löschlücken. Keine Play-Formulare ausgefüllt.

## I. SECURITY

- Keine Rules gelockert oder deployed, keine Rollen/Claims oder Nutzerdaten verändert.
- 4 reguläre Admin-API-Stichproben ohne Token ergeben 401 (Tester, Reports, Profile, Reportbild).
- Bild ohne Token 403, mit bestehendem Downloadtoken 200: NICHT als vollständig privat freigegeben.
- 131 bestehende öffentliche JS/CSS/JSON-Dateien auf Private-Key-/Service-Account-/OAuth-/Git-Token- und private lokale Pfadmuster geprüft: keine Treffer. Das ist eine gezielte Musterprüfung, keine absolute Geheimnisfreiheitsgarantie.
- Neue öffentliche HTML-Artefakte ohne Secret-/localhost-/API-Aktionspfade geprüft. Firebase öffentliche Clientkonfiguration ist nicht als Service-Account-Schlüssel behandelt.
- Neue statische Seiten: CSP, no-store, nosniff, no-referrer; kein öffentliches Lösch-API und keine Fake-Erfolgsanzeige.

## J. TESTS

- Typecheck erfolgreich.
- Scope-Lint erfolgreich. Gesamt-Lint nicht grün: bestehende Fehler in drei schon vor diesem Run vorhandenen `patch-cloud-run-*.cjs`-Skripten (CommonJS-Importregeln und prefer-const). Keine fremden Änderungen dafür umgebaut.
- Bestehende Web-Units: **60/60**.
- Neue Legal-/Hosting-Sicherheitstests: **13/13**.
- Lokaler Firestore-Emulator: **6/6**. Storage-Regeln: **4/4**. Diese Ergebnisse gelten nicht automatisch für die abweichenden Live-Regeln.
- Production Build erfolgreich. Bekannte nicht-blockierende Chunkgrößen-/Node-Deprecation-Warnungen.
- Alle fünf öffentlichen Seiten lokal und live bei 1920, 390 und 320 Pixel Breite geprüft: 200, keine horizontalen Überläufe, Logo sichtbar, keine Konsolenfehler, keine localhost-Links, interne Prüfvermerke entfernt. Vier Betreiberseiten zeigen bestätigten Namen/Anschrift.
- Tastatur-Fokus und Datenschutz-Inhaltslinks geprüft; alle fünf Trailing-Slash-URLs funktionieren.
- Frische Datenschutz-Browsersitzung: keine eigene Speicherung, keine Drittursprünge.
- Öffentliche Gast-Vorschau: Übersicht, Binder, Sammlung, Portfolio, Einstellungen navigierbar ohne persönliche Daten; relevante Binder/Auth/Scanner-Unit-Smokes bestehen.
- Echte eingeloggte Google-/Admin-/Tester-End-to-End-Abläufe nicht erneut mit Produktivkonten durchgespielt; keine privaten Sammlungsänderungen oder Testlöschungen vorgenommen.
- Startseite, `/app`, `/login`, Logo und Favicon nach Veröffentlichung byte-identisch zur Vorherprobe. Alle 147 bestehenden Hosting-Dateihashes und gepinnter App-Server erhalten.

## K. MANUELLE SCHRITTE VOR GOOGLE PLAY

1. Bestätigten Downloadtoken-Zugriff beheben und zukünftigen privaten Uploadpfad einschließlich berechtigtem Admin-Abruf prüfen; Live-Regelstand kontrolliert mit Android-Kompatibilität abgleichen.
2. Verifizierbare vollständige Löschbearbeitung einschließlich Teilfehlern/Orphans/Contributors fertigstellen und testen; bearbeitbare Anfragen und belastbare Fristen organisatorisch sicherstellen.
3. Konkrete Rechtsgrundlagen, österreichische Informationspflichten, Dienstleisterverträge/Transfergrundlagen, Retention/Backups, SDK-Einwilligungsbedarf und Nutzungsrechte abschließend prüfen. Betreibername/Anschrift sind inzwischen bestätigt und kein fehlender Datenpunkt mehr.

Google Play nicht geöffnet, kein Release angelegt.

## L. ANDROID

**GEÄNDERT: NEIN.** Android-Working-Tree unverändert sauber; HEAD d592de9. Portrait und manueller ScanLab-Workflow bleiben unverändert.

## M. GIT / DEPLOYMENT

- Web-Branch: `main`, bisheriger Commit `d169c9e`; kein neuer Commit/Push in diesem Run. Vorhandene fremde Änderungen erhalten, neue Arbeit bleibt im Working Tree überprüfbar.
- Ausschließlich Firebase Hosting auf bestehender Site `domidex`: finale Version `4a264a93540a65d0`, Release `1788488893237000`.
- Ausgangsversion `32e15e89a65fc4d7`; erste Informationsseitenversion `16c2a7a9e97e184b`. Bestehende Versionen nicht gelöscht.
- 147 bestehende Dateien unverändert; insgesamt fünf Legal-HTML-Dateien ergänzt. Cloud-Run-Rewrite bleibt `domidex-web` / `europe-west1` / `binder-layout-20260904`. Keine Container-Neuveröffentlichung, keine Firebase-/Billing-/Storage-/Auth-Konfiguration geändert.
- Produktionsziele und alle öffentlichen internen Links sind domidex.web.app oder korrekte relative Routen. Keine localhost-Links veröffentlicht. Die lokale Vorschauadresse ist keine Produktionsadresse.
- Generierung `scripts/render-legal-pages.mjs`; gesicherter read-only Deploymentplan `scripts/publish-legal-pages.mjs`; Veröffentlichung nur explizit `--publish`, Folgeänderungen ausschließlich an fünf bekannten Legal-Dateien mit `--update`. Vor Veröffentlichung Abgleich von Live-Version, Hashes, Konfiguration und Artefakten; JSON-Objektschlüsselreihenfolge wird korrekt ignoriert, Rewrite-Reihenfolge bleibt geschützt.
- Lokale Nachweise/Screenshots liegen im ignorierten `.domidex/legal-gate` bzw. `outputs/legal-gate`, nicht auf öffentlichem Hosting.
- Sites-Skillvorgaben wurden für Integration/Prüfung und Bestandsschutz verwendet; der ausdrücklich gewünschte bestehende Firebase-Publikationsweg blieb maßgeblich.

### In diesem Run geänderte bzw. neue Quelldateien

`components/legal-page.tsx`, `components/legal-page.css`, `lib/legal-content.ts`, `app/konto-loeschen/page.tsx`, `app/pre-beta/page.tsx`, `tests/legal.test.tsx`, `tests/legal-hosting.test.ts`, `scripts/render-legal-pages.mjs`, `scripts/preview-legal-pages.mjs`, `scripts/publish-legal-pages.mjs` sowie diese drei Legal-/Deletion-Dokumente. Die drei vorhandenen Legal-Routen verwenden weiterhin die bestehende gemeinsame LegalPage-Komponente.

Danach keine zusätzlichen Arbeiten begonnen. Freigabe für weitere Arbeiten erforderlich.
# Fortschreibung

Der folgende Bericht dokumentiert den ursprünglichen Legal-Lauf. Die anschließend freigegebenen technischen Korrekturen und deren aktueller Status stehen in `PRIVATE_CLOUD_OPERATIONS_2026-09-04.md` und `PRIVACY_RELEASE_RESULT_2026-09-04.md`. Frühere Aussagen zu vorhandenen Downloadtokens/abweichenden Regeln sind ein Vorher-Nachweis.
