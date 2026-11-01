// Nearby places from OpenStreetMap via the Overpass API (free, no key).
import { distKm } from './geo.js';

// Public Overpass mirrors (all allow browser CORS). We query them in parallel and use
// whichever answers first, because any single mirror can be slow or overloaded.
export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const CATEGORIES = {
  ev:       { en: 'EV charging', bm: 'Pengecas EV', short: { en: 'EV', bm: 'EV' }, q: 'nwr["amenity"="charging_station"]' },
  fuel:     { en: 'Fuel stations', bm: 'Stesen minyak', short: { en: 'Fuel', bm: 'Minyak' }, q: 'nwr["amenity"="fuel"]' },
  food:     { en: 'Fast food', bm: 'Makanan segera', short: { en: 'Fast food', bm: 'Makanan' }, q: 'nwr["amenity"="fast_food"]' },
  toilet:   { en: 'Toilets', bm: 'Tandas', short: { en: 'Toilets', bm: 'Tandas' }, q: 'nwr["amenity"="toilets"]' },
  surau:    { en: 'Surau & masjid', bm: 'Surau & masjid', short: { en: 'Surau', bm: 'Surau' }, q: 'nwr["amenity"="place_of_worship"]["religion"="muslim"]' },
  hospital: { en: 'Hospitals & clinics', bm: 'Hospital & klinik', short: { en: 'Hospitals', bm: 'Hospital' }, q: 'nwr["amenity"~"^(hospital|clinic)$"]' },
  // Pharmacies and chemists: every chain (Watsons, Guardian, Caring, AA, Big, Alpro, Health Lane, Multicare...) and independents.
  pharmacy: { en: 'Pharmacies', bm: 'Farmasi', short: { en: 'Pharmacy', bm: 'Farmasi' }, q: ['nwr["amenity"="pharmacy"]', 'nwr["shop"="chemist"]'] },
  police:   { en: 'Police stations', bm: 'Balai polis', short: { en: 'Police', bm: 'Polis' }, q: 'nwr["amenity"="police"]' },
  fire:     { en: 'Fire stations (Bomba)', bm: 'Balai bomba', short: { en: 'Bomba', bm: 'Bomba' }, q: 'nwr["amenity"="fire_station"]' },
  // Evacuation and relief centres. OSM has few in Malaysia, so names like "Pusat Pemindahan" count too.
  shelter:  { en: 'Evacuation shelters', bm: 'Pusat pemindahan', short: { en: 'Shelters', bm: 'Pemindahan' },
    q: ['nwr["emergency"~"^(assembly_point|evacuation_centre)$"]', 'nwr["social_facility"="shelter"]', 'nwr["name"~"pusat pemindahan|evacuation cent",i]'] },
  workshop: { en: 'Car workshops & tyres', bm: 'Bengkel kereta & tayar', short: { en: 'Workshop', bm: 'Bengkel' }, q: 'nwr["shop"~"^(car_repair|tyres)$"]' },
};

export const RADIUS_M = 4000;

/** Snap a centre to a ~1 km grid so nearby requests share a cache entry. */
export const snap = (v) => Math.round(v * 100) / 100;

/** Overpass union statements for a category, each followed by the area filter. */
export const qUnion = (cat, filter) => [].concat(CATEGORIES[cat].q).map((s) => `${s}${filter};`).join('');

export function overpassQuery(cat, lat, lon, radiusM = RADIUS_M) {
  return `[out:json][timeout:12];(${qUnion(cat, `(around:${radiusM},${lat},${lon})`)});out center tags 60;`;
}

