import { ArrowLeft } from 'lucide-react';

export function LegalPage({ type }: { type: 'impressum' | 'datenschutz' | 'kontakt' }) {
  const content = type === 'impressum' ? {
    title: 'Impressum', intro: 'Rechtliche Anbieterangaben', paragraphs: ['DomiDex befindet sich aktuell in einer privaten Pre-Beta. Vollständige Anbieter- und ladungsfähige Kontaktdaten werden vor einem öffentlichen kommerziellen Start ergänzt.', 'Diese Seite ist bereits als zentraler, später pflegbarer Rechtsbereich vorbereitet.'],
  } : type === 'datenschutz' ? {
    title: 'Datenschutz', intro: 'So behandelt DomiDex Web deine Daten', paragraphs: ['Die öffentliche Website verwendet keine Werbe-, Tracking- oder Analyse-Cookies.', 'Für die Web App wird Firebase Authentication mit Google verwendet. Deine Sammlung liegt geschützt unter deiner Firebase UID; Firestore-Regeln erlauben normalen Nutzern nur den Zugriff auf die eigene Collection.', 'Manuelle Web-Einträge erzeugen keine Scanner-Evidence. Das Admin-Dashboard bietet keinen allgemeinen Zugriff auf private Nutzersammlungen.', 'Technisch notwendige Protokolle der Hosting- und Firebase-Anbieter können unabhängig davon anfallen. Eine vollständige rechtliche Datenschutzerklärung wird vor dem öffentlichen Produktstart ergänzt.'],
  } : {
    title: 'Kontakt', intro: 'DomiDex erreichen', paragraphs: ['Community- und Projektkontakte werden zentral über die offiziellen Discord- und GitHub-Verweise der Startseite bereitgestellt.', 'Eine geschäftliche Kontaktadresse wird vor Kickstarter- oder Verkaufsstart ergänzt.'],
  };
  return <main className="legal-page"><a href="/"><ArrowLeft /> Zur Startseite</a><article><img src="/domidex-logo.jpg" alt="DomiDex"/><p>{content.intro}</p><h1>{content.title}</h1>{content.paragraphs.map((paragraph)=><p key={paragraph}>{paragraph}</p>)}</article></main>;
}
