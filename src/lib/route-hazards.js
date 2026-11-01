// Hazards along a driving route: flood stations, community pins (flood, haze, landslide,
// accident...), official weather warnings for the states the route crosses, and haze
// (pollution index) sampled along the road.
import { distKm, distToLineKm } from './geo.js';
import { alertStates } from './alert-format.js';
import { aqiLabel } from './weather.js';

const NEAR_KM = 0.3;          // extra margin around an alert's own radius
const HAZE_AQI = 101;         // "Unhealthy for sensitive groups" and worse counts as haze
const SEV_RANK = { danger: 0, warning: 1, info: 2 };

/** Route coordinates thinned to at most ~max points, with distance (km) from the start. */
export function measure(coords, max = 600) {
  const stride = Math.max(1, Math.floor(coords.length / max));
  const pts = [], km = [];
  let acc = 0, prev = null;
  coords.forEach((c, i) => {
    if (i % stride && i !== coords.length - 1) return;
    if (prev) acc += distKm(prev, c);
    pts.push(c); km.push(acc); prev = c;
  });
  return { pts, km, total: acc };
}

/** Distance along the route (km) of the route point closest to p, and how far p is from it. */
export function along(m, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < m.pts.length; i++) {
    const d = distKm(p, m.pts[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return { km: m.km[best], off: bd };
}

/**
 * Alerts with a location that touch the route, ordered from the start.
 * Each hit: { a: alert, km: distance from start, off: km from the road }.
 */
export function pointHazards(m, alerts) {
  const now = Date.now();
  const hits = [];
  for (const a of alerts) {
    if (a.lat == null || a.kind === 'quake' || a.type === 'clear') continue;
    if (a.expiresAt && new Date(a.expiresAt).getTime() < now) continue;
    const p = [a.lon, a.lat];
    const reach = (a.radiusKm || 1) + NEAR_KM;
    if (distToLineKm(p, m.pts) > reach) continue;
    const { km, off } = along(m, p);
    hits.push({ a, km, off: Math.max(0, off - (a.radiusKm || 0)) });
  }
  return hits.sort((x, y) => x.km - y.km || SEV_RANK[x.a.severity] - SEV_RANK[y.a.severity]);
}

/** Evenly spaced points along the route (start and end included), with their distance. */
export function samples(m, n) {
  if (!m.pts.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = n === 1 ? 0 : (m.total * i) / (n - 1);
    let j = m.km.findIndex((k) => k >= target);
    if (j < 0) j = m.pts.length - 1;
    out.push({ p: m.pts[j], km: m.km[j] });
  }
  return out;
}

const r2 = (v) => Math.round(v * 20) / 20; // ~5 km grid, matches the weather card cache

// ---------------------------------------------------------------- haze along the route
const aqCache = new Map();
/**
 * Pollution index at points along the route (one Open-Meteo request).
 * Resolves to the worst stretch { aqi, km, level } when it is haze level, else null.
 */
export async function routeHaze(m, signal) {
  const n = Math.min(10, Math.max(2, Math.ceil(m.total / 15) + 1));
  const pts = samples(m, n);
  const key = pts.map(({ p }) => `${r2(p[1])},${r2(p[0])}`).join(';');
  const hit = aqCache.get(key);
  let values;
  if (hit && Date.now() - hit.at < 20 * 60e3) values = hit.values;
  else {
    const q = new URLSearchParams({
      latitude: pts.map(({ p }) => r2(p[1])).join(','),
      longitude: pts.map(({ p }) => r2(p[0])).join(','),
      current: 'us_aqi', timezone: 'Asia/Kuala_Lumpur',
    });
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`, { signal });
    if (!res.ok) throw new Error('air');
    const d = await res.json();
    values = (Array.isArray(d) ? d : [d]).map((x) => x?.current?.us_aqi ?? null);
    aqCache.set(key, { at: Date.now(), values });
  }
  let worst = null;
  values.forEach((aqi, i) => {
    if (aqi != null && pts[i] && (!worst || aqi > worst.aqi)) worst = { aqi, km: pts[i].km };
  });
  if (!worst || worst.aqi < HAZE_AQI) return null;
  return { ...worst, level: aqiLabel(worst.aqi) };
}

// ---------------------------------------------------------------- states the route crosses
const stateCache = new Map();
async function stateAt(p, signal) {
  const key = `${Math.round(p[1] * 10) / 10},${Math.round(p[0] * 10) / 10}`;
  if (stateCache.has(key)) return stateCache.get(key);
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${p[1]}&lon=${p[0]}&limit=1`, { signal });
  if (!res.ok) throw new Error('reverse');
  const pr = (await res.json()).features?.[0]?.properties || {};
  const name = alertStates(`${pr.state || ''} ${pr.city || ''}`)[0] || null;
  stateCache.set(key, name);
  return name;
}

/** Malaysian states the route passes through (sampled every ~40 km, at most 8 lookups). */
export async function routeStates(m, signal) {
  const n = Math.min(8, Math.max(2, Math.ceil(m.total / 40) + 1));
  const names = await Promise.all(samples(m, n).map(({ p }) => stateAt(p, signal).catch(() => null)));
  return [...new Set(names.filter(Boolean))];
}

/** Official weather warnings (no coordinates) that name a state on the route. */
export function areaWarnings(alerts, states) {
  if (!states.length) return [];
  return alerts
    .filter((a) => a.kind === 'weather' && a.lat == null)
    .map((a) => ({ a, states: alertStates(`${a.title} ${a.desc}`).filter((s) => states.includes(s)) }))
    .filter((x) => x.states.length);
}

/** Total count shown on a route button. */
export const hazardCount = (r) => (r.hits?.length || 0) + (r.haze ? 1 : 0) + (r.areas?.length || 0);
