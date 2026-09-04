# Ergebnis: technischer DomiDex-Privacy-Anschlusslauf

## A. Private Images

LIVE auf `https://domidex.web.app`: unangemeldet 401; normaler freigeschalteter Nutzer 403; Pretester 403; aktueller Admin 200 mit geprüften unveränderten Bildbytes. Neuer manueller Upload 201, dauerhafte Downloadtokens fehlen.

29 bestehende Bildobjekte ausschließlich an Metadaten geändert. 29 alte tokenbasierte Links danach abgewiesen. Generation, MD5, Größe und sonstige Metadaten blieben erhalten. Direkte Firebase-Metadatenanfragen werden für alle Clientrollen einschließlich Admin verweigert, um Token-Neuerzeugung zu verhindern. Alle vorhandenen aktiven Reportbilder anschließend tokenfrei.

Isolierte Live-Testkonten und ihre synthetischen Reportbilder wurden jeweils entfernt. Keine echten Nutzer oder produktiven Fotos gelöscht. Soft-gelöschte synthetische Testbilder unterliegen der vorhandenen siebentägigen Bucket-Retention; sie erscheinen nicht im Scanner Lab. Keine Tokens oder privaten Bildlinks im Repository.

## B. Rules

Gewünschte lokale und produktive Quellen identisch, nach Deployment erneut geprüft:

- Firestore: `2f49b84f-88ba-4705-acbd-59783e365f9c`, SHA-256 `2920028f3a350e7db2caba9b70ef94351ea7782b6a64060aa9bff3aa35571fa7`.
- Storage: `d9116701-eadc-43f3-a94e-8265cdbcba7f`, SHA-256 `239da8852095a16b1e5eb7e71c6223de75cbcf84bc8e62ab68ee7068c9acea2e`.

Vorher-Nachher-Diff wurde vor Veröffentlichung geprüft. Owner-Isolation bleibt bestehen; vorhandene appAccess-Gates nun ebenfalls produktiv. Das begrenzte optionale Legacy-`githubUrl`-Feld bleibt aus Kompatibilitätsgründen für den bestehenden Editor zulässig. Clientseitige Report-Erstellung wird durch serverseitige validierte Erstellung ersetzt, nicht öffentlich freigegeben. Regeln für Löschjobs/-sperren bleiben für Clients deny-by-default.

## C. Account Deletion

End-to-end mit echten Firebase-Auth-/Firestore-/Storage-Emulatoren nachgewiesen: eigener Löschstart, Auth-Endlöschung, rekursive eigene Unterdaten einschließlich Tombstones/Kauf-/Binderzustand, Evidence/Contributors mit Reaggregation, Reports und private Bilder, Support-/Communitydaten, Erhalt fremder Nutzer/Varianten und globaler Karten-/Set-/Profil-/Manifestdaten. Anonym und User A gegen B werden abgewiesen. Teilfehler, Wiederholung, spätes Disable/Revoke, alte Soft-Deletes und fehlgeschlagene Job-Endbereinigung geprüft. Kein falsches COMPLETE.

LIVE zusätzlich: Anonyme Löschanfrage verweigert, normaler Nutzer kann anderen isolierten Testnutzer nicht löschen, Bestätigungsschranke aktiv. Keine produktiven Konten durch diesen Endpunkt gelöscht.

**Keine universelle Cloud-Komplettlöschung für jeden Sonderfall behauptet.** Geschützte persönliche Profil-Attribution (`PROTECTED_SCANNER_ATTRIBUTION`) sowie unklare Legacy-Eigentümer führen vor Löschbeginn zum Prüfstop. Bei Anbieter-Restbeständen bleibt der Status offen; die tatsächliche siebentägige physische GCS-Endlöschung wurde nicht durch Abwarten in Produktion nachgewiesen. Mailbox, Anbieterlogs/weitere Sicherungen und lokale Exporte sind separate Datenflüsse.

## D. Website

- https://domidex.web.app/datenschutz – 200; aktueller privater Bildzugriff, Rules-Gates und Löschprozess.
- https://domidex.web.app/konto-loeschen – 200, ohne Login; Mailanfrage, Identitätsprüfung, serverseitige Bearbeitung, Warte-/Restzustände und Grenzen.
- Startseite, `/app`, `/kontakt`, `/impressum` ebenfalls 200.
- Keine localhost-Links oder internen Rechtsprüfdisclaimer auf den geprüften öffentlichen Infoseiten. Kein JavaScript/Tracking/Formularversand auf diesen statischen Seiten.
- Von 152 Hosting-Dateien änderten sich am Ende ausschließlich `/legal/datenschutz.html` und `/legal/konto-loeschen.html`; alle anderen Dateihashes identisch. Einziger sonstiger Hosting-Konfigurationsunterschied: geprüfte Serverrevision. Vorhandenes Design gemäß Sites-Erhaltungsvorgaben unverändert.

