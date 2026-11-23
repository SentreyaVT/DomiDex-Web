# DomiDex: Kontolöschanfragen – geprüfter Einstieg, kein Voll-Löschautomat

> Historischer Ausgangsstand vor dem freigegebenen technischen Anschlusslauf. Der aktuelle serverseitige Ablauf, Tests und verbliebene Prüfstopps stehen in [PRIVATE_CLOUD_OPERATIONS_2026-09-04.md](PRIVATE_CLOUD_OPERATIONS_2026-09-04.md). Aussagen unten über fehlende Implementierung sind keine Beschreibung des nun veröffentlichten Endpunkts.

Öffentlicher Einstieg: https://domidex.web.app/konto-loeschen
Kontakt: offizielles DomiDex-Discord-Supportticket
Status: **Vollständige Cloud-Löschung technisch nachgewiesen: NEIN.**

## Tatsächlich implementiert

Die öffentliche Seite benötigt weder Firebase-Anmeldung noch appAccess/Admin/Pretester. Der Discord-Link öffnet lediglich den offiziellen Community-Kanal. Die Seite versendet nichts, speichert keine Eingabe und führt keine destruktive Aktion aus. Ein zusätzlicher Account-Delete-Endpunkt wurde nicht geschaffen. Es wurden keine Produktivkonten zu Testzwecken gelöscht.

