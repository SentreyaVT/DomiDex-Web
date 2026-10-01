'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useSiteContent } from '@/lib/site-content';

export function PublicPage({ type }: { type: 'updates' | 'roadmap' | 'faq' }) {
  const { content } = useSiteContent();
  return <main className="public-page">
    <header><a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></a><a href="/"><ArrowLeft /> Startseite</a></header>
    <section className="public-hero"><p>{type === 'updates' ? 'ENTWICKLUNGSSTAND' : type === 'roadmap' ? 'AUSBLICK' : 'HILFE'}</p><h1>{type === 'updates' ? 'DomiDex Updates' : type === 'roadmap' ? 'Roadmap' : 'Häufige Fragen'}</h1><span>{type === 'updates' ? 'Nur tatsächlich veröffentlichte und verifizierte Änderungen.' : type === 'roadmap' ? 'Ohne erfundene Termine oder feste Zusagen für experimentelle Ideen.' : 'Klar und ohne Kleingedrucktes.'}</span></section>
    {type === 'updates' && <section className="public-list">{content.updates.filter((item) => item.active).map((item) => <article key={item.id}><div><span>{item.version}{item.build ? ` · Build ${item.build}` : ''}</span><time>{item.date}</time></div><h2>{item.title}</h2><p>{item.summary}</p><p>{item.details}</p>{item.linkUrl && <a href={item.linkUrl}>Mehr erfahren <ExternalLink /></a>}</article>)}</section>}
    {type === 'roadmap' && <section className="public-list roadmap-list">{content.roadmap.slice().sort((a, b) => a.order - b.order).map((item) => <article key={item.id}><span className={`roadmap-status ${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</section>}
    {type === 'faq' && <section className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>}
  </main>;
}

const faqs = [
  ['Ist DomiDex bereits fertig?', 'Nein. DomiDex befindet sich in der geschlossenen Alpha. Freigeschaltete Tester können Android-App und Web-App nutzen. Fehler, fehlende Kartendaten und unvollständige Preise sind weiterhin möglich.'],
  ['Wie werde ich Tester?', 'Tritt der DomiDex-Community über https://discord.gg/fc9XgwtVTE bei und öffne ein privates Tester-Ticket. Dort liest und bestätigst du die Testervereinbarung. Deine Google-E-Mail wird privat für die Freischaltung benötigt. Der Serverbeitritt allein ist noch keine Testerfreigabe.'],
  ['Wie installiere ich die Android-Testversion?', 'Nach der Freigabe erhältst du den Tester-Link im bestehenden privaten Prozess. Bestätige die Testteilnahme und nutze im Play Store genau das freigeschaltete Google-Konto. Der interne Google-Play-Test ist kein öffentlicher App-Release.'],
  ['Brauche ich ein Abonnement?', 'Nein. DomiDex wird derzeit privat und non-profit entwickelt. Es gibt keine Werbung oder Abonnements; ein späterer Veröffentlichungspreis ist noch nicht festgelegt.'],
  ['Kann die Website Karten scannen?', 'Nein. Der Scanner bleibt bewusst in der Android-App. DomiDex Web ist für Sammlung, Binder, Portfolio und manuelle Kartenverwaltung gedacht.'],
  ['Sind Android und Web synchron?', 'Verwende in beiden Oberflächen dasselbe freigeschaltete Google-Konto. Sammlung und Binder synchronisieren bei bestehender Verbindung automatisch. Offline-Änderungen kommen erst nach erneuter Verbindung an. Marktpreise werden separat abgerufen und zwischengespeichert; sie können zeitweise unterschiedlich aktuell sein.'],
  ['Wie teile ich einen privaten Binder?', 'Öffne deinen privaten Binder und nutze Teilen. Nach der erforderlichen Synchronisierung kannst du den Freigabelink kopieren und weitergeben. Andere sehen den freigegebenen Binder, können ihn aber nicht bearbeiten. In der aktuellen unterstützten Android-Version ist die App-Ansicht möglich; sonst öffnet sich die Browseransicht. Freigaben kannst du wieder beenden.'],
  ['Kann ich Karten groß ansehen und Holo-Effekte ausprobieren?', 'Ja. Die Web-App bietet große Kartenansichten und Holo-Vorschauen. Private Binder unterstützen eigene Cover und individuelle Effekte. Ein gewählter visueller Effekt ändert nicht die tatsächliche Druckvariante oder die Preiszuordnung einer Karte.'],
  ['Woher stammen die Preise?', 'DomiDex zeigt den Cardmarket-Trendpreis nur bei einer eindeutigen Karten- und Variantenzuordnung. Sonst steht transparent „Preis nicht verfügbar“.'],
  ['Warum fehlen Preise beim 30-Jahre-Set oder bei Promos?', 'Bei einzelnen Jubiläums-, Sonder- und Promokarten fehlen noch verlässliche Cardmarket-Zuordnungen oder Preiswerte. Diese werden weiter ergänzt. DomiDex schätzt keine Preise anhand des Namens und übernimmt nicht den Wert einer anderen Variante. Fehlende Preise bleiben als nicht verfügbar gekennzeichnet.'],
  ['Werden meine Karten öffentlich?', 'Deine Sammlung ist standardmäßig privat. Nur ausdrücklich per Link freigegebene Binder können von Personen mit diesem Link angesehen werden. Kaufdaten, Besitzmengen und private Notizen werden nicht geteilt. Kartenpreise, Binderwert und Anzeigename sind zusätzliche Freigabeoptionen. Beendest du eine Freigabe, werden weitere Serverabrufe gesperrt; bereits angefertigte Screenshots lassen sich nicht zurückholen.'],
  ['Werden Fehlscan-Fotos automatisch hochgeladen?', 'Nein. ScanLab-Fotos werden nur über den freiwilligen manuellen Upload mit Vorschau und ausdrücklichem Hochladen gesendet. Die Testervereinbarung aktiviert keine Bildfreigabe. Separate technische Erkennungsbeiträge ohne Rohfoto haben eine eigene, standardmäßig ausgeschaltete Datenschutzeinstellung.'],
  ['Wie melde ich einen Fehler?', 'Nutze das passende Feedback- oder Support-Angebot im Discord. Nenne App-Version, Gerät, Schritte und erwartetes Ergebnis. Bei Karten helfen Set, Nummer und Variante. Verberge E-Mail-Adressen, Freigabelinks und andere private Angaben auf Screenshots.'],
];
