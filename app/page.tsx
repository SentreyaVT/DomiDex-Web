'use client';

import {
  ArrowRight,
  BadgeEuro,
  BookOpen,
  Cloud,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Code2,
  MessageCircle,
  Rocket,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSiteContent } from '@/lib/site-content';

const highlights = [
  { icon: ScanLine, title: 'Scanner', text: 'Karten mobil erfassen' },
  { icon: BadgeEuro, title: 'Deutsche Preise', text: 'Cardmarket-orientiert' },
  { icon: BookOpen, title: 'Binder', text: 'Sammlung mit Struktur' },
  { icon: Cloud, title: 'Überall', text: 'Android & Desktop' },
];

const binderCards = [
  ['#a855f7', '001'],
  ['#06b6d4', '014'],
  ['#f59e0b', '025'],
  ['#ec4899', '041'],
  ['#22c55e', '063'],
  ['#8b5cf6', '091'],
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
          <a className={cn(buttonVariants({ size: 'lg' }), 'primary-button')} href={kickstarterReady ? content.kickstarterUrl : '#kickstarter'}>
            {kickstarterReady ? content.kickstarterCta : 'Kickstarter'} <Sparkles aria-hidden="true" />
          </a>
        </div>
      </header>

      <section id="top" className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow"><span /> DomiDex {content.currentVersion} · Build {content.currentBuild}</p>
          <h1>{content.heroTitle.split('. ').map((part, index) => <span key={part}>{index === 2 ? <em>{part.replace(/\.$/,'')}.</em> : `${part.replace(/\.$/,'')}.`}<br /></span>)}</h1>
          <p className="hero-lead">{content.heroSubtitle}</p>
          <div className="hero-actions">
            <a className={cn(buttonVariants({ size: 'lg' }), 'primary-button')} href="/login">
              Web App öffnen <ArrowRight aria-hidden="true" />
            </a>
            <a className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'secondary-button')} href="#community">
              Community beitreten
            </a>
          </div>
          <p className="principle"><ShieldCheck aria-hidden="true" /> Keine Werbung. Kein Abo. Einmal kaufen. Weiterentwicklung inklusive.</p>
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
                <div><small>HAUPTBINDER</small><strong>Prismatische Entwicklungen</strong></div>
                <span>53 / 476 Karten</span>
              </div>
              <div className="binder" role="img" aria-label="Geöffneter, animierter DomiDex Sammelbinder">
                <div className="binder-page left-page">
                  {binderCards.slice(0, 3).map(([color, number]) => <CardSlot color={color} number={number} key={number} />)}
                  <EmptySlot number="072" />
                </div>
                <div className="binder-rings"><i /><i /><i /><i /></div>
                <div className="binder-page right-page">
                  {binderCards.slice(3).map(([color, number]) => <CardSlot color={color} number={number} key={number} />)}
                  <EmptySlot number="118" />
                </div>
              </div>
              <div className="binder-controls"><button aria-label="Vorherige Binderseite">‹</button><span>5 / 55</span><button aria-label="Nächste Binderseite">›</button></div>
            </section>
            <aside className="detail-panel">
              <span className="detail-kicker">AUSGEWÄHLTE KARTE</span>
              <div className="detail-art"><Sparkles /><b>DOMIDEX</b><small>COLLECTION CARD</small></div>
              <h2>Deine Karte</h2>
              <p>Set · Nummer · Variante</p>
              <div className="price-row"><span>Cardmarket Trend</span><strong>Preis verfügbar</strong></div>
              <button>Details öffnen</button>
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
          <article><ScanLine /><span>ANDROID</span><h3>Karten erfassen</h3><p>Scanner, manuelle Korrektur und Zustandswerkzeuge bleiben dort, wo die Kamera ist.</p></article>
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

      <section id="community" className="community-grid"><article><MessageCircle /><div><h2>Discord Community</h2><p>{content.discordText}</p></div>{content.discordUrl ? <a href={content.discordUrl}>Discord öffnen <ArrowRight /></a> : <span>Link folgt</span>}</article><article><Code2 /><div><h2>GitHub & Releases</h2><p>Entwicklung und freigegebene DomiDex-Versionen an einem verlässlichen Ort.</p></div><a href={content.githubUrl}>Projekt öffnen <ArrowRight /></a></article></section>

      <footer><div className="brand"><img src="/domidex-logo.jpg" alt="" /><span>Domi<span>Dex</span> TCG</span></div><p>Für Sammler. Von Sammlern. Ohne Werbung und ohne Abonnement.</p><nav><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a><a href="/kontakt">Kontakt</a></nav><small>© 2026 DomiDex. Pokémon und zugehörige Marken gehören ihren jeweiligen Rechteinhabern.</small></footer>
    </main>
  );
}

function CardSlot({ color, number }: { color: string; number: string }) {
  return (
    <button className="card-slot" aria-label={`Sammlungskarte ${number}`} style={{ '--card-accent': color } as React.CSSProperties}>
      <span className="card-orbit" /><img src="/domidex-logo.jpg" alt="" /><b>DomiDex</b><small>#{number}</small>
    </button>
  );
}

function EmptySlot({ number }: { number: string }) {
  return <button className="card-slot empty-slot" aria-label={`Fehlende Karte ${number}`}><span>?</span><small>#{number}</small></button>;
}
