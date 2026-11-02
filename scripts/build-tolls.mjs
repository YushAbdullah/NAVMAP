// Builds public/data/tolls.json: points every ~2 km along Malaysia's tolled expressways (OpenStreetMap).
// The app routes through the nearest of these to offer a "Use toll roads" option when the fastest route is toll-free.
// Run: node scripts/build-tolls.mjs   (runs weekly in .github/workflows/update-places.yml)
import { writeFile } from 'node:fs/promises';
import { OVERPASS } from '../src/lib/places.js';

const MALAYSIA_AREA = 3602108121;
const STEP_KM = 2;

async function query(q) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: new URLSearchParams({ data: q }),
          headers: { 'user-agent': 'NAVMAP data build (https://github.com/YushAbdullah/NAVMAP)' },
          signal: AbortSignal.timeout(300_000),
        });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error(`${url} bad response`);
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(`${url} ${json.remark}`);
        return json.elements;
      } catch (e) { lastErr = e; console.warn('  retrying:', e.message); }
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw lastErr;
}

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// Malaysian expressways carry an "E" route number (E1 PLUS, E11 LDP, E5 KESAS, E35 Guthrie, …); nearly all charge tolls.
const ways = await query(`[out:json][timeout:280];area(id:${MALAYSIA_AREA})->.my;(way[highway=motorway][ref~"(^|;)E[0-9]"](area.my);way[highway~"^(motorway|trunk)$"][toll=yes](area.my););out tags geom;`);
const pts = [];
for (const w of ways) {
  if (w.tags?.toll === 'no' || !w.geometry?.length) continue;
  const ref = (w.tags.ref || '').split(';').find((r) => /^E\d/.test(r)) || '';
  let acc = STEP_KM; // first point of each way
  for (let i = 0; i < w.geometry.length; i++) {
    if (i) acc += km(w.geometry[i - 1], w.geometry[i]);
    if (acc >= STEP_KM) { acc = 0; pts.push([+w.geometry[i].lon.toFixed(4), +w.geometry[i].lat.toFixed(4), ref]); }
  }
}
// Drop near-duplicates (both carriageways, overlapping ways): keep one point per ~1 km cell and road.
const seen = new Set();
const out = pts.filter(([x, y, r]) => { const k = `${Math.round(x * 100)}|${Math.round(y * 100)}|${r}`; if (seen.has(k)) return false; seen.add(k); return true; });
await writeFile(new URL('../public/data/tolls.json', import.meta.url), JSON.stringify({ updatedAt: new Date().toISOString(), points: out }));
console.log(`ways ${ways.length}, toll points ${out.length}`);
