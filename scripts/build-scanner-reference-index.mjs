import { promises as fs } from 'node:fs';
import path from 'node:path';

const referenceDir = required('DOMIDEX_SCANNER_REFERENCE_DIR');
const databaseDir = required('DOMIDEX_TCGDEX_DB_PATH');
const sourceIndex = process.env.DOMIDEX_SCANNER_SOURCE_INDEX || path.join(referenceDir, 'scanner-index.json');
const output = process.env.DOMIDEX_SCANNER_MASTER_INDEX_PATH || path.resolve('.domidex/scanner/master-index.json');

const sourceCards = JSON.parse((await fs.readFile(sourceIndex, 'utf8')).replace(/^\uFEFF/, ''));
if (!Array.isArray(sourceCards)) throw new Error('scanner-index.json muss ein Array enthalten.');

const metadata = new Map();
const errors = [];
const setRoot = path.join(databaseDir, 'data');
for (const seriesEntry of await safeDirectories(setRoot)) {
  const seriesDir = path.join(setRoot, seriesEntry.name);
  const seriesSource = await safeText(path.join(setRoot, `${seriesEntry.name}.ts`));
  const seriesName = localizedName(seriesSource) || seriesEntry.name;
  for (const setEntry of await safeDirectories(seriesDir)) {
    const setDir = path.join(seriesDir, setEntry.name);
    const setSource = await safeText(path.join(seriesDir, `${setEntry.name}.ts`));
    const setId = field(setSource, 'id');
    if (!setId) continue;
    const setName = localizedName(setSource) || setEntry.name;
    for (const cardFile of await safeFiles(setDir, '.ts')) {
      try {
        const localId = path.basename(cardFile.name, '.ts');
        const cardSource = await fs.readFile(path.join(setDir, cardFile.name), 'utf8');
        const nameDe = localizedName(cardSource);
        const category = field(cardSource, 'category');
        const rarity = field(cardSource, 'rarity');
        const variantsIndex = cardSource.indexOf('variants:');
        const variantsSource = variantsIndex >= 0 ? cardSource.slice(variantsIndex) : '';
        const variants = [...variantsSource.matchAll(/\btype:\s*["'](normal|holo|reverse|metal|lenticular)["']/g)].map((match) => match[1]);
        metadata.set(`${setId}-${localId}`.toLowerCase(), {
          setId, setName, series: seriesName, localId, nameDe, category, rarity,
          hp: numberField(cardSource, 'hp'), types: stringArray(cardSource, 'types'), stage: field(cardSource, 'stage'),
          illustrator: field(cardSource, 'illustrator'), dexId: numberArray(cardSource, 'dexId'), variants: [...new Set(variants)],
        });
      } catch (error) { errors.push(`${seriesEntry.name}/${setEntry.name}/${cardFile.name}: ${error.message}`); }
    }
  }
}

const duplicates = []; const seen = new Set(); let imagesMatched = 0; let metadataMatched = 0;
const cards = [];
for (const item of sourceCards) {
  const id = String(item.id ?? ''); const localId = String(item.localId ?? ''); const imageFile = String(item.file ?? '');
  if (!id || !localId || !imageFile) { errors.push(`Ungültiger Indexeintrag: ${id || '(ohne ID)'}`); continue; }
  if (seen.has(id.toLowerCase())) duplicates.push(id); seen.add(id.toLowerCase());
  const setId = id.endsWith(`-${localId}`) ? id.slice(0, -(localId.length + 1)) : id.split('-').slice(0, -1).join('-');
  const details = metadata.get(`${setId}-${localId}`.toLowerCase()) ?? null;
  const imageExists = await exists(path.join(referenceDir, imageFile));
  if (imageExists) imagesMatched += 1; if (details) metadataMatched += 1;
  const nameDe = details?.nameDe || String(item.name ?? id);
  const category = details?.category ?? null; const rarity = details?.rarity ?? null;
  cards.push({
    cardKey: `${setId}-${localId}`, id, setId, setName: details?.setName ?? null, series: details?.series ?? null,
    localId, nameDe, category, rarity, hp: details?.hp ?? null, types: details?.types ?? [], stage: details?.stage ?? null,
    illustrator: details?.illustrator ?? null, dexId: details?.dexId ?? [], variants: details?.variants ?? [], imageFile,
    sourceImageUrl: safeSourceImage(item.image),
    referenceAvailable: imageExists, metadataAvailable: !!details, layoutFamily: classify(nameDe, category, rarity, setId), calibrationStatus: 'unclassified',
  });
}
const result = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  stats: { cardsProcessed: cards.length, imagesMatched, metadataMatched, unmatched: cards.length - metadataMatched, duplicates: duplicates.length, errors: errors.length },
  duplicates, errors: errors.slice(0, 500), cards,
};
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result), 'utf8');
console.log(JSON.stringify(result.stats));

function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} fehlt. In .env.local ausschließlich lokal setzen.`); return path.resolve(value); }
async function safeDirectories(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()); } catch { return []; } }
async function safeFiles(dir, suffix) { try { return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(suffix)); } catch { return []; } }
async function safeText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return ''; } }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function safeSourceImage(value) { try { const url = new URL(String(value ?? '')); return url.protocol === 'https:' && url.hostname === 'assets.tcgdex.net' && /^\/de\/[A-Za-z0-9._/-]+$/.test(url.pathname) ? url.toString().replace(/\/$/, '') : null; } catch { return null; } }
function field(source, name) { return source.match(new RegExp(`\\b${name}:\\s*["']([^"']+)["']`))?.[1] ?? null; }
function numberField(source, name) { const value = source.match(new RegExp(`\\b${name}:\\s*(\\d+)`))?.[1]; return value ? Number(value) : null; }
function localizedName(source) { const block = source.match(/\bname:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''; return block.match(/\bde:\s*["']([^"']+)["']/)?.[1] ?? block.match(/\ben:\s*["']([^"']+)["']/)?.[1] ?? null; }
function stringArray(source, name) { const block = source.match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? ''; return [...block.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]); }
function numberArray(source, name) { return stringArray(source, name).map(Number).filter(Number.isFinite).length ? stringArray(source, name).map(Number).filter(Number.isFinite) : [...(source.match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/\d+/g)].map((match) => Number(match[0])); }
function classify(name, category, rarity, setId) { const value = `${name} ${rarity ?? ''}`.toLowerCase(); if (/special illustration/.test(value)) return 'Special Illustration Rare'; if (/illustration/.test(value)) return 'Illustration Rare'; if (/full art/.test(value)) return 'Full Art'; if (/vmax/.test(value)) return 'VMAX'; if (/vstar/.test(value)) return 'VSTAR'; if (/\bgx\b/.test(value)) return 'GX'; if (/\bex\b/.test(value)) return 'EX'; if (/\bv\b/.test(value)) return 'V'; if (/promo/i.test(setId) || /promo/.test(value)) return 'Promo'; if (category === 'Trainer') return 'Trainer'; return category === 'Pokemon' ? 'Standard Pokémon' : 'Special Layout'; }
