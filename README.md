# DomiDex Web

Offizielle Webplattform und Desktop-Sammlungsoberfläche für DomiDex. Die Web-App nutzt dieselbe Firebase-Authentifizierung und gemeinsam definierte Datenverträge für den privaten Sammlungsbestand wie die Android-App; ihr Quellcode liegt in einem separaten Repository.

**Geschlossene Alpha – Entwicklerübergabe vom 04.10.2026:** Umgesetzte Änderungen,
Nachweise und offene Grenzen stehen im [Web-Handoff](docs/WEBAPP_RELEASE_27_HANDOFF.md).
Web und Backend sind veröffentlicht; das bedeutet ausdrücklich **nicht, dass alle
Release-27-Gates bestanden sind**.

## Welchen Stand übernehmen?

Der veröffentlichte Grid-Hotfix wurde aus dem eingefrorenen Engineeringstand
`39742dd9a3aba5eacf7126d4c7248c295cc0a661` auf **`codex/release-27-hardening`**
im Repository `nandedomi/DomiDex-Web` gebaut. Dies bezeichnet die Buildquelle,
nicht automatisch den jeweils neuesten Remote- oder Dokumentationsstand.
Der Defaultbranch `main` ist nicht dieser Produktstand: PR1 aktualisiert dort
nur den Entwickler-Wegweiser (`eb75501`, vorher `d169c9e`). Für die Übergabe daher ausdrücklich:

```bash
git clone --branch codex/release-27-hardening https://github.com/nandedomi/DomiDex-Web.git
cd DomiDex-Web
```

Im bisherigen Engineering-Checkout heißt der Remote `github`; ein neuer Clone
nennt ihn standardmäßig `origin`. GitHub-Quellbackup, Defaultbranch-Merge,
GitHub Release und Deployment sind getrennte Aktionen. Dieser Einstieg beschreibt
den geprüften Stand, keine automatische Veröffentlichung beim lokalen Setup.

Der am 04.10.2026 um **23:42:33 Europe/Berlin** veröffentlichte und anschließend
geprüfte Live-Stand unter `https://domidex.web.app`:

- Firebase Hosting: `5719d197695f2e1c`
- Image-Tag: `r27-20261004e`; Cloud-Run-Revision: `domidex-web-r27-20261004e`
- Image-Digest: `sha256:eda5084e7d99600b282c6e3580c000aeec7017f5321792d381d094bda7015f8b`

Enthalten sind die reproduzierten Deploymentkorrekturen: Docker-Builder unter
`/srv/domidex` statt `/app`, damit Rootlayout und verschachtelte App-Routen nicht
zusammenfallen; die Runtime bleibt `/app`. Die bestehenden Sicherheitsheader
werden zusätzlich mit einem expliziten `/`-Matcher auf der Startseite angewendet.
Der verworfene GlobalStyles-Brückenversuch ist nicht enthalten. Clientassets und
Server stammen aus demselben geprüften Image; Details und Belegpfade im Handoff.
Gegenüber dem vorigen Deployment änderte sich unter 309 Produktionsquellen nur
`components/windowed-collection-grid.tsx`. Kandidat und Live bestanden jeweils
45/45 Smokeprüfungen. Runtime-Konfiguration, IAM und prozentuale Default-Traffic-
Zuweisung blieben unverändert; Hosting verwendet den neuen Revisions-Pin.
Rules und Functions wurden beim Hotfix nicht verändert.

## Bekannte Grenzen und nächster Debugging-Einstieg

