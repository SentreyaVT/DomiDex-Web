'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useSiteContent } from '@/lib/site-content';

export function PublicPage({ type }: { type: 'updates' | 'roadmap' | 'faq' }) {
  const { content } = useSiteContent();
  return <main className="public-page"><header><a className="brand" href="/"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span> TCG</span></a><a href="/"><ArrowLeft /> Startseite</a></header><section className="public-hero"><p>{type === 'updates' ? 'ENTWICKLUNGSSTAND' : type === 'roadmap' ? 'AUSBLICK' : 'HILFE'}</p><h1>{type === 'updates' ? 'DomiDex Updates' : type === 'roadmap' ? 'Roadmap' : 'Häufige Fragen'}</h1><span>{type === 'updates' ? 'Nur tatsächlich veröffentlichte und verifizierte Änderungen.' : type === 'roadmap' ? 'Ohne erfundene Termine oder feste Zusagen für experimentelle Ideen.' : 'Klar und ohne Kleingedrucktes.'}</span></section>{type === 'updates' && <section className="public-list">{content.updates.filter((item)=>item.active).map((item)=><article key={item.id}><div><span>{item.version} · Build {item.build}</span><time>{item.date}</time></div><h2>{item.title}</h2><p>{item.summary}</p><p>{item.details}</p>{item.linkUrl&&<a href={item.linkUrl}>Mehr erfahren <ExternalLink /></a>}</article>)}</section>}{type === 'roadmap' && <section className="public-list roadmap-list">{content.roadmap.slice().sort((a,b)=>a.order-b.order).map((item)=><article key={item.id}><span className={`roadmap-status ${item.status.toLowerCase().replaceAll(' ','-')}`}>{item.status}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</section>}{type === 'faq' && <section className="faq-list">{faqs.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>}</main>;
}

const faqs = [
  ['Ist DomiDex bereits fertig?', 'DomiDex befindet sich in der Pre-Beta. Kernbereiche sind testbar, der Scanner wird mit realen Karten und Geräten weiter verbessert.'],
  ['Brauche ich ein Abonnement?', 'Nein. Das Produktprinzip lautet: keine Werbung, kein Abonnement, einmal kaufen und Weiterentwicklung inklusive. Preis und Veröffentlichung sind noch nicht final angekündigt.'],
  ['Kann die Website Karten scannen?', 'Nein. Der Scanner bleibt bewusst in der Android-App. DomiDex Web ist für Sammlung, Binder, Portfolio und manuelle Kartenverwaltung gedacht.'],
  ['Sind Android und Web synchron?', 'Ja. Beide verwenden dasselbe Google-/Firebase-Konto und denselben geschützten Collection-Pfad.'],
  ['Woher stammen die Preise?', 'DomiDex zeigt den Cardmarket-Trendpreis nur bei einer eindeutigen Karten- und Variantenzuordnung. Sonst steht transparent „Preis nicht verfügbar“.'],
  ['Werden meine Karten öffentlich?', 'Nein. Firestore-Regeln erlauben normalen Nutzern ausschließlich den Zugriff auf die eigene Sammlung. Auch das Admin-Dashboard durchsucht keine privaten Sammlungen.'],
];
