// Hazards NAVMAP pins on the map by itself, without anyone reporting them.
// Live conditions come from Open-Meteo (free, no key) on a grid over the map view and along
// the route: thunderstorms, heavy rain, strong gusts, thick fog, extreme heat and haze.
// Official MetMalaysia warnings that only name states get a pin on each state they name.
import { distKm, MY_BBOX } from './geo.js';
import { alertStates, isMarine } from './alert-format.js';

// Thresholds. Rain rates follow MetMalaysia's heavy rain scale (about 7.6 mm/h and up is heavy).
export const RULES = {
  heavyRainMm: 7.6,     // mm in the last hour
  gustKmh: 60,          // wind gusts
  fogM: 1000,           // visibility in metres
  heatC: 37,            // air temperature
  hazeAqi: 151,         // US AQI "Unhealthy" and worse
  hazeDangerAqi: 201,
};

const TYPES = {
  storm: { icon: 'storm', en: 'Thunderstorm', bm: 'Ribut petir' },
  heavy_rain: { icon: 'heavyrain', en: 'Heavy rain', bm: 'Hujan lebat' },
  wind: { icon: 'wind', en: 'Strong wind', bm: 'Angin kencang' },
  fog: { icon: 'fog', en: 'Thick fog', bm: 'Kabus tebal' },
  heat: { icon: 'sun', en: 'Extreme heat', bm: 'Panas melampau' },
  haze: { icon: 'haze', en: 'Haze', bm: 'Jerebu' },
};
const SEV_RANK = { danger: 0, warning: 1, info: 2 };
const LIFE_MS = 45 * 60e3; // a detected hazard disappears if the next scans stop seeing it

const r2 = (v) => Math.round(v * 20) / 20; // ~5 km grid, the same one the weather card uses
const inMy = ([lon, lat]) => lon >= MY_BBOX[0] && lon <= MY_BBOX[2] && lat >= MY_BBOX[1] && lat <= MY_BBOX[3];

/** Evenly spaced points over a bounding box [w, s, e, n], at most n×n, never closer than ~5 km. */
export function gridPoints([w, s, e, n], size = 5) {
  const cols = Math.max(1, Math.min(size, Math.round((e - w) / 0.05) + 1));
  const rows = Math.max(1, Math.min(size, Math.round((n - s) / 0.05) + 1));
  const pts = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const lon = cols === 1 ? (w + e) / 2 : w + ((e - w) * j) / (cols - 1);
      const lat = rows === 1 ? (s + n) / 2 : s + ((n - s) * i) / (rows - 1);
      pts.push([lon, lat]);
    }
  }
  return pts;
}

/** Hazards at one point from Open-Meteo's current values. Pure, so it is easy to test. */
export function classify(cur = {}, aqi = null) {
  const out = [];
  const code = Number(cur.weather_code);
  const rain = cur.precipitation ?? cur.rain ?? 0;
  if (code >= 95) out.push({ type: 'storm', severity: code >= 96 || rain >= RULES.heavyRainMm ? 'danger' : 'warning', value: rain > 0 ? `${rain.toFixed(1)} mm/h` : '' });
  else if (code === 65 || code === 82 || rain >= RULES.heavyRainMm) out.push({ type: 'heavy_rain', severity: rain >= 2 * RULES.heavyRainMm ? 'danger' : 'warning', value: `${(rain || 0).toFixed(1)} mm/h` });
  const gust = cur.wind_gusts_10m;
  if (gust != null && gust >= RULES.gustKmh) out.push({ type: 'wind', severity: gust >= 90 ? 'danger' : 'warning', value: `${Math.round(gust)} km/h` });
  const vis = cur.visibility;
  // fog: a fog code, or very low visibility without rain (rain already has its own pin)
  if (vis != null && vis < RULES.fogM && (code === 45 || code === 48 || !(rain > 0))) out.push({ type: 'fog', severity: vis < 200 ? 'danger' : 'warning', value: `${Math.round(vis)} m` });
  const temp = cur.temperature_2m;
  if (temp != null && temp >= RULES.heatC) out.push({ type: 'heat', severity: temp >= 40 ? 'danger' : 'warning', value: `${Math.round(temp)}°C` });
  if (aqi != null && aqi >= RULES.hazeAqi) out.push({ type: 'haze', severity: aqi >= RULES.hazeDangerAqi ? 'danger' : 'warning', value: `AQI ${Math.round(aqi)}` });
  return out;
}

const DESC = {
  storm: ['Lightning and heavy rain detected. Slow down and keep your distance.', 'Kilat dan hujan lebat dikesan. Perlahankan kenderaan dan jaga jarak.'],
  heavy_rain: ['Heavy rain right now. Roads may be slippery or flooded.', 'Hujan lebat sekarang. Jalan mungkin licin atau dinaiki air.'],
  wind: ['Strong gusts. Watch for fallen trees, take care on bridges and on a motorcycle.', 'Tiupan angin kuat. Awas pokok tumbang, berhati-hati di jambatan dan atas motosikal.'],
  fog: ['Low visibility. Use your headlights and slow down.', 'Jarak penglihatan rendah. Pasang lampu dan perlahankan kenderaan.'],
  heat: ['Very hot. Drink water and do not leave anyone in a parked car.', 'Sangat panas. Minum air dan jangan tinggalkan sesiapa dalam kereta.'],
  haze: ['Unhealthy air. Close windows and set the air-con to recirculate.', 'Udara tidak sihat. Tutup tingkap dan guna mod udara dalam.'],
};