## E. Juristische Restfragen

Konkrete Zweck-/Daten-/Dienst-/Optionalitäts-/Speicher-/Fragenmatrix für jeden Datenfluss: [PRIVACY_LEGAL_DECISIONS_2026-09-04.md](PRIVACY_LEGAL_DECISIONS_2026-09-04.md). Keine Rechtsgrundlagen, gesetzliche Retention, Einwilligungsfreiheit oder Dienstleisterverhältnisse erfunden. Insbesondere Hintergrund-Evidence nicht mit freiwilligem Fotoupload gleichgesetzt.

## F. Google-Play-Web-Readiness

Bildtoken-Sicherheitsblocker und Rules-Abweichung geschlossen. Standard-Kontolöschpfad implementiert und isoliert geprüft. **Keine uneingeschränkte Gesamtfreigabe:** Die Behandlung persönlicher Integritäts-/Profil-Attribution und unklarer Altzuordnungen benötigt eine konkrete Entscheidung und gegebenenfalls einen gesonderten eng begrenzten Bereinigungsschritt. Anbieter-/Mail-/Backup-Restbestände sind nicht durch den App-Löschtest mitverifiziert. Kein Google-Play-Publishing ausgeführt.

## G. Tests

- Typecheck erfolgreich.
- 60 vorhandene Domain-/Scanner-/Binder-/Auth-/Navigations-Unit-Tests erfolgreich.
- 13 Legal-/Hosting-Tests und ein zusätzlicher Compiled-Route-Regressionstest erfolgreich.
- 21 Privacy-/Auth-/Firestore-/Storage-Emulatortests erfolgreich (inkl. sieben Firestore- und vier Storage-Rules-Fällen).
- Sechs Android-Vertragsprüfungen gegen Web-Regeln erfolgreich; Android-Dateien nicht verändert.
- Drei unveränderte Knowledge-Aggregationstests plus transaktionaler Stale-/Delete-/Fence-Test erfolgreich.
- Relevante Lintprüfung und Production Build erfolgreich. Vorhandene Tool-/Chunkgrößenwarnungen, keine Buildfehler. Firebase meldet unbenutzte alte Validator-Hilfsfunktionen als Warnungen; Rules kompilieren und Live-Prüfung besteht.
- Live-Tests wie A/B/C/D. Secrets-/Dateiprüfung vor Commit ohne Befund; lokale Konfiguration, Testzustände und Abhängigkeiten ausgeschlossen.

## H. Git / Deployment / Sicherheit

Cloud Run `domidex-web-00027-tew`, über Hosting-Tag `privacy-gate-20260904`. Hosting-Version `bb86cc960afb9e98`, Release `1788492697247000`. Evidence-Function `aggregateScanKnowledge` ACTIVE, aktualisiert 2026-09-04 03:16:51 UTC. Die zusätzliche Function-Prüfung verhindert das Wiederanlegen gelöschter Beiträge durch verspätete Events.

Die ausdrücklich genehmigte temporäre IAM-Signierberechtigung war auf `iam.serviceAccounts.signBlob` und eine Stunde begrenzt; Binding und temporäre Rolle wurden nach Live-Tests entfernt. Keine dauerhafte Rechteerweiterung.

Sicherheitshinweis: Bei einer frühen Konfigurationsdiagnose wurde versehentlich ein interner Firebase-Passwort-Hash-Konfigurationswert in der Werkzeugausgabe angezeigt. Er wurde nicht in Projektdateien, Website, Berichte oder Git übernommen und wird nicht erneut wiedergegeben. Eine Sicherheitsbewertung dieses Chat-/Diagnosezugriffs bleibt als separater Betreiberpunkt festgehalten; es wird keine automatische Schlüsselrotation behauptet.

Vorher bereits vorhandene, nicht committete Web-Korrekturen werden unverändert mitgesichert; keine Rücknahme bestehender Arbeiten. Keine neuen GitHub-Releases, keine Google-Play-Veröffentlichung.

**ANDROID GEÄNDERT: NEIN.** Arbeitsbaum des Android-Projekts weiterhin sauber.
