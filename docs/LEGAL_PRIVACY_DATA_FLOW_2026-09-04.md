# DomiDex Web: technische Datenschutz- und Data-Safety-Grundlage

> Ausgangsinventar des vorherigen Legal-Runs. Der anschließende technische Lauf ersetzt die unten dokumentierten Bildtoken-/Rules-Blocker und ergänzt die Kontolöschung. Aktueller Ablauf: [PRIVATE_CLOUD_OPERATIONS_2026-09-04.md](PRIVATE_CLOUD_OPERATIONS_2026-09-04.md). Konkrete juristische Entscheidungen: [PRIVACY_LEGAL_DECISIONS_2026-09-04.md](PRIVACY_LEGAL_DECISIONS_2026-09-04.md). Historische Live-Ergebnisse unten bleiben als Vorher-Nachweis erhalten.

Stand: 04.09.2026. Keine Rechtsfreigabe und keine ausgefüllte Google-Play-Erklärung.
Android wurde nur lesend als Datenflussreferenz berücksichtigt, nicht verändert.

## Prüfgrundlage

- Web: `lib/firebase-client.ts`, `components/auth-provider.tsx`, `lib/server/firebase-token.ts`, `lib/server/firebase-admin-auth.ts`, `lib/server/firestore-rest.ts`, `lib/server/firebase-storage-rest.ts`, `lib/scanner-report.ts`, `app/api/pretester/scan-reports/route.ts`, `app/api/admin/scan-reports/[reportId]/image/route.ts`, `firestore.rules`, `storage.rules`.
- Android-Handoff: `CardVault/docs/PLAY_DATA_SAFETY_TECHNICAL_2026-09-04.md`; insbesondere manuelle Fotofreigabe, automatische foto-freie Evidence, SDK-Metadaten, Konto-Löschanfrage statt Voll-Löschung.
- Nur lesend geprüfte Android-Pfade: `FirebaseScannerReportUploader`, `SettingsPrivacy`, Sammlung/Tombstones, Knowledge-Worker, `functions/index.js`.
- Live-Firebase-Projekt `cardvault-715ac`, Hosting-Site `domidex`, Cloud Run `europe-west1`. Die Cloud-Run-Region ist keine Aussage über sämtliche Auth-/Log-/Speicherorte.
- Öffentliche Texte enthalten ausschließlich die Projektangaben DomiDex TCG, Österreich (AT) sowie den offiziellen Discord-Kontakt. Frühere personenbezogene Betreiberangaben wurden aus dieser Dokumentation entfernt.

## Technische Data-Safety-Matrix

„Gesammelt“ bezeichnet hier Off-Device-Übertragung. „Drittübertragung: ja“ ist nicht automatisch „geteilt“ im Play-Formular: Dienstleister- und nutzerinitiierte Ausnahmen müssen im konkreten Betreiberverhältnis bestätigt werden. Keine pauschalen Nein-Angaben raten.