- **React185-Hotfix veröffentlicht:** Der Livefehler vom 04.10. um 22:32 wurde lokal
  reproduziert, korrigiert und um 23:42 veröffentlicht. Variierende Kachelhöhen,
  Zielfenster-Nachbarn und wiederholte Tastaturaktionen sind lokal abgesichert.
  Die angemeldete Livekontrolle beobachtete bei 348 eindeutigen Einträgen/351 Kopien
  End/Home auf 1280×720 und 390×844, Ziel 347 sichtbar, keine Überlappung und bisher
  keine Browserfehler. Die Browser-Receipt und Screenshots liegen im Android-Checkout
  unter `artifacts/r27-grid-hotfix-20261004/`; das ist keine allgemeine
  Crash-Freiheitsgarantie und widerlegt nicht den alten Fehler.
- Private Binderpositionen **6/7** zeigten bereits vor dem Deployment nicht
  verfügbare Eintragsreferenzen. Die genaue Ursache bleibt offen; das ist kein
  belegter Bild-404 und darf nicht durch geratenes Umhängen von Karten behoben werden.
- R27 behält **Full-Sync**; **Delta bleibt deaktiviert**. Lokale Tests garantieren
  weder sofortige Synchronisierung noch vollständige Hardware-/Mehrgeräte-,
  Last-, Betriebs- oder Datenschutzabnahme.
- **Legacy-Löschzustand bleibt offen:** Ein neuer echter lokaler SDK-Fall ohne
  Access-Fence bleibt nach unveränderten 30s RED, obwohl alle drei Servermutationen
  bestätigt wurden. Lokale Daten blieben erhalten; der ursprüngliche 17/18-Lock-only-
  RED ist separat unverändert. Der Web-Gridfix löst diese Android-/SDK-Grenze nicht.
- Android-AAB, R8-Mapping und native Symbole gehören zum separaten `CardVault`-
  Repository/Releasearchiv. Die sechs fehlenden Original-Vendorsymbole sind kein
  Web-Artefakt und werden durch diese Übergabe nicht nachgeliefert.

Zuletzt bestanden Typecheck und die isolierte Web-Regression mit
**1.306/1.306 Tests in 79 Dateien**, ohne Fehler/Skips
(`outputs/release-local/2026-10-04T21-13-27-372Z-23092.{json,log}`).
React-act-/JSDOM-Canvas-Warnungen bleiben sichtbar. Scoped Lint ist kein pauschales
Whole-Workspace-PASS: experimentelles `backend/market-data` wurde weder deployed
noch in diesen GitHub-Stand aufgenommen. Die drei zusätzlichen Operatorfälle sind
nun Teil der **39/39** bestandenen lokalen Private-Operations-Tests; der frühere
36er-Nachweis wird dadurch nicht rückwirkend erweitert. Die minifizierte
[Browserfixture](tests/collection-grid-browser/README.md) prüft den Sammlung-Fix
mit künstlichen Daten und ersetzt keine Live-/Firebase-Abnahme.

## Enthalten

- öffentliche DomiDex-Website mit Funktionen, Updates, Roadmap, FAQ und Rechtsseiten
- Google-Anmeldung über Firebase Authentication
- Desktop-Sammlung mit Binderansicht, Kartensuche, Varianten und Portfolio
- exakte TCGdex-/Cardmarket-Zuordnung; keine erfundenen Preise
- Live-Listener für `users/{uid}/collectionEntries/{syncId}`; keine garantierte Null-Latenz oder pauschale Sofort-Synchronisierung aller Binder-/Offline-Daten
- geschützter Adminbereich für öffentliche Website-Inhalte
- geschütztes Scanner Control Center unter `/admin/scanner-lab` mit normalisierten Analysezonen, Profilversionen, explizitem Production-Publish und Rollback
- lokaler, paginierter Referenzbrowser für das deutsche TCGdex-Kalibrierungsarchiv; Bilder und absolute Pfade werden nicht veröffentlicht
- Master-Set-Binder mit allen Set-Karten, Besitzstatus, exakter Preiszuordnung und direktem Hinzufügen zur bestehenden Sammlung
- Firestore-Regeln mit strikter Benutzertrennung und `admin`-Custom-Claim

## Lokal starten

