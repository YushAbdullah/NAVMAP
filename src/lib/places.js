// Nearby places from OpenStreetMap via the Overpass API (free, no key).
import { distKm } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const CATEGORIES = {
  ev:       { en: 'EV charging', bm: 'Pengecas EV', short: { en: 'EV', bm: 'EV' }, q: 'nwr["amenity"="charging_station"]' },
  fuel:     { en: 'Fuel stations', bm: 'Stesen minyak', short: { en: 'Fuel', bm: 'Minyak' }, q: 'nwr["amenity"="fuel"]' },
  food:     { en: 'Fast food', bm: 'Makanan segera', short: { en: 'Fast food', bm: 'Makanan' }, q: 'nwr["amenity"="fast_food"]' },
  toilet:   { en: 'Toilets', bm: 'Tandas', short: { en: 'Toilets', bm: 'Tandas' }, q: 'nwr["amenity"="toilets"]' },
  surau:    { en: 'Surau & masjid', bm: 'Surau & masjid', short: { en: 'Surau', bm: 'Surau' }, q: 'nwr["amenity"="place_of_worship"]["religion"="muslim"]' },
  hospital: { en: 'Hospitals & clinics', bm: 'Hospital & klinik', short: { en: 'Hospitals', bm: 'Hospital' }, q: 'nwr["amenity"~"^(hospital|clinic)$"]' },
};

const cache = new Map();

export async function fetchNearby(cat, center, radiusM = 4000, signal) {
  const key = `${cat}:${center[1].toFixed(3)},${center[0].toFixed(3)}:${radiusM}`;
  if (cache.has(key)) return cache.get(key);
  const c = CATEGORIES[cat];
  const query = `[out:json][timeout:20];(${c.q}(around:${radiusM},${center[1]},${center[0]}););out center tags 80;`;
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      const list = (json.elements || [])
        .map((el) => toPlace(el, cat, center))
        .filter(Boolean)
        .sort((a, b) => a.distKm - b.distKm);
      cache.set(key, list);
      return list;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

function toPlace(el, cat, center) {
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const t = el.tags || {};
  const fallback = { ev: 'EV charger', fuel: 'Fuel station', food: 'Fast food', toilet: 'Public toilet', surau: 'Surau', hospital: t.amenity === 'clinic' ? 'Clinic' : 'Hospital' }[cat];
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
    distKm: distKm(center, [lon, lat]),
  };
}
