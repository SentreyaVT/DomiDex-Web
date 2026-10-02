# Release 27 · Gate 9: Knowledge-Aggregation und identische Scanlast

Stand: 2026-10-01. Lokale Entwicklungsprüfung; keine Bereitstellung, kein Cloudzugriff,
keine echten Nutzer, Bilder, Konten oder Geräte. Baseline-Web-HEAD: `876012b`.
Diese Prüfung ersetzt weder den Scanner-Benchmark noch einen Firestore-/Functions-Lasttest.

## Tatsächlicher Vertrag

Kanonisch ist `backend/scan-knowledge/index.js`, nicht die historische Android-Kopie.
Der echte `aggregateScanKnowledge`-Export wird getestet; nur SDK-Grenzen sind ersetzt.
`current-evidence.js` und `knowledge-aggregate.js` werden direkt als Produktionslogik
ausgeführt, nicht im Test nachgebaut. Der unten beschriebene Reducer-Fix ist enthalten.

- Ein Trigger reagiert auf `users/{uid}/scanEvidence/{fingerprint}`.
- Der Fingerprint muss dem Dokumentpfad entsprechen und 64 kleine Hexzeichen haben.
- Evidence und `accountDeletionLocks/{uid}` werden innerhalb derselben Transaktion gelesen.
  Nur das noch vorhandene, exakt gleiche `updateTime` ohne Löschsperre darf aggregieren.
- Pro Fingerprint teilen sich alle Beiträge ein privates Summary und ein öffentliches Knowledge-Dokument.
- Pro UID/Fingerprint existiert ein privates Contributor-Dokument unter SHA-256 der UID.
  Das ist eine pseudonyme Kontozuordnung, kein Gerätefingerabdruck und kein Nachweis unabhängiger Menschen.
- Ein neuer Beitrag entfernt die bisherige Stimme dieses Kontos und setzt seine aktuelle Stimme.
  Drei übereinstimmende Konten und Vorsprung mindestens zwei ergeben `STABLE`;
  mindestens drei Stimmen mit konkurrierender Identität und Vorsprung höchstens eins ergeben `DISPUTED`.
- Alle übrigen Ergebnisse sind `CANDIDATE`. Öffentliche Knowledge ist ein Hinweis,
  keine garantierte Katalogwahrheit; mehrere Konten derselben Person sind nicht erkannt.

`firestore.rules:66–93` erlaubt eigene Evidence für berechtigte Nutzer mit begrenztem Schema.
`confirmedCardId` wird dort nur als nichtleerer String mit maximal 400 Zeichen geprüft.
Globale Knowledge-Schreibrechte für Clients sind gesperrt (`firestore.rules:378–391`).
Die Rules beweisen keine reale Bestätigungshandlung und keine Existenz der Karte im Katalog.

## Reproduktion und Isolation

```sh
node tests/knowledge-concurrency/run.mjs
```

Der Launcher erlaubt nur nötige Betriebssystemvariablen, entfernt geerbte Credentials/
`NODE_OPTIONS`, setzt einen Netzwerk-Preload und verwendet `envDir: false`.
SDK-App-Initialisierung, Triggerregistrierung und Firestore-Grenzen sind lokal gemockt.
Ein zusätzlicher Netzwerk-Guard lässt selbst abgefangene Netzwerkversuche den Lauf scheitern.
Keine Installation, kein Emulator und keine Projekt-/Produktionsdatenbank sind beteiligt.

`tests/knowledge-concurrency/transaction-double.mjs` ist ein bewusst adversariales,
deterministisches **optimistisches** Versions-/Commit-Modell. Es prüft Read-Sets, atomare Writes,
Konfliktwiederholung und explizite Erschöpfung. Es implementiert **nicht** Firestore-Server-Locks,
SDK-Backoff, Indexkosten, Abrechnung, Eventzustellung oder Functions-Parallelitätsgrenzen.
Alle logischen Reads zählen auch fehlende Dokumente; Queries bleiben null.
Versuchte Writes werden getrennt von tatsächlich im Doppel committeten Writes gemessen.

## Unveränderte Baseline: 21 Tests bestanden

Lokaler Lauf: `outputs/knowledge-concurrency/2026-10-01T03-38-47-743Z-1604.log`
und gleichnamige `.metrics.json`; ignorierte Laufartefakte, keine notwendige Testabhängigkeit.
Vitest meldete 21/21 in 836 ms; 14 strukturierte Messzeilen.

Das Erfolgsmodell erlaubt bewusst 81 Versuche, damit 80 vollständig kollidierende
Beiträge schließlich abgeschlossen werden. Das ist **keine** Produktionskonfiguration.

| Ereignisse | Einzelne Konten: Versuche / Reads / Writes committed | Identische Redelivery: Versuche / Reads / Writes committed |
| ---: | ---: | ---: |
| 10 | 55 / 220 / 30 | 19 / 76 / 3 |
| 40 | 820 / 3.280 / 120 | 79 / 316 / 3 |
| 80 | 3.240 / 12.960 / 240 | 159 / 636 / 3 |

