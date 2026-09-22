'use client';

import {
  ArrowRight,
  BadgeEuro,
  BookOpen,
  Cloud,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Menu,
  MessageCircle,
  Rocket,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSiteContent } from '@/lib/site-content';

const highlights = [
  { icon: ScanLine, title: 'Scanner', text: 'Karten mobil erfassen' },
  { icon: BadgeEuro, title: 'Marktpreise', text: 'Nur eindeutig zugeordnet' },
  { icon: BookOpen, title: 'Binder', text: 'Druckvarianten getrennt sammeln' },
  { icon: Cloud, title: 'Synchron', text: 'Android und Web verbunden' },
];

const binderCards = [
  ['#a855f7', 'NORMAL'],
  ['#06b6d4', 'HOLO'],
  ['#f59e0b', 'REVERSE'],
  ['#ec4899', 'SET'],
  ['#22c55e', 'PRINT'],
  ['#8b5cf6', 'VARIANTE'],
];

export default function Home() {
  const { content } = useSiteContent();
  const kickstarterReady = Boolean(content.kickstarterUrl);
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="DomiDex Startseite">
          <img src="/domidex-logo.jpg" alt="" />
          <span>Domi<span>Dex</span></span>
        </a>
        <nav aria-label="Hauptnavigation">
          <a href="#funktionen">Funktionen</a>
          <a href="#web-app">Web App</a>
          <a href="/updates">Updates</a>
          <a href="/roadmap">Roadmap</a>
          <a href="/faq">FAQ</a>
        </nav>
        <div className="header-actions">
          <a className="text-link" href={content.discordUrl || '#community'}>Discord</a>
          {kickstarterReady ? <a className={cn(buttonVariants({ size: 'lg' }), 'primary-button')} href={content.kickstarterUrl}>{content.kickstarterCta} <Sparkles aria-hidden="true" /></a> : <span className="coming-soon">Kickstarter · Coming Soon</span>}
        </div>
        <details className="mobile-menu"><summary><Menu /> Menü</summary><div><a href="#funktionen">Funktionen</a><a href="/app">Web App</a><a href="/updates">Updates</a><a href="/roadmap">Roadmap</a><a href="/faq">FAQ</a><a href={content.discordUrl || '#community'}>Discord</a></div></details>
      </header>

      <section id="top" className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow"><span /> DomiDex · {content.releaseStatus} · Privat & Non-Profit</p>
          <h1>{content.heroTitle.split('. ').map((part, index) => <span key={part}>{index === 2 ? <em>{part.replace(/\.$/,'')}.</em> : `${part.replace(/\.$/,'')}.`}<br /></span>)}</h1>
          <p className="hero-lead">{content.heroSubtitle}</p>
          <div className="hero-actions">
            <a className={cn(buttonVariants({ size: 'lg' }), 'primary-button')} href="/app">
              Web App ansehen <ArrowRight aria-hidden="true" />
            </a>
            <a className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'secondary-button')} href="#community">
              Community beitreten
            </a>
          </div>
          <p className="principle"><ShieldCheck aria-hidden="true" /> Pre-Beta · privat betrieben · keine Werbung oder Abonnements.</p>
        </div>

        <div id="web-app" className="product-window" aria-label="Vorschau der DomiDex Desktop-Sammlung">
          <div className="window-bar">
            <div><span className="status-dot" /> DOMIDEX WEB</div>
            <div className="window-actions"><span /> <span /> <span /></div>
          </div>
          <div className="app-layout">
            <aside className="app-rail" aria-hidden="true">
              <img src="/domidex-logo.jpg" alt="" />
              {[ScanLine, BookOpen, BadgeEuro, Cloud].map((Icon, index) => (
                <span className={index === 1 ? 'active' : ''} key={index}><Icon /></span>
              ))}
            </aside>
            <section className="binder-stage">
              <div className="binder-heading">
                <div><small>WEB-APP VORSCHAU</small><strong>Dein digitaler Binder</strong></div>
                <span>Keine persönlichen Daten</span>
              </div>
              <div className="binder" role="img" aria-label="Geöffneter, animierter DomiDex Sammelbinder">
                <div className="binder-page left-page">
                  {binderCards.slice(0, 3).map(([color, label]) => <CardSlot color={color} label={label} key={label} />)}
                  <EmptySlot />
                </div>
                <div className="binder-rings"><i /><i /><i /><i /></div>
                <div className="binder-page right-page">
                  {binderCards.slice(3).map(([color, label]) => <CardSlot color={color} label={label} key={label} />)}
                  <EmptySlot />
                </div>
              </div>
              <div className="binder-controls"><button aria-label="Vorherige Binderseite">‹</button><span>Vorschau</span><button aria-label="Nächste Binderseite">›</button></div>
            </section>
            <aside className="detail-panel">
              <span className="detail-kicker">AUSGEWÄHLTE KARTE</span>
              <div className="detail-art"><Sparkles /><b>DOMIDEX</b><small>COLLECTION CARD</small></div>
              <h2>Kartendetails</h2>
              <p>Set · Nummer · Variante</p>
              <div className="price-row"><span>Cardmarket Trend</span><strong>Nur bei eindeutiger Zuordnung</strong></div>
              <a href="/app">Web App ansehen</a>
            </aside>
          </div>
        </div>
      </section>

      <section id="funktionen" className="highlights" aria-label="DomiDex Funktionen">
        {highlights.map(({ icon: Icon, title, text }) => (
          <article key={title}><span><Icon aria-hidden="true" /></span><div><h2>{title}</h2><p>{text}</p></div></article>
        ))}
      </section>

      <section className="story-section">
        <div><p className="section-kicker">WARUM DOMIDEX?</p><h2>Aus einem echten Sammlerproblem entstanden.</h2></div>
        <blockquote>„Eigentlich wollte ich nur meine Pokémon-Karten unbegrenzt scannen, ohne Werbung und ohne Abo – und dabei Preise sehen, die für meine deutschen Karten relevant sind.“</blockquote>
        <p>Daraus wurde DomiDex: mobil scannen, am Desktop verwalten und auf beiden Geräten dieselbe Sammlung sehen. Keine erfundene Magie, sondern ein Werkzeug, das Schritt für Schritt mit realen Karten besser wird.</p>
      </section>

      <section className="feature-section">
        <div className="section-heading"><p className="section-kicker">EIN SYSTEM</p><h2>Android scannt.<br />Web schafft Überblick.</h2><p>Firebase hält deine eigene Sammlung zwischen beiden Oberflächen synchron. Manuelle Web-Einträge bleiben Collection-Daten und erzeugen niemals ScanKnowledge.</p></div>
        <div className="feature-cards">
          <article><ScanLine /><span>ANDROID</span><h3>Karten erfassen</h3><p>Karten mit dem Scanner oder manuell über Set und Nummer erfassen. Der Scanner wird mit realen Karten weiter verbessert.</p></article>
          <article><BookOpen /><span>WEB</span><h3>Binder erleben</h3><p>Große Seiten, klare Varianten, Mengensteuerung und ein ruhiger Desktop-Arbeitsbereich.</p></article>
          <article><Cloud /><span>FIREBASE</span><h3>Eine Sammlung</h3><p>Dein Google-Konto verbindet Android und Web – ohne öffentliches Nutzerprofil.</p></article>
          <article><BadgeEuro /><span>MARKT</span><h3>Echte Trendpreise</h3><p>Nur eindeutige Cardmarket-Zuordnungen. Fehlt ein verlässlicher Wert, sagt DomiDex das offen.</p></article>
        </div>
      </section>

      <section id="updates" className="updates-section">
        <div className="section-heading"><p className="section-kicker">AKTUELLER STAND</p><h2>{content.releaseStatus}</h2><p>{content.statusBanner}</p><a href="/updates">Alle Updates <ArrowRight /></a></div>
        <div className="update-cards">{content.updates.filter((update) => update.active).slice(0,3).map((update) => <article key={update.id}><span>{update.version} · Build {update.build}</span><time>{update.date}</time><h3>{update.title}</h3><p>{update.summary}</p></article>)}</div>
      </section>

      <section id="roadmap" className="roadmap-preview"><div className="section-heading"><p className="section-kicker">ROADMAP</p><h2>Transparent statt vage.</h2><p>Experimentell bedeutet Idee – nicht Versprechen. Veröffentlichte Funktionen sind klar getrennt.</p></div><div>{content.roadmap.slice().sort((a,b)=>a.order-b.order).slice(0,4).map((item)=><article key={item.id}><span className={`roadmap-status ${item.status.toLowerCase().replaceAll(' ','-')}`}>{item.status}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></section>

      <section id="kickstarter" className="kickstarter-section"><Rocket /><div><p className="section-kicker">UNTERSTÜTZE DIE VISION</p><h2>{kickstarterReady ? content.kickstarterCta : 'Kickstarter – Coming Soon'}</h2><p>Keine erfundenen Zahlen und kein Countdown: Sobald die Kampagne offiziell ist, führt dieser Bereich direkt dorthin.</p></div>{kickstarterReady ? <a className="primary-button" href={content.kickstarterUrl}>Kickstarter öffnen <ArrowRight /></a> : <span>In Vorbereitung</span>}</section>

      <section id="community" className="community-grid"><article><MessageCircle /><div><h2>Discord Community</h2><p>{content.discordText}</p></div>{content.discordUrl ? <a href={content.discordUrl}>Discord öffnen <ArrowRight /></a> : <span>Link folgt</span>}</article><article><ShieldCheck /><div><h2>Private Pre-Beta</h2><p>Tester, Feedback und Entwicklungsupdates werden kontrolliert über die DomiDex Community koordiniert.</p></div><span>Interner Google-Play-Test · Zugang über Discord</span></article></section>

      <footer><div className="brand"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span></span></div><p>Privates Non-Profit-Projekt für Sammler · aktuelle Pre-Beta.</p><nav><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a><a href="/kontakt">Kontakt</a></nav><small>© 2026 DomiDex. Pokémon und zugehörige Marken gehören ihren jeweiligen Rechteinhabern.</small></footer>
    </main>
  );
}

function CardSlot({ color, label }: { color: string; label: string }) {
  return (
    <button className="card-slot" aria-label={`Vorschau: ${label}`} style={{ '--card-accent': color } as React.CSSProperties}>
      <span className="card-orbit" /><img src="/domidex-logo.jpg" alt="" /><b>DomiDex</b><small>{label}</small>
    </button>
  );
}

function EmptySlot() {
  return <button className="card-slot empty-slot" aria-label="Vorschau: fehlende Karte"><span>?</span><small>FEHLEND</small></button>;
}