Das ist ein erreichbarer Anfragemechanismus, keine Zusicherung vollständiger Ausführung. Play lässt Web-Ressourcen mit Anfrageweg zu; tatsächliche Bearbeitung bleibt erforderlich. [Offizielle Anforderung](https://support.google.com/googleplay/android-developer/answer/13327111?hl=de)

## Vor einer echten Löschung: manueller Betreiberprozess

1. Eingang mit Datum, Umfang und Bearbeitungsstatus im zugriffsgeschützten Betreiberprozess erfassen. Personenbezogene Angaben nicht in öffentliche Beiträge kopieren.
2. Identität angemessen bestätigen. Eine im Text genannte E-Mail oder UID allein genügt nicht. Kontakt zum verbundenen Konto prüfen; bei Kontoverlust separates geeignetes Verfahren. Keine Passwörter, Tokens oder Ausweiskopien pauschal anfordern.
3. Vollkonto oder Teilumfang unterscheiden. DomiDex-Konto betrifft Android UND Web, nicht das Google-Konto des Nutzers. Exporte und lokale Kopien erklären.
4. Frist und etwaige gesetzliche Restaufbewahrung tatsächlich prüfen. Keine Frist oder Ausnahme ausdenken; offene Fragen vor Abschluss mitteilen.
5. Privilegiertes, rücksetzbar geprüftes Bestandsinventar nur für die verifizierte Person erstellen. Keine breit gefassten Löschbefehle gegen globale Collections.
6. Erst nach geklärtem, getesteten technischen Ablauf ausführen. Fehlende Möglichkeiten als offen behandeln, nicht als erfolgreich gelöscht bestätigen.
7. Teilfehler und Wiederholungen nachvollziehbar protokollieren; möglichst wenig persönliche Daten im Vorgangsprotokoll. Abschluss erst nach belegter Prüfung aller betroffenen Speicherpfade und der Provider-Restbestände.

Zustände: eingegangen → Identität geprüft → Umfang/Bestände geklärt → Bearbeitung → Teilbereiche offen ODER vollständig verifiziert. Eine gesendete Anfrage ist nicht der letzte Zustand.

## Erforderliches Inventar / konkrete technische Lücke

| Bereich | Warum Auth-Konto löschen allein nicht genügt | Noch erforderlicher Schritt |
| --- | --- | --- |
| Auth-Konto, Providerlink, Claims, Sessions | Vorhandene Webhelfer verwalten Lookup/Claims, nicht Delete. Eigene JWT-Prüfung prüft nicht zusätzlich Revocation/Disabled-Status. | Berechtigtes Backend-Verfahren, frische Identitätsprüfung, Widerruf/Zugriffssperre, Auth-Endlöschung nach vollständiger Verarbeitung |
| `users/{uid}/collectionEntries` | Tombstones behalten Notizen/Kauf-/Kartendaten; Client-Delete verboten | Privilegierter Hard-Delete einschließlich aller Einträge/Tombstones, nach gesichertem Stop von erneuten Writes |
| Binder/Portfolio | Aus Collection-Daten abgeleitet, keine eigenständige Web-Gesamtcollection | Keine globalen Setbinder/Kataloge löschen; individuelle Zuordnungen mit Sammlung behandeln |
| `users/{uid}/scanEvidence` | Eigene Rules verbieten Client-Delete | Privilegiert entfernen; gleichzeitige Trigger/Outbox berücksichtigen |
| `scanKnowledgePrivate/{fingerprint}/contributors/{sha256(uid)}` | UID-Hash bleibt personenbezogen; bestehender Function-Trigger entfernt bei gelöschter Evidence den Contributor nicht | Betroffene Beiträge finden, entfernen und gemeinsame Aggregate konsistent neu berechnen; keine Fremdbeiträge löschen |
| `scanKnowledgePrivate` / `scanKnowledge` | Gemeinsame Aggregate, nicht ausschließlich Kontoeigentum | Nur personenbezogene Beiträge entfernen/reduzieren; anonyme/global fachliche Daten erhalten und Einordnung prüfen |
| `scannerReports` + `scanner-report-images` | Owner fehlt im Report; UID in Bildmetadaten. Upload kann vor Report-Commit liegen | Alle zuordenbaren Bilder inklusive Orphans inventarisieren, Bericht/Bild zusammen behandeln; Downloadtokens widerrufen bzw. Objekt löschen |
| `users/{uid}`-Storage, `catalog-contributions/{uid}` | Einzelne Receipt-Löschung deckt keine historischen Objekte/Kopien ab | Alle verifizierten kontobezogenen Objekte und verwalteten Kopien berücksichtigen |
| Community-/Supportpfade | Rules sehen `submitterUid`/`requesterUid` und Community-Storage vor, auch wenn Web sie aktuell nicht neu erzeugt | Tatsächliche Altbestände prüfen; nicht aus fehlendem UI auf leeren Speicher schließen |
| Scannerprofile, Versionen, Manifest, Audit | `createdBy`, `publishedBy`, `updatedBy`, `actor`, `reviewedBy` können persönliche Admin-IDs enthalten | Persönliche Attribution gezielt prüfen/anonymisieren, ohne Profile/Checksummen/Manifest blind zu zerstören |
| Supportanfragen, Anbieterlogs, Backups, SDK-Kennungen | Nicht vollständig im DomiDex-Auth-Delete enthalten | Anbieterprozesse/Fristen und etwaige begründete Ausnahmen klären und mitteilen |
| Lokale Android-/Browserdaten, Exportkopien | Cloud-Delete löscht sie nicht verlässlich aus der Ferne | Nutzer über lokale Entfernung informieren; keine Remote-Löschzusage |

### Warum kein schneller neuer Delete-Button implementiert wurde

Ein sicherer Voll-Löschlauf braucht eine belastbare Schreibsperre gegen bestehende Android-Outboxes/Functions, privilegierte Löschrechte, verlässliche Eigentümerzuordnung einschließlich Orphans, resumierbare/idempotente Verarbeitung, Reaggregation und überprüfte Endzustände. Ein unvollständiger rekursiver Delete könnte Daten neu entstehen lassen oder gemeinsame Erkennungsdaten anderer Nutzer beschädigen. Das wäre kein kleiner, verantwortbarer Legal-Web-Patch.

## Erforderliche Tests vor einer späteren technischen Freigabe

Nur Emulator/Testkonten: unauthenticated ablehnen; A darf B nicht löschen; frisch bestätigtes A darf eigenen Vorgang anstoßen; Wiederholung ohne Fremdschaden; Teilfehler niemals Erfolg; Outbox/Function erzeugt keine Daten neu; Orphans und Contributors entfernt; Aggregate anderer Nutzer erhalten; Auth abschließend entfernt; keine privilegierten Credentials im Client. Ein reiner Mail- oder UI-Test ersetzt diese Tests nicht.

Für den aktuellen Run getestet: öffentliche Erreichbarkeit, keine Eingabe-/Datenübertragungsfunktion, korrekter Discord-Kontaktweg, keine automatische UID-/Tokenübernahme, keine Fake-Erfolgsanzeige. Tatsächliche Kontolöschung wurde bewusst NICHT ausgeführt.