Ergebnis: exakt 10/40/80 unabhängige Kontostimmen; bei Redelivery exakt eine Stimme,
nie `STABLE`. Gleichverteilte widersprüchliche Identitäten bleiben mit korrekten Summen `DISPUTED`.
Für 80 einzelne Konten waren 9.720 Writes **versucht**, aber nur 240 committet.
Diese Zahlen beschreiben den gewählten Testplan, keine abgerechneten Firestore-Operationen.

Lokaler Median/P95 für einzelne Konten: 10 → 5,543/6,195 ms;
40 → 21,883/26,340 ms; 80 → 64,357/82,926 ms.
Höchster gemessener RSS nach einer Matrix war 81.379.328 Bytes, Heap 22.229.824 Bytes.
Das ist der Vitest-Prozess inklusive Fixtures/GC, kein isolierter Handler-Peak oder Cloud-Sizing.

Mit separatem adversarialem Fünf-Versuche-Limit schließen genau fünf Beiträge ab;
5/35/75 von 10/40/80 werden explizit abgelehnt. Bereits committete Stimmen bleiben konsistent.
Das ist ein **Grenzfallbeweis**, keine prognostizierte reale Fehlerquote.

Weitere Baselinefälle:

- 80 vertauschte Versionen derselben Evidence: nur die aktuelle Version zählt; 162 Reads, drei Writes.
- Evidence-Löschung, Ersetzung oder Löschsperre während des Versuchs: Commit wird verworfen,
  Wiederholung prüft erneut; sechs Reads, drei versuchte, null committete Writes.
- 80 sequenzielle neue Zeitstempel desselben Kontos: eine Stimme, aber 320 Reads und 240 Writes.
- Gleiche/zurückgestellte Clientzeit: neue serverseitige Korrektur bleibt ignoriert,
  bis `observedAtClient` den bisherigen Wert überschreitet.
- 32 historische Identitäten bleiben als Keys erhalten, auch mit null Stimmen;
  Identität 33 scheitert atomar mit `too-many-identities-for-fingerprint`.

## Konkrete Risiken und offene Entscheidungen

1. **Hot Document:** Summary und Public-Dokument werden pro angenommenem neuen Beitrag geschrieben.
   UID-Deduplizierung verhindert Mehrfachstimmen, nicht wiederholte Writes neuer identischer Evidence.
   `maxInstances: 10` ist weder ein pro-Fingerprint-Limit noch ein Sharding-/Backpressure-Konzept.
2. **Retries sind zweierlei:** Im installierten Firestore-SDK ist der Transaktionsdefault fünf Versuche
   (`@google-cloud/firestore/build/src/index.js`, `transaction.js`). Der Handler setzt keine Option.
   Das installierte Functions-SDK setzt für nicht gesetztes Event-`retry` den Wert `false`
   (`firebase-functions/lib/v2/providers/firestore.js`). Deploymentzustand wurde nicht abgefragt.
   Endgültig fehlgeschlagene Aggregation kann somit ohne späteres neues Event ausbleiben;
   dieses Audit aktiviert weder Event-Retry noch zusätzliche Instanzen.
3. **Clientuhr und historische Key-Grenze:** Nachgewiesene Baselinegrenzen, noch keine neue Policy.
   Umstellung auf Serverversion oder aktiven Identitätsbestand verlangt gesonderte Migration/
   Semantikprüfung; nicht still als Teil eines Lasttests ändern.
4. **Geerbte Objektnamen:** Baseline-Reducer behandelt `constructor`/`toString` nicht als saubere
   Zähler und kann bei `__proto__` den Prototyp seiner lokalen Map ändern. Kein globales
   `Object.prototype`-Poisoning nachgewiesen. Ungültige Counter/Knowledge bzw. Serialisierungsfehler
   sind möglich; die Baseline-Charakterisierung ist ausdrücklich kein Sicherheits-PASS.
5. **SDK-Serialisierung:** Eine rein lokale Probe des tatsächlich installierten Firestore-Serializers
   erhält eigene `constructor`/`toString`-Keys, verwirft aber eine ausschließlich aus `__proto__`
   bestehende Map (`encodeValue` → `null`). Ein Null-Prototyp allein beseitigt diese SDK-Grenze nicht.
   JSON-Roundtrip ist deshalb ausdrücklich kein Nachweis einer vollständigen Firestore-Persistierung.

## Eng begrenzte lokale Härtung nach Baseline

Nur `backend/scan-knowledge/knowledge-aggregate.js` wurde als Produktdatei geändert.
Interne Countermaps besitzen keinen Prototyp; Ausgabe bleibt eine normale Plain-Object-DTO.
`constructor` und `toString` sind eigene numerische Keys. Nichtnegative sichere Ganzzahlen
werden geprüft, auch bei Inkrement und Gesamtsumme. Kaputte gespeicherte Counter führen
datensparsam zu `invalid-knowledge-counter`, niemals zur erfundenen Reparatur einer Stimme.

