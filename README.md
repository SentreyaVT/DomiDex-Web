# DomiDex Web – Entwicklerzugang für Release 27

**Stand: 04.10.2026 · geschlossene Alpha.** Web-App, Website und Backend werden
hier getrennt vom Android-Repository gepflegt.

## Richtiger Branch

**Für die aktuelle Entwicklung
[`codex/release-27-hardening`](https://github.com/nandedomi/DomiDex-Web/tree/codex/release-27-hardening)
auschecken.** Der Quellcode auf `main` ist älter. Diese Startseite ist eine
Dokumentationsübergabe, kein vollständiger Produktcode-Merge.

```sh
git clone --branch codex/release-27-hardening https://github.com/nandedomi/DomiDex-Web.git
```

- [Aktuelles README: Installation, Konfiguration und Testbefehle](https://github.com/nandedomi/DomiDex-Web/blob/codex/release-27-hardening/README.md)
- [Web-Handoff: Deployment, Nachweise und offene Gates](https://github.com/nandedomi/DomiDex-Web/blob/codex/release-27-hardening/docs/WEBAPP_RELEASE_27_HANDOFF.md)
- [Firebase-/Sammlungsvertrag](https://github.com/nandedomi/DomiDex-Web/blob/codex/release-27-hardening/docs/FIREBASE_COLLECTION_CONTRACT.md)
- [API-Vertrag](https://github.com/nandedomi/DomiDex-Web/blob/codex/release-27-hardening/docs/openapi.release27.yaml)
- [Android-Entwicklerübergabe](https://github.com/nandedomi/DomiDex/blob/codex/release-27-hardening/docs/DEVELOPER_HANDOFF_R27.md)
- [Unverändertes Android-R27-Binärarchiv](https://github.com/nandedomi/DomiDex/releases/tag/archive/v27-1.0-closed-alpha.6)

## Aktueller Betrieb und Nachweisgrenzen

Web/Backend wurden am04.10.2026 um21:47:30 Europe/Berlin veröffentlicht:
Firebase Hosting `334fdfd6961039a1`, Cloud Run `domidex-web-r27-20261004d`.
Der aktuelle Betrieb ist **Firebase Hosting + Cloud Run**, nicht die alte
OpenAI-Sites-Hosting-Angabe. Kanonische Functions-Quelle: `backend/scan-knowledge`
im Engineeringbranch; nicht ungeprüft aus dem Android-Repo deployen.

Zuletzt dokumentiert:1.299 bestandene lokale Tests in79 Dateien und bestandener
Typecheck. Danach wurde am04.10. um22:32 ein echter Live-Scroll-Crash in der
Web-Sammlung (React185) nachgewiesen. Er ist noch nicht behoben; die vorhandene
Regression deckte variable Kartenhöhen im virtuellen Fenster nicht ab.
Zwei nicht auflösbare private Binder-Verknüpfungen und weitere Entzugs-/Betriebs-
Nachweise bleiben offen. Daher **keine pauschale Gesamtfreigabe**.

Full-Sync bleibt R27, Delta deaktiviert. App Check und Write-Limiter nicht ohne
eigene Konfigurationsprüfung/Freigabe aktivieren. Keine private `.env`,
Service-Account-Datei, Benutzerbilder oder Tokens in Git übernehmen.
Diese GitHub-Dokumentationsänderung deployt nichts und ändert keine Firebase-Rechte.
Ältere Dokumente auf `main` sind historisch; maßgeblich sind die verlinkten
R27-Engineeringdokumente.
