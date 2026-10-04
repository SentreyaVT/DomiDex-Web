import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WindowedCollectionGrid } from '../../components/windowed-collection-grid';
import type { CollectionEntry } from '../../lib/domain';
import '../../app/globals.css';
import '../../components/web-app-polish.css';

const entries = Array.from({ length: 10000 }, (_, index) => ({ syncId: `synthetic-${index}`, name: `Testkarte ${index}`, setName: 'Lokales Testset', collectorNumber: String(index), finish: 'Normal', variant: 'Standard', quantity: 1 }) as CollectionEntry);
function App() {
  const [count, setCount] = useState(351);
  const [query, setQuery] = useState('');
  const [reverse, setReverse] = useState(false);
  const [tall, setTall] = useState(false);
  const [selection, setSelection] = useState('Keine');
  const filtered = entries.slice(0, count).filter((entry) => entry.name.includes(query));
  if (reverse) filtered.reverse();
  return <main className="collector-app desktop-app" style={{ display: 'block' }}><section className="app-view">
    <header style={{ position: 'sticky', top: 0, zIndex: 5, padding: 16, background: '#111225' }}>
      <h1>Sammlung – isolierte Browserprüfung</h1><p>Nur künstliche Daten. Kein Firebase, kein Upload, keine Benutzerkonten.</p>
      <label>Anzahl <select aria-label="Testanzahl" value={count} onChange={(event) => setCount(Number(event.target.value))}><option value="351">351</option><option value="10000">10000</option><option value="0">0</option></select></label>{' '}
      <button onClick={() => setReverse((current) => !current)}>Reihenfolge umkehren</button>{' '}
      <button onClick={() => setTall((current) => !current)}>Preistexte verlängern</button>{' '}
      <label>Suche <input aria-label="Testkarten filtern" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p role="status">{filtered.length} Einträge · Auswahl: {selection} · Lange Preise: {tall ? 'an' : 'aus'}</p>
    </header>
    <WindowedCollectionGrid entries={filtered} onSelect={setSelection} renderCard={(entry) => {
      const index = Number(entry.collectorNumber);
      const price = index === count - 2 ? 'Kein Trendpreis verfügbar · Alternative für diese Testkarte prüfen · Dieser absichtlich besonders lange Testpreis erscheint erst am Listenende.' : index % 7 === 0 || (tall && index % 4 === 1) ? 'Kein Trendpreis verfügbar · Alternative für diese Testkarte prüfen' : '12,34 €';
      return <article className="card-tile"><div style={{ background: 'linear-gradient(135deg,#493287,#16243d)', display: 'grid', placeItems: 'center', color: '#dbbaff', fontSize: 40 }}>{index}</div><p>{entry.setName}</p><h3>{entry.name}</h3><span>#{entry.collectorNumber} · Normal</span><strong>{price}</strong></article>;
    }} />
  </section></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