function toAlert(h, [lon, lat], spacingKm, at) {
  const ty = TYPES[h.type];
  return {
    id: `auto-${h.type}-${r2(lat)},${r2(lon)}`,
    kind: 'auto', autoType: h.type, icon: ty.icon, severity: h.severity,
    title: ty.en, title_bm: ty.bm,
    place: '',
    desc: [h.value, DESC[h.type][0]].filter(Boolean).join(' · '),
    desc_bm: [h.value, DESC[h.type][1]].filter(Boolean).join(' · '),
    lat, lon,
    radiusKm: Math.max(2, Math.min(8, spacingKm / 2)),
    time: new Date(at).toISOString(),
    expiresAt: new Date(at + LIFE_MS).toISOString(),
    source: 'NAVMAP auto-detect · Open-Meteo',
  };
}

/** Keep the worst of same-type hazards that sit within `km` of each other, so one storm is one pin. */
export function mergeNearby(list, km) {
  const sorted = [...list].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const kept = [];
  for (const a of sorted) {
    if (kept.some((k) => k.autoType === a.autoType && distKm([k.lon, k.lat], [a.lon, a.lat]) < km)) continue;
    kept.push(a);
  }
  return kept;
}

const cache = new Map(); // "lat,lon" -> { at, cur, aqi }
const CACHE_MS = 10 * 60e3;

/**
 * Detected hazards at the given points ([lon, lat], Malaysia only, at most ~40).
 * spacingKm = roughly how far apart the points are, which sets each pin's radius.
 */
export async function scanPoints(points, spacingKm = 10, { signal, now = Date.now() } = {}) {
  const uniq = [...new Map(points.filter(inMy).map((p) => [`${r2(p[1])},${r2(p[0])}`, [r2(p[0]), r2(p[1])]])).entries()].slice(0, 40);
  const need = uniq.filter(([k]) => !(cache.get(k) && now - cache.get(k).at < CACHE_MS));
  if (need.length) {
    const lat = need.map(([, p]) => p[1]).join(','), lon = need.map(([, p]) => p[0]).join(',');
    const fq = new URLSearchParams({ latitude: lat, longitude: lon, timezone: 'Asia/Kuala_Lumpur', current: 'weather_code,precipitation,wind_gusts_10m,visibility,temperature_2m' });
    const aq = new URLSearchParams({ latitude: lat, longitude: lon, timezone: 'Asia/Kuala_Lumpur', current: 'us_aqi' });
    const arr = (d) => (Array.isArray(d) ? d : [d]);
    const [f, a] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${fq}`, { signal }).then((r) => { if (!r.ok) throw new Error('weather'); return r.json(); }),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${aq}`, { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const fs = arr(f), as = a ? arr(a) : [];
    need.forEach(([k], i) => cache.set(k, { at: now, cur: fs[i]?.current || {}, aqi: as[i]?.current?.us_aqi ?? null }));
  }
  const out = [];
  for (const [k, p] of uniq) {
    const c = cache.get(k);
    if (!c) continue;
    for (const h of classify(c.cur, c.aqi)) out.push(toAlert(h, p, spacingKm, c.at));
  }
  return mergeNearby(out, Math.max(4, spacingKm * 1.2));
}

/** Add fresh detections to what we already have, dropping ones that expired. */
export function mergeAuto(old, fresh, now = Date.now()) {
  const map = new Map(old.filter((a) => new Date(a.expiresAt).getTime() > now).map((a) => [a.id, a]));
  for (const a of fresh) map.set(a.id, a);
  return mergeNearby([...map.values()], 4);
}

// Rough centre of each state, for official warnings that name states but give no coordinates.
export const STATE_CENTRES = {
  Perlis: [100.2, 6.47], Kedah: [100.65, 5.95], Penang: [100.33, 5.4], Perak: [101.0, 4.6],
  Selangor: [101.45, 3.25], 'Kuala Lumpur': [101.69, 3.14], Putrajaya: [101.69, 2.93], 'N. Sembilan': [102.15, 2.75],
  Melaka: [102.3, 2.25], Johor: [103.35, 1.95], Pahang: [102.75, 3.75], Terengganu: [103.0, 5.0],
  Kelantan: [102.1, 5.3], Sabah: [116.9, 5.4], Sarawak: [113.0, 2.6], Labuan: [115.24, 5.3],
};

/** One map pin per state for each official weather warning that only names states. */
export function statePins(alerts) {
  const out = [];
  for (const a of alerts) {
    if (a.kind !== 'weather' || a.lat != null) continue;
    const text = `${a.title || ''} ${a.desc || ''}`;
    const states = alertStates(text);
    if (!states.length && isMarine(text)) continue;
    for (const s of states) {
      const c = STATE_CENTRES[s];
      if (c) out.push({ ...a, id: `${a.id}@${s}`, parentId: a.id, lat: c[1], lon: c[0], place: s, radiusKm: 0, statePin: true });
    }
  }
  return out;
}