| Datenklasse | Gesammelt / Empfänger | Zweck und Optionalität | Speicherung / Verschlüsselung | Löschung und Kontrolle | Play-Weitergabe |
| --- | --- | --- | --- | --- | --- |
| E-Mail, optional Anzeigename, Provider-Verknüpfung | Ja bei Login, Google Identity/Firebase Auth/DomiDex | Konto, optional gegenüber öffentlicher Nutzung | Auth-Konto; HTTPS | Abmelden löscht kein Konto; geprüfte Anfrage | Dienstleister-/Login-Ausnahme prüfen |
| Firebase UID, Auth-Tokens, Rollen | Ja, Firebase/DomiDex | Zugriff und Sync, für Konto erforderlich | Auth/Claims, Browser-Persistenz, UID in Dokumentpfaden/Metadaten; TLS | Token nie in öffentlichen Texten; vollständige Löschung nicht nachgewiesen | Dienstleisterverhältnis prüfen |
| Bestand, Set/Karte, Sprache, Variante, Zustand, Anzahl, Binderzuordnung, Notizen | Ja bei Kontosync, Firestore | Eigene Sammlung; Kontofunktion, nach Freischaltung automatisch | `users/{uid}/collectionEntries`; HTTPS | Einzelentfernung hinterlässt Tombstones einschließlich Feldern; Anfrage für Hard-Delete | Keine öffentliche Sammlung; Dienstleisterausnahme prüfen |
| Kaufpreis/-datum und eigene Wertangaben | Ja wenn eingegeben und synchronisiert | Optionale persönliche Dokumentation, keine Zahlungsabwicklung | Wie Sammlung; Binder/Portfolio davon abgeleitet | Wie Sammlung | Als persönliche Kaufdaten prüfen, nicht mit öffentlichem Marktpreis gleichsetzen |
| ScanLab-Foto, OCR, Kandidaten, Konfidenz, Fehler, Profilversion, Aufnahmeart | Ja nur explizit pro Kameraaufnahme, DomiDex/Firebase | Freiwillige Fehleranalyse für Pretester/Admin | Firestore-Report + privater Storagepfad; HTTPS; tatsächlicher Downloadtoken-Blocker unten | Vorschau + Hochladen, kein Auto-Versand; kein Nutzer-Hard-Delete; Anfrage | Nutzerinitiative/Dienstleisterausnahme prüfen; keine öffentliche Galerie |
| Technische Scan-Evidence, Fingerprint, OCR-Tokens, Kartenbezug | Ja nach bestätigtem Android-Scan-Add, Firestore/Functions | Erkennungsverbesserung; nicht mit freiwilliger Fotoentscheidung gleichsetzen | `users/{uid}/scanEvidence`; anschließend gehashte Beiträge und Aggregate; HTTPS | Kein Rohfoto; UID-Hash nicht anonym; Löschen muss Beiträge und Aggregate berücksichtigen | Gemeinsame abgeleitete Daten gesondert prüfen |
| Separater freiwilliger Katalogbildbeitrag | Ja nach eigener Bestätigung, Storage | Kartenkatalog verbessern, optional | `catalog-contributions/{uid}`; Original-Metadaten können erhalten bleiben; HTTPS | Einzel-Receipt ermöglicht Rückzug, kein Vollkonto-Prozess | Getrennt vom ScanLab bewerten |
| Support-/Löschmail, Inhalt und Absender | Ja bei bewusstem Versand, beteiligte E-Mail-Anbieter/Betreiber | Support/Rechte, optional | Mailbox und mögliche Antwortkorrespondenz; Mailanbietertransport nicht pauschal zugesichert | Öffentliche Seite erzeugt nur Entwurf; Identitätsprüfung/Bearbeitung separat | E-Mail-Anbieter/Empfängerrolle prüfen |
| IP, Browser/Agent, Zeit, aufgerufene URL | Ja an Hosting/Cloud Run; Bildhosts bei externen Bildern | Auslieferung/Betrieb; beim Aufruf erforderlich | Anbieterlogs/HTTP; eigene Onlinepfade HTTPS | Konkrete Log-/Backupfristen noch nicht bestätigt | Keine Besucherstatistik implementiert, aber Anbieterverarbeitung prüfen |
| SDK-Metadaten / Installationskennungen / technische Leistung | Ja im Android-Handoff für ML Kit, Remote Config/Installations, Play-Komponenten; Browser-Firebase-Heartbeat | Technischer Betrieb/SDK-Diagnostik, nicht Werbung | SDK-/Anbieterspeicher; vom Anbieter dokumentiertes HTTPS | Anbieterfristen/-verfahren gesondert; kein Konto-Hard-Delete-Nachweis | SDK-Offenlegung und Dienstleisterausnahmen prüfen |
| GPS, Mikrofon, Kontakte, Werbe-ID | Kein aktiver eigener Erhebungsweg nachgewiesen | Nicht Teil der geprüften Funktionen | Keine solche App-Verarbeitung gefunden | Keine pauschale Aussage „keine Standortdaten“: IP-/Länderzuordnung durch SDKs separat | Kein pauschaler SDK-Ausschluss |
| Exportdateien und lokale Kopien | Lokal bis bewusster Export an gewählten Anbieter | Nutzerkontrolle, optional | Android-Export kann auch Feedbackfotos/OCR enthalten | Nicht durch Cloud-Kontolöschung zurückrufbar | Nutzerinitiierter Export separat bewerten |

### Änderungen gegenüber dem Android-Handoff

1. Öffentlicher, ohne Login erreichbarer Löschanfrage-Einstieg ist jetzt im Web vorbereitet; weiterhin KEIN nachgewiesener vollständiger Cloud-Löschautomat.
2. Browser-Firebase-LOCAL-Persistenz, Heartbeat, mögliche vorzeitige Google-Auth-Verbindungen sowie externe Bildhosts sind zusätzlich erfasst.
3. Live statt nur lokale Regeln geprüft: Live-Regeln unterscheiden sich, insbesondere zusätzliche appAccess-Gates fehlen in einigen eigenen Datenpfaden.
4. Bei 29/29 bestehenden ScanLab-Bildern sind Downloadtokens vorhanden. Eine normale unauthentifizierte GET-Stichprobe ergibt ohne Token 403, mit Token 200. Das ist ein bestätigter Zugriffsschutz-Blocker, kein bloßer Verdacht.
5. Konto-Löschung muss zusätzlich gehashte Contributors, verwaiste Uploads, gemeinsame Aggregate und persönliche Admin-Zuordnungen berücksichtigen.

