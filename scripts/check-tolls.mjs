// Live check of the toll options for real trips, using the app's own routing code.
// Run: node scripts/check-tolls.mjs  (needs public/data/tolls.json)
import { readFile } from 'node:fs/promises';
import { getRoutes } from '../src/lib/routing.js';
import { pickTollVias, bestTollRoute } from '../src/lib/tolls.js';

let points = [];
try { ({ points } = JSON.parse(await readFile(new URL('../public/data/tolls.json', import.meta.url)))); } catch { /* not built yet */ }
console.log(`toll points loaded: ${points.length}`);
const trips = [
  ['KL city -> Shah Alam Stadium', [101.6869, 3.1390], [101.5440, 3.0806]],
  ['Hulu Kelang -> KLCC', [101.7600, 3.2100], [101.7117, 3.1579]],
  ['Petaling Jaya -> Putrajaya', [101.6070, 3.1070], [101.6960, 2.9264]],
];
const sum = (r) => `${Math.round(r.duration / 60)} min ${Math.round(r.distance / 1000)} km tolls=${r.tolls.map((t) => `${t.name}:${t.km.toFixed(1)}km`).join(',') || 'none'}`;
let ok = true;
for (const [name, from, to] of trips) {
  console.log(`\n== ${name}`);
  const main = await getRoutes(from, to);
  main.forEach((r, i) => console.log(`  route ${i}: ${sum(r)}`));
  const free = await getRoutes(from, to, undefined, { noToll: true }).catch((e) => (console.log('  noToll error', e.message), []));
  free.forEach((r, i) => console.log(`  no-motorway ${i}: ${sum(r)}`));
  if (!main.some((r) => r.tolls.length)) {
    const vias = pickTollVias(points, from, to);
    console.log(`  vias: ${JSON.stringify(vias)}`);
    const tries = [];
    for (const v of vias) { tries.push(await getRoutes(from, to, undefined, { via: v }).then((r) => r[0]).catch(() => null)); await new Promise((r) => setTimeout(r, 300)); }
    tries.forEach((r, i) => console.log(`  via ${i}: ${r ? sum(r) : 'error'}`));
    const best = bestTollRoute(tries, main[0]);
    console.log(`  => toll option: ${best ? sum(best) : 'NONE'}`);
    if (!best) ok = false;
  }
}
if (!ok) process.exitCode = 1;
