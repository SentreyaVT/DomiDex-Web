import { ArrowLeft } from 'lucide-react';
import { legalContent, legalNavigation, type LegalPageType } from '@/lib/legal-content';
import './legal-page.css';

export function LegalPage({ type }: { type: LegalPageType }) {
  const content = legalContent[type];
  return <main className="legal-page legal-release">
    <a href="/" className="legal-back"><ArrowLeft aria-hidden="true" /> Zur Startseite</a>
    <article aria-labelledby="legal-title">
      <img src="/domidex-logo.jpg" alt="DomiDex" width={55} height={55}/>
      <h1 id="legal-title">{content.title}</h1><p>{content.intro}</p><p className="legal-date">Stand: 23. September 2026</p>
      <nav className="legal-navigation" aria-label="Informationen und Datenschutz">{legalNavigation.map((item) => <a key={item.type} href={item.href} aria-current={item.type === type ? 'page' : undefined}>{item.label}</a>)}</nav>
      {content.sections.length > 5 && <nav className="legal-toc" aria-label="Inhalt dieser Seite"><h2>Auf dieser Seite</h2><ul>{content.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul></nav>}
      {content.sections.map((section) => <section key={section.id} id={section.id} aria-labelledby={`heading-${section.id}`}><h2 id={`heading-${section.id}`}>{section.title}</h2>
        {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {section.items && <ol>{section.items.map((item) => <li key={item}>{item}</li>)}</ol>}
        {section.links && <div className="legal-links">{section.links.map((link) => <a key={link.href} href={link.href} rel={link.href.startsWith('https:') ? 'noreferrer' : undefined}>{link.label}</a>)}</div>}
      </section>)}
      <nav className="legal-navigation legal-bottom" aria-label="Weitere öffentliche Informationen">{legalNavigation.filter((item) => item.type !== type).map((item) => <a key={item.type} href={item.href}>{item.label}</a>)}</nav>
    </article>
  </main>;
}