Der installierte SDK-Sonderfall `__proto__` wird ausdrücklich mit `unsupported-knowledge-key`
abgelehnt: in neuer Evidence, vorheriger Contributor-Stimme und als eigener Key jeder gespeicherten
Votes-/Corrections-/Identities-Map. Die Aggregation scheitert vor allen drei Writes.
Es gibt kein Key-Encoding, keine Migration und keine Behauptung beliebiger Key-Unterstützung.
Diese kontrollierte Ablehnung behauptet weder eine Bestätigung noch eine gespeicherte globale Zuordnung.

Nachweise:

- Erster gewünschter Reducer-Teststand: 14 RED / 24 PASS insgesamt,
  `outputs/knowledge-concurrency/2026-10-01T03-40-57-683Z-22260.log`.
- Zusätzliche Fail-Closed-Policy für SDK-Sonderfall: 11 RED / 39 PASS,
  `outputs/knowledge-concurrency/2026-10-01T03-42-07-129Z-16024.log`.
- Neuer Testblock: **50/50 PASS**, zwei Dateien, 1,78 s;
  `outputs/knowledge-concurrency/2026-10-01T03-42-20-862Z-16000.log` mit `.metrics.json`.
- Final einschließlich elf vorhandener tatsächlicher Handler-Regressionen: **61/61 PASS**,
  drei Dateien, 2,84 s; `outputs/knowledge-concurrency/2026-10-01T03-42-55-200Z-20948.log`.
  Der dauerhafte Launcher führt diese drei Dateien zusammen aus.
- Zusätzlich drei vorhandene Node-Reducer-Tests bestanden; lokaler Oxlint- und Diff-Check bestanden.
- Direkte Handler-Tests: gültige eigene Namen weiterhin vier Reads/drei Writes;
  kaputte/reservierte Daten vier Reads/null versuchte/null committete Writes, unveränderte gespeicherte Daten.
- Tatsächlicher installierter SDK-Codec bleibt als lokaler Regressionstest enthalten:
  normale Keys numerisch serialisierbar, `__proto__`-Map nicht sicher serialisierbar.
- Unabhängiger Root-Gegenlauf nach Source-Freeze: **61/61 PASS, 1,37 s**;
  `outputs/knowledge-concurrency/2026-10-01T03-43-58-071Z-19496.log`
  und gleichnamige `.metrics.json`. Reducer-/Test-Diff ebenfalls geprüft.

Die 10/40/80-Matrix, normale Stimmwechsel und die 32-Key-Grenze laufen auch nach dem Fix.
Clientzeit, Events/Retryoption, Instanzzahl, Rules und Stimmenpolicy sind unverändert.
Keine Cloud-Veröffentlichung; bestehende Daten wurden weder gelesen noch repariert.

## Ergänzung 02.10.2026: tatsächlicher kanonischer Callback mit lokalem Admin-SDK

Die unten bezeichnete neue Prüfung ergänzt die historischen Doubles; sie ersetzt
deren absichtlich adversariale 10/40/80-Matrix nicht. Zwei zusätzliche Fälle in
`tests/private-operations.test.mjs` importieren den unveränderten kanonischen
`aggregateScanKnowledge`-Export samt eigenem Admin-SDK. Echte Emulator-Snapshots
und echte Transaktionen werden über den Callback verarbeitet. Separate Admin-
Reads vergleichen den vollständigen gespeicherten Graph einschließlich Server-
Zeitstempeln; nicht bloß einen reinen Reducer-Rückgabewert.

- Drei konkurrierende Beiträge ergeben exakt drei Stimmen und `STABLE`.
  Wiederzustellung desselben Ereignisses verändert weder Felder noch Updatezeiten.
- Ein echter alter Evidence-Snapshot und eine aktive synthetische Löschsperre
  verändern keine Aggregate. Nach Entfernung ausschließlich des Testlocks zählt
  dieselbe gültige Version korrekt als 2:1/`DISPUTED`; Wiederholung bleibt ein No-op.
- Alle bisherigen 33 Fälle bleiben erhalten: **35/35 PASS**, 0 Fehler/Skips,
  unveränderte Quellen und freie Ports. Gesamtharness 53,567 s; neue Fälle
  5,860/3,696 s. Beleg:
  `outputs/private-operations-local/2026-10-01T23-47-21-660Z-52ae5b8f/manifest.json`.

Die Umgebung ist fest `demo-domidex-privacy`, mit bereinigtem Environment und
Loopbackschutz. Keine Produktion, kein Deployment, keine Änderung von Handler,
Retrybudget, Instanzzahl, Rules oder Stimmenpolicy. Manuelle Callback-Ausführung
ist **kein** Nachweis einer tatsächlichen Eventarc-Zustellung, ausgelöster SDK-
Retries, Produktionslast oder realer Nutzereinwilligung. Gate 9 bleibt in diesen
Punkten offen.

Für echte Skalierungsentscheidungen bleibt eine kontrollierte Staging-/Emulatormessung mit SDK,
explizitem Zustell-/Retrybudget und Fehlerbeobachtung erforderlich. Kein blindes Sharding oder neues Tracking.
