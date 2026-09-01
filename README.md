# DomiDex TCG Web

Offizielle Webplattform und Desktop-Sammlungsoberfläche für DomiDex TCG. Die Web-App nutzt dieselbe Firebase-Authentifizierung und denselben privaten Sammlungsbestand wie die Android-App, ohne deren Quellcode oder Datenmodell zu verändern.

## Enthalten

- öffentliche DomiDex-Website mit Funktionen, Updates, Roadmap, FAQ und Rechtsseiten
- Google-Anmeldung über Firebase Authentication
- Desktop-Sammlung mit Binderansicht, Kartensuche, Varianten und Portfolio
- exakte TCGdex-/Cardmarket-Zuordnung; keine erfundenen Preise
- Echtzeit-Synchronisierung mit `users/{uid}/collectionEntries/{syncId}`
- geschützter Adminbereich für öffentliche Website-Inhalte
- Firestore-Regeln mit strikter Benutzertrennung und `admin`-Custom-Claim

## Lokal starten

Voraussetzungen: Node.js 22.13 oder neuer sowie Java (für die Firestore-Emulatortests).

```bash
npm install
copy .env.example .env.local
npm run dev
```

Die öffentlichen Firebase-Webwerte der registrierten Web-App kommen in `.env.local`. Private Schlüssel, Service-Account-Dateien und Tokens dürfen nicht in das Repository eingecheckt werden.

## Qualitätsprüfung

```bash
npm run typecheck
npm run lint
npm test
npm run test:rules
npm run test:android-contract
npm run build
```

`test:android-contract` führt die aus dem Android-Projekt übernommenen Vertragsprüfungen gegen die erweiterten Web-Regeln aus. Damit bleibt der bestehende Mobile-Sync kompatibel.

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

Der Adminbereich kann nur öffentliche Website-Inhalte bearbeiten. Private Sammlungen anderer Nutzer sind weder in der UI noch über die Regeln zugänglich.

## Umgebungsvariablen

Siehe `.env.example`. `NEXT_PUBLIC_*` enthält ausschließlich öffentliche Client-Konfiguration. `DOMIDEX_ADMIN_UID` und `GOOGLE_APPLICATION_CREDENTIALS` sind lokal/private und werden nie an den Browser ausgeliefert.

## Deployment

Vor dem öffentlichen Einsatz:

1. Firestore-Regeln aus `firestore.rules` deployen.
2. Die endgültige Hosting-Domain als autorisierte Domain in Firebase Authentication eintragen.
3. `NEXT_PUBLIC_SITE_URL` auf die kanonische HTTPS-Adresse setzen.
4. Impressum, Datenschutz und Kontakt mit den vollständigen Betreiberangaben vervollständigen.
5. Optional Discord- und Kickstarter-URLs setzen; ohne Kickstarter-URL zeigt die Seite korrekt „Coming Soon“.

Das Hosting erfolgt mit OpenAI Sites. Eine spätere eigene Domain (inklusive `www`-Weiterleitung) kann ohne Änderung der Anwendung verbunden werden.

## Repository-Sicherheit

Das Projekt ignoriert `.env*` (außer `.env.example`), private Schlüssel, Build-Artefakte, Emulatorlogs und lokale Deploymentdaten. Vor jedem Push sollten `git status` und die gestagten Dateien auf Zugangsdaten geprüft werden.