Voraussetzung für die Web-App laut `package.json`: Node.js 22.13 oder neuer.
Die getrennten Emulator-Harnesses haben zusätzliche Werkzeug-/Versionsprüfungen;
der [Private-Operations-Starter](tests/private-operations-local/README.md) verlangt
beispielsweise Node 24+, Java 21+ und bereits vorhandene passende Emulatoren.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Unter POSIX-Shells statt `Copy-Item` entsprechend `cp` verwenden. Die öffentlichen
Firebase-Webwerte der registrierten Web-App kommen in `.env.local`. Nur eine
ausdrücklich autorisierte Firebase-Umgebung konfigurieren: Ein Entwicklungsserver
ist nicht automatisch ein Emulator. Private Schlüssel, Service-Account-Dateien
und Tokens dürfen nicht in das Repository eingecheckt werden.

### Lokales Scanner-Referenzarchiv

Für das Scanner Control Center werden die privaten lokalen Quellen ausschließlich serverseitig konfiguriert:

```env
DOMIDEX_SCANNER_REFERENCE_DIR=
DOMIDEX_TCGDEX_DB_PATH=
# Optional; Standard: .domidex/scanner/master-index.json
DOMIDEX_SCANNER_MASTER_INDEX_PATH=
```

Danach erzeugt `npm run scanner:index` den lokalen Master-Index unter `.domidex/`. Der Generator erhält `localId` vollständig als String, verbindet Bild- und Kartendaten und meldet fehlende Dateien, Metadaten, Duplikate und Einzelfehler. `.domidex/`, die Referenzbilder und die lokalen Pfade bleiben vom Repository und Deployment ausgeschlossen.

## Qualitätsprüfung

```bash
npm ci --prefix backend/scan-knowledge
npm run typecheck
npm run test:release-local
```

Die verschachtelten, gelockten Functions-Abhängigkeiten werden für die
Trigger-Vertragstests benötigt. `test:release-local` verwendet die festgelegte
Testauswahl einschließlich ergänzender Suites; `npm test` allein ist nicht dieser
vollständige 79-Dateien-Nachweis. Auswahl, Isolation und Grenzen stehen im
[lokalen Test-README](tests/release-local/README.md).

Weitere Prüfungen sind separat und mit ihren jeweiligen Voraussetzungen auszuführen:

```bash
npm run lint
npm run test:rules
npm run test:android-contract
npm run build
```

`test:android-contract` führt die aus dem Android-Projekt übernommenen Vertragsprüfungen gegen die erweiterten Web-Regeln aus. Das prüft konkrete Vertragsfälle, ersetzt aber keinen vollständigen Android-/Web-/Zwei-Geräte-Endtest. Für die isolierte lokale Release-Regression ohne private `.env`-Werte und externe Netzwerkzugriffe steht `npm run test:release-local` zur Verfügung; Umfang und weitere Emulatorprüfungen stehen im Handoff.

## Firebase-Vertrag

Der vollständige Feld- und Sicherheitsvertrag steht in [docs/FIREBASE_COLLECTION_CONTRACT.md](docs/FIREBASE_COLLECTION_CONTRACT.md). Wichtige Grundsätze:

- Jeder Benutzer liest und schreibt ausschließlich unter seiner eigenen UID.
- Änderungen erhöhen `revision` exakt um eins und verwenden `serverTimestamp()`.
- Löschen erfolgt als Tombstone; physisches Löschen und Wiederherstellen sind gesperrt.
- `sourceSetId` und `sourceCardId` bilden zusammen die stabile Kartenidentität.
- Ein Preis wird nur bei eindeutiger Variante und real vorhandener Cardmarket-Zuordnung verwendet.

## Adminzugriff einmalig aktivieren