## ScanLab: exakter Stand

- Nutzeraktion: nicht/eindeutig nicht erkannter Fall → „An ScanLab schicken“ → Vorschau → ausdrückliches Hochladen. Eine ältere Zustimmung aktiviert keinen automatischen Fotoversand; kein Zwei-Fehlversuche-Zwang.
- Admin/Pretester-Claim und Aufnahmeart werden geprüft. Automatische Capture-Fotos und Galerieimporte sind nicht als dieser manuelle Berichtsweg freigegeben. Doppelversand wird abgefangen.
- Android codiert das gesendete Foto neu (keine ursprünglichen EXIF-Metadaten). Der Webendpunkt selbst speichert Bildbytes; keine Behauptung, sämtliche Uploadpfade entfernten Metadaten.
- Bild wird vor Firestore-Dokument gespeichert. Teilfehler können ein verwaistes Bild hinterlassen. Firestore-Report hat keinen eigenen ownerUid; Eigentümerinformation liegt in Storage-Metadaten.
- Admin-Route prüft das Token, den Report und den exakten Bildpfad; Antwort `private, no-store`, `nosniff`; Browser verwendet Blob-URL und widerruft sie.
- Dies allein schützt NICHT vor vorhandenen Firebase-Downloadtokens. Tokenlose Direktanfrage gesperrt, Tokenanfrage jedoch erfolgreich. Keine Tokenwerte, Bild-URLs oder Fotos in diesem Bericht gespeichert.

## Cookies / Speicher / externe Ressourcen

| Technik | Tatsächlicher Einsatz / Zweck | Dauer / Beurteilung |
| --- | --- | --- |
| Fünf statische Informationsseiten | Kein JavaScript, AuthProvider, Formular, Tracking oder eigene Browser-Speicherzugriffe; gleiches Origin-Logo | HTML wird `no-store` ausgeliefert; Hostinglogs bleiben Anbieterdaten |
| Firebase Auth LOCAL | Auf `/app`, `/login`, `/admin`; IndexedDB `firebaseLocalStorageDb`, Fallbacks Local-/SessionStorage | Sitzung bleibt typischerweise bis Abmeldung/Browserbereinigung; keine feste TTL behaupten |
| Redirect-/Sessiondaten | Firebase-Loginablauf | Browser-/SDK-gesteuert; keine eigene feste Aufbewahrungszusage |
| Firebase Heartbeat | `firebase-heartbeat-database`; SDK-Datum/Agent | Implementierung begrenzt auf 30 Tages-Einträge, keine zugesicherte 30-Tage-TTL |
| Auth-Skripte/Frame | Manche Browser laden `apis.google.com` und `/__/auth/iframe` vor Login-Klick | Nicht „Google erst nach Klick“ behaupten; Notwendigkeit/Einwilligung juristisch prüfen |
| Firestore im Web | Kein explizit persistenter Offline-Cache; Speicher-/HTTP-Caches vorhanden | Kein vollständiger Offline-/Löschschutz allein durch Abmelden |
| Karten/Setbilder | Externe HTTPS-Hosts, teils direkte Bild-URL aus Sammlungsdaten; keine globale Host-Allowlist | IP/URL/Browserdaten möglich; externe Speicherdauer unbekannt |
| Fonts/Discord | Fonts lokal; Discord-Link statt Embed | Drittverbindung beim Öffnen des Links |
| Analytics/Ads/Crashlytics | Kein aktiver eigener Web-Analytics-, Ads-, Crashlytics-, Messaging- oder AppCheck-Initialisierungspfad gefunden | SDK-Diagnostik nicht fälschlich ausgeschlossen |
| Unbenutztes `sidebar_state`-Cookie | In einer generischen nicht eingebundenen Komponente definiert | Nicht als aktiv eingesetztes Cookie deklariert |

Kein dekorativer Banner hinzugefügt. Ob alle SDK-Speicherzugriffe und Google-Vorabverbindungen einwilligungsfrei notwendig sind, ist **juristisch zu prüfen**. Kein technisch beobachteter Werbetracker, aber daraus folgt keine allgemeine Einwilligungsfreiheit.

