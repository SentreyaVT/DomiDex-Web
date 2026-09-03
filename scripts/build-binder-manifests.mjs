import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const sourcePath = process.env.DOMIDEX_SCANNER_MASTER_INDEX_PATH;
if (!sourcePath) throw new Error('DOMIDEX_SCANNER_MASTER_INDEX_PATH fehlt.');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (!Array.isArray(source.cards)) throw new Error('Der Scanner-Masterindex enthält keine Kartenliste.');

const output = resolve('public/catalog/sets');
const expectedRoot = `${resolve('public/catalog')}${sep}`;
if (!output.startsWith(expectedRoot)) throw new Error('Unsicheres Ausgabeverzeichnis.');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const grouped = new Map();
for (const card of source.cards) {
  if (!card || typeof card.id !== 'string' || typeof card.setId !== 'string' || typeof card.localId !== 'string') continue;
  const setId = card.setId.trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,120}$/.test(setId)) continue;
  const item = {
    id: card.id.trim().toLowerCase(),
    localId: card.localId.trim(),
    name: typeof card.nameDe === 'string' ? card.nameDe.trim() : '',
    rarity: typeof card.rarity === 'string' ? card.rarity.trim() : '',
    variants: Array.isArray(card.variants) ? card.variants.filter((value) => typeof value === 'string').map((value) => value.trim().toLowerCase()) : [],
  };
  grouped.set(setId, [...(grouped.get(setId) ?? []), item]);
}

for (const [setId, cards] of grouped) {
  cards.sort((left, right) => Number.parseInt(left.localId, 10) - Number.parseInt(right.localId, 10) || left.id.localeCompare(right.id));
  writeFileSync(resolve(output, `${setId}.json`), `${JSON.stringify({ schemaVersion: 1, setId, cards })}\n`, 'utf8');
}

console.log(`Binder-Manifeste: ${grouped.size} Sets, ${source.cards.length} Karten.`);