1. Der Eigentümer meldet sich mindestens einmal über `/login` an.
2. Die Firebase-UID wird lokal als `DOMIDEX_ADMIN_UID` gesetzt.
3. Für die Admin-SDK-Anmeldung werden Application Default Credentials oder ein ausschließlich lokal gespeicherter Service Account verwendet.
4. `npm run admin:bootstrap` setzt den Custom Claim `admin: true`.
5. Ab- und erneut anmelden, damit ein frisches ID-Token geladen wird.

Der Adminbereich verwaltet öffentliche Website-Inhalte und Scannerprofile. Private Sammlungen anderer Nutzer sind weder in der UI noch über die Regeln zugänglich. Scannerprofile werden als Draft, Testing, Candidate, Production oder Deprecated versioniert; normales Speichern veröffentlicht niemals eine Production-Version.

## Umgebungsvariablen

Siehe `.env.example`. `NEXT_PUBLIC_*` enthält ausschließlich öffentliche Client-Konfiguration. `DOMIDEX_ADMIN_UID` und `GOOGLE_APPLICATION_CREDENTIALS` sind lokal/private und werden nie an den Browser ausgeliefert.

Die serverseitigen Schalter sind keine pauschale Freigabe: App Check
(`DOMIDEX_APP_CHECK_MODE`) ist standardmäßig `off`, der Write-Limiter
(`DOMIDEX_WRITE_RATE_LIMIT_MODE`) standardmäßig `monitor`. Der separate Read-Zähler
für den Sync-Zeitanker ist davon unabhängig und durchgesetzt. Sharing und
Kontolöschung benötigen ihre expliziten serverseitigen Readiness-Schalter; lokale
Defaults nicht mit der geprüften Livekonfiguration gleichsetzen. Keine Flags zur
Umgehung eines fehlgeschlagenen Nachweises aktivieren; Verträge stehen im Handoff.

## Deployment

Der oben bezeichnete Stand ist bereits live. Für spätere Veröffentlichungen sind
Konfiguration, Berechtigung und Freigabe erneut zu prüfen, insbesondere:

1. Firestore-Regeln aus `firestore.rules` deployen.
2. Die endgültige Hosting-Domain als autorisierte Domain in Firebase Authentication eintragen.
3. `NEXT_PUBLIC_SITE_URL` auf die kanonische HTTPS-Adresse setzen.
4. Impressum, Datenschutz und Kontakt mit den vollständigen Betreiberangaben vervollständigen.
5. Optional Discord- und Kickstarter-URLs setzen; ohne Kickstarter-URL zeigt die Seite korrekt „Coming Soon“.

Das vorhandene `firebase.json` konfiguriert Firebase Hosting (`domidex`,
`dist/client`) mit Weiterleitung an den Cloud-Run-Dienst `domidex-web` in
`europe-west1`; die Functions-Quelle ist `backend/scan-knowledge`. Die vorhandene
OpenAI-Sites-/Cloudflare-Buildintegration ersetzt diesen Deploymentvertrag nicht.
Die Live-Angaben oben sind ein datierter Nachweis, kein fortlaufender Monitor.
Regeln, Serverpaket und Hosting müssen gemeinsam geprüft werden; jede weitere
Veröffentlichung braucht ein separates Go. `npm run build` baut lokal mit
Legal-Preflight. `npm start` startet den Wrangler-Pfad, nicht den Cloud-Run-Dienst.
`npm run firebase:prepare` erzeugt die bereinigte öffentliche Build-Konfiguration
und das Firebase-Serverpaket; `npm run firebase:start` startet dessen lokalen
Standalone-Server. Keiner dieser Befehle ersetzt die freigegebene Deployment-
und Smokecheck-Sequenz oder eine vollständige Releaseabnahme.

## Repository-Sicherheit

Das Projekt ignoriert `.env*` (außer `.env.example`), private Schlüssel, Build-Artefakte, Emulatorlogs und lokale Deploymentdaten. Vor jedem Push sollten `git status` und die gestagten Dateien auf Zugangsdaten geprüft werden.