## Tatsächliche Live-Zugriffsprüfung

- Kein `allUsers`-/`allAuthenticatedUsers`-Binding in der gelesenen Bucket-IAM-Policy. Übergeordnete IAM-Policies wurden nicht vollständig auditiert.
- Eigentümer-Isolation und reguläre Admin-Only-Report-/Bildreads bestehen. Keine fremden Sammlungsdaten über normale Rules vorgesehen.
- Firestore live: gegenüber lokal fehlen appAccess/Admin-Zusatzgates für eigene Sammlungen, Evidence und einige Community-/Supportpfade. Report-Erstellung akzeptiert zusätzlich `reviewedBy` ungeprüft.
- Storage live: gegenüber lokal fehlen dieselben Zusatzgates für eigene Nutzer-, Katalog- und Community-Bilder. Die fehlenden Zusatzgates entfernen nicht die Eigentümerprüfung.
- Deshalb lokale bestandene Rules-Tests NICHT als Beleg für exakt diesen Live-Regelstand ausgeben.
- Geprüfte Rulesets: Firestore `0d151966-b235-493e-b79d-9889f7419d36`; Storage `67d554bd-f623-4ee4-b27c-819fd74b3c1c`. Beide unterscheiden sich auch nach BOM-/Whitespace-Normalisierung.
- Keine Rules, Rollen, Bildmetadaten, Downloadtokens oder produktiven Nutzerdaten in diesem Run geändert.

## Aufbewahrung und rechtliche Restpunkte

Keine allgemeine Auto-Löschfrist für Konto, Bestand/Tombstones, Reports/Fotos, Evidence oder abgeleitete persönliche Beiträge im Code nachgewiesen. Keine ungeprüften TTLs oder destruktiven Lifecycle-Jobs eingeführt. Anbieterlogs, Sicherungen, Mailaufbewahrung, Speicherregionen, Auftragsverarbeitungsverträge, internationale Transfers, Rechtsgrundlagen und gesetzliche Informations-/Antwortpflichten sind durch Betreiber und gegebenenfalls rechtliche Beratung zu bestätigen.

Vollständiger öffentlicher Betreibername und Anschrift sind inzwischen ausdrücklich bestätigt und auf allen vier erforderlichen Seiten aufgenommen. Die bisherigen Platzhalter wurden entfernt. Weitere rechtliche Informationspflichten des konkreten österreichischen Betriebs bleiben zu prüfen; keine Unternehmensnummern oder Gesellschaftsform erfunden. Non-Profit ist keine pauschale Ausnahme. Keine abschließende Rechtsfreigabe behauptet.

Auf ausdrücklichen Nutzerwunsch stehen allgemeine interne Rechtsprüfvermerke nur hier und im Abschlussbericht, nicht auf den öffentlichen Seiten. Offen bleiben insbesondere konkrete Rechtsgrundlagen, österreichische Informationspflichten, Empfänger-/Auftragsverarbeitungsverhältnisse, internationale Transfers, Retention/Anfragefristen, Einwilligungsbedarf bei SDK-Speicherung/Vorabkontakten sowie Rechte zur Nutzung von Kartenmotiven. Das Entfernen interner Vermerke bestätigt diese Punkte nicht als geklärt. Tatsächliche technische Grenzen (unvollständiger Löschprozess, Bild-Downloadlinks, Regelabgleich) bleiben öffentlich nachvollziehbar.

## Primärquellen zur manuellen Einordnung

- [Play: Kontolöschanforderungen und Web-Ressource](https://support.google.com/googleplay/android-developer/answer/13327111?hl=de)
- [Play: Data-Safety-Definitionen und Track-Ausnahmen](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Firebase: Datenschutz, Dienste und Standorte](https://firebase.google.com/support/privacy)
- [Firebase: Auth-Persistenz](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Firebase: Android-SDK-Datenhinweise](https://firebase.google.com/docs/android/play-data-disclosure)
- [ML Kit: Android-Datenhinweise](https://developers.google.com/ml-kit/android-data-disclosure)
- [Firebase Storage: Download-URLs](https://firebase.google.com/docs/storage/web/download-files)
- [Europäische Kommission: Betroffenenrechte](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)

Die Quellen erklären Anbieter-/Rechtsrahmen; konkrete App-Datenflüsse wurden aus dem eigenen Code geprüft. Die Matrix ist nicht unmittelbar als fertige Formularantwort einzureichen.