/** Race all mirrors; resolve with the first good JSON answer. */
export async function raceOverpass(query, { timeoutMs = 9000, signal, fetchImpl = fetch } = {}) {
  const ctrls = OVERPASS.map(() => new AbortController());
  const abortAll = () => ctrls.forEach((c) => c.abort());
  signal?.addEventListener('abort', abortAll);
  const timer = setTimeout(abortAll, timeoutMs);
  try {
    return await Promise.any(OVERPASS.map(async (url, i) => {
      const res = await fetchImpl(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctrls[i].signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elements) || (!json.elements.length && /error|timed out/i.test(json.remark || ''))) throw new Error('Overpass error');
      return json;
    }));
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw e instanceof AggregateError ? new Error('All Overpass mirrors failed or timed out') : e;
  } finally {
    clearTimeout(timer);
    abortAll(); // cancel the slower mirrors
    signal?.removeEventListener('abort', abortAll);
  }
}

/** Fetch places for a category around a snapped centre: our cached API first, then mirrors directly. */
async function loadRaw(cat, lat, lon, signal) {
  try {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal?.addEventListener('abort', stop);
    const timer = setTimeout(stop, 9500);
    try {
      const res = await fetch(`/api/places?cat=${cat}&lat=${lat}&lon=${lon}`, { signal: ctrl.signal });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('json')) {
        const d = await res.json();
        if (Array.isArray(d.places)) return d.places;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const json = await raceOverpass(overpassQuery(cat, lat, lon), { signal });
  return json.elements.map((el) => toPlace(el, cat)).filter(Boolean);
}

const cache = new Map();

// ---- Preloaded data: every place in Malaysia, split into 1° grid cells (public/data/poi).
// Built weekly by scripts/build-pois.mjs (GitHub Action). Served from the CDN, so it is instant.
export const CELL_DEG = 1;
export const cellKey = (lat, lon) => `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
export const packPlace = (p) => { const a = [p.id, p.name, +p.lat.toFixed(5), +p.lon.toFixed(5), p.meta, p.address, p.hours, p.phone, p.website]; if (p.brand) a.push(p.brand); return a; };
const unpack = (a, cat) => ({ id: a[0], cat, name: a[1] || ({ workshop: 'Car workshop', pharmacy: 'Pharmacy', police: 'Police station', fire: 'Fire station', shelter: 'Evacuation shelter' }[cat] || CATEGORIES[cat]?.en || 'Place'), lat: a[2], lon: a[3], meta: a[4] || '', address: a[5] || '', hours: a[6] || '', phone: a[7] || '', website: a[8] || '', brand: a[9] || '' });

let manifestP = null;
function manifest() {
  manifestP ||= fetch('/data/poi/index.json')
    .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
    .catch(() => null);
  return manifestP;
}
const cellCache = new Map();
function loadCell(cat, key) {
  if (!cellCache.has(key + cat)) {
    const p = fetch(`/data/poi/${cat}/${key}.json`).then((r) => (r.ok ? r.json() : { p: [] })).then((d) => d.p.map((a) => unpack(a, cat)));
    cellCache.set(key + cat, p);
    p.catch(() => cellCache.delete(key + cat));
  }
  return cellCache.get(key + cat);
}

/** Places from the preloaded grid within radiusKm, widening the search if very few are found. Null if no data. */
async function fromStatic(cat, center) {
  const m = await manifest();
  const cells = m?.cells?.[cat];
  if (!cells) return null;
  const have = new Set(cells);
  for (const km of [5, 15, 40]) {
    const d = km / 111;
    const keys = new Set();
    for (const la of [center[1] - d, center[1], center[1] + d]) {
      for (const lo of [center[0] - d, center[0], center[0] + d]) keys.add(cellKey(la, lo));
    }
    const lists = await Promise.all([...keys].filter((k) => have.has(k)).map((k) => loadCell(cat, k)));
    const near = lists.flat()
      .map((p) => ({ ...p, distKm: distKm(center, [p.lon, p.lat]) }))
      .filter((p) => p.distKm <= km)
      .sort((a, b) => a.distKm - b.distKm);
    if (near.length >= 5 || km === 40) return near.slice(0, 80);
  }
  return [];
}

export async function fetchNearby(cat, center, signal) {
  const fast = await fromStatic(cat, center).catch(() => null);
  if (fast && fast.length) return fast;
  // Live fallback (data not built yet, or nothing nearby in the snapshot)
  const lat = snap(center[1]), lon = snap(center[0]);
  const key = `${cat}:${lat},${lon}`;
  if (!cache.has(key)) {
    const p = loadRaw(cat, lat, lon, signal);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  const list = await cache.get(key);
  return list
    .map((p) => ({ ...p, distKm: distKm(center, [p.lon, p.lat]) }))
    .sort((a, b) => a.distKm - b.distKm);
}

/** Warm the cache in the background (e.g. right after we know where the user is). */
export function prefetchNearby(cats, center) {
  manifest();
  for (const c of cats) fetchNearby(c, center).catch(() => {});
}

export function toPlace(el, cat) {
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const t = el.tags || {};
  const fallback = { ev: 'EV charger', fuel: 'Fuel station', food: 'Fast food', toilet: 'Public toilet', surau: 'Surau', hospital: t.amenity === 'clinic' ? 'Clinic' : 'Hospital', pharmacy: 'Pharmacy', police: 'Police station', fire: 'Fire station', shelter: 'Evacuation shelter', workshop: t.shop === 'tyres' ? 'Tyre shop' : 'Car workshop' }[cat] || CATEGORIES[cat]?.en || 'Place';
  const name = t.name || t['name:en'] || t['name:ms'] || t.brand || t.operator || fallback;
  const meta = [];
  if (cat === 'ev') {
    if (t.operator || t.network) meta.push(t.network || t.operator);
    const sockets = Object.keys(t).filter((k) => /^socket:[^:]+$/.test(k)).map((k) => k.split(':')[1].replace('type2', 'Type 2').replace('_combo', ' CCS').replace('chademo', 'CHAdeMO'));
    if (sockets.length) meta.push(sockets.join(', '));
    if (t.capacity) meta.push(`${t.capacity} bays`);
  } else if (cat === 'fuel') {
    if (t.brand && t.brand !== name) meta.push(t.brand);
    const fuels = [['fuel:octane_95', 'RON95'], ['fuel:octane_97', 'RON97'], ['fuel:diesel', 'Diesel']].filter(([k]) => t[k] === 'yes').map(([, v]) => v);
    if (fuels.length) meta.push(fuels.join(' · '));
  } else if (cat === 'food') {
    if (t.cuisine) meta.push(t.cuisine.replace(/_/g, ' ').replace(/;/g, ', '));
    if (t['diet:halal'] === 'yes' || t['diet:halal'] === 'only') meta.push('Halal');
    if (t.drive_through === 'yes') meta.push('Drive-thru');
  } else if (cat === 'toilet') {
    if (t.wheelchair === 'yes') meta.push('Accessible');
    if (t.fee === 'yes') meta.push('Paid'); else if (t.fee === 'no') meta.push('Free');
  } else if (cat === 'police' || cat === 'fire') {
    if (t.operator && t.operator !== name) meta.push(t.operator);
  } else if (cat === 'shelter') {
    if (t.capacity) meta.push(`Capacity ${t.capacity}`);
    if (t.operator) meta.push(t.operator);
  } else if (cat === 'pharmacy') {
    if (t.brand && t.brand !== name) meta.push(t.brand);
    if (t.dispensing === 'yes') meta.push('Dispensing');
  } else if (cat === 'hospital') {
    if (t.emergency === 'yes') meta.push('Emergency');
    if (t['healthcare:speciality']) meta.push(t['healthcare:speciality'].split(';')[0]);
  }
  const addr = [t['addr:street'], t['addr:city']].filter(Boolean).join(', ');
  return {
    id: `${el.type}/${el.id}`, cat, name, lat, lon,
    meta: meta.join(' · ') || addr,
    address: addr,
    hours: t.opening_hours || '',
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
    brand: /^Q\d+$/.test(t['brand:wikidata'] || '') ? t['brand:wikidata'] : '',
  };
}
