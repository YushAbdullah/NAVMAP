// Builds the preloaded place data for all of Malaysia from OpenStreetMap (Overpass API).
// Output: public/data/poi/<cat>/<lat>_<lon>.json (1° cells) + public/data/poi/index.json
// Run: node scripts/build-pois.mjs   (runs weekly in .github/workflows/update-places.yml)
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { CATEGORIES, OVERPASS, toPlace, cellKey, packPlace, qUnion } from '../src/lib/places.js';
import { LOGO_CATS, fetchBrandLogos } from '../src/lib/brands.js';

const OUT = new URL('../public/data/poi/', import.meta.url);
const MALAYSIA_AREA = 3602108121; // OSM relation 2108121 (Malaysia) as an Overpass area id

async function query(q) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of OVERPASS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 300_000);
        const res = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ data: q }),
          headers: { 'user-agent': 'NAVMAP data build (https://github.com/YushAbdullah/NAVMAP)' },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error(`${url} bad response`);
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(`${url} ${json.remark}`);
        return json.elements;
      } catch (e) {
        lastErr = e;
        console.warn('  retrying:', e.message);
      }
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw lastErr;
}

const index = { updatedAt: new Date().toISOString(), cellDeg: 1, counts: {}, cells: {} };
const brandIds = new Set();
let failed = 0;

for (const cat of Object.keys(CATEGORIES)) {
  console.log(`Fetching ${cat}…`);
  let elements;
  try {
    elements = await query(`[out:json][timeout:280];area(id:${MALAYSIA_AREA})->.my;(${qUnion(cat, '(area.my)')});out center tags;`);
  } catch (e) {
    console.error(`  FAILED ${cat}: ${e.message}`);
    failed++;
    continue;
  }
  const grid = new Map();
  for (const el of elements) {
    const p = toPlace(el, cat);
    if (!p) continue;
    if (p.brand && LOGO_CATS.includes(cat)) brandIds.add(p.brand); else p.brand = '';
    const k = cellKey(p.lat, p.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(packPlace(p));
  }
  const dir = new URL(`${cat}/`, OUT);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [k, list] of grid) await writeFile(new URL(`${k}.json`, dir), JSON.stringify({ p: list }));
  index.cells[cat] = [...grid.keys()].sort();
  index.counts[cat] = elements.length;
  console.log(`  ${elements.length} places in ${grid.size} cells`);
  await new Promise((r) => setTimeout(r, 5000)); // be polite to the public server
}

if (failed === Object.keys(CATEGORIES).length) {
  console.error('All categories failed; keeping the old data.');
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
// keep previous cells for categories that failed this time
if (failed) {
  try {
    const old = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('index.json', OUT), 'utf8'));
    for (const cat of Object.keys(CATEGORIES)) if (!index.cells[cat] && old.cells?.[cat]) { index.cells[cat] = old.cells[cat]; index.counts[cat] = old.counts?.[cat]; }
  } catch { /* no previous index */ }
}
// Brand logos (Wikidata). Optional: on failure keep the previous brands.json.
try {
  const brands = await fetchBrandLogos([...brandIds]);
  await writeFile(new URL('brands.json', OUT), JSON.stringify(brands));
  index.brands = Object.keys(brands).length;
  console.log(`  ${index.brands} brand logos for ${brandIds.size} brands`);
} catch (e) {
  console.warn('  brand logos skipped:', e.message);
}
await writeFile(new URL('index.json', OUT), JSON.stringify(index, null, 1));
console.log('Done', index.counts);
