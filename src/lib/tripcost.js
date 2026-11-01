// Trip cost estimates: tolls, fuel, EV charging and what the same trip costs by bus, train or Grab.
// Every number here is an estimate for planning, never a quote: the app labels it that way.

// Pump prices (RM per litre). Live values come from data.gov.my weekly fuel prices via /api/fuel;
// these are only used when that cannot be reached.
export const FUEL_DEFAULT = { ron95: 2.60, budi95: 1.99, ron97: 3.20, diesel: 2.90, date: '' };

// Electricity (RM per kWh): home charging on the TNB domestic tariff, and a typical public DC fast charger.
export const EV_RATE = { home: 0.45, public: 1.30 };

export const VEHICLE_DEFAULT = { fuel: 'budi95', carL: 7.5, motoL: 2.5, evKwh: 15 };
const KEY = 'navmap.vehicle';

export function getVehicle() {
  try { return { ...VEHICLE_DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...VEHICLE_DEFAULT }; }
}
export function setVehicle(v) {
  const clean = { ...getVehicle(), ...v };
  for (const k of ['carL', 'motoL', 'evKwh']) {
    const n = Number(clean[k]);
    clean[k] = Number.isFinite(n) && n > 0 && n < 60 ? Math.round(n * 10) / 10 : VEHICLE_DEFAULT[k];
  }
  if (!['budi95', 'ron95', 'ron97', 'diesel'].includes(clean.fuel)) clean.fuel = VEHICLE_DEFAULT.fuel;
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private mode */ }
  return clean;
}

let fuelCache = null;
/** Latest pump prices from data.gov.my (cached for the session). */
export async function loadFuelPrices() {
  if (fuelCache) return fuelCache;
  try {
    const res = await fetch('/api/fuel');
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    fuelCache = { ...FUEL_DEFAULT, ...Object.fromEntries(Object.entries(j).filter(([, v]) => v != null)), live: true };
  } catch { fuelCache = { ...FUEL_DEFAULT, live: false }; }
  return fuelCache;
}

/**
 * Highway tolls. OSRM tells us which stretches are tolled; Malaysia has no free per-plaza rate data,
 * so we estimate: closed (ticketed) expressways like PLUS charge by distance, and short city highways
 * charge a flat plaza fee. Motorcycles ride free on most Malaysian highways (Penang bridges and the
 * Second Link are the exceptions), so they get RM0 with a note.
 */
export const TOLL = { perKm: 0.12, minPlaza: 1.6 };
export function tollEstimate(stretches = [], mode = 'car') {
  if (mode === 'moto') return { rm: 0, km: stretches.reduce((s, x) => s + x.km, 0), count: stretches.length };
  let rm = 0, km = 0;
  for (const s of stretches) { km += s.km; rm += Math.max(TOLL.minPlaza, s.km * TOLL.perKm); }
  return { rm: round10(rm), km, count: stretches.length };
}

/** Fuel for a trip: litres and RM. */
export function fuelEstimate(km, mode, veh, prices) {
  const per100 = mode === 'moto' ? veh.motoL : veh.carL;
  const litres = (km * per100) / 100;
  const price = prices[veh.fuel] ?? FUEL_DEFAULT[veh.fuel];
  return { litres, rm: litres * price, price, fuel: veh.fuel };
}

/** The same distance in an electric car, charged at home and at a public fast charger. */
export function evEstimate(km, veh) {
  const kwh = (km * veh.evKwh) / 100;
  return { kwh, home: kwh * EV_RATE.home, public: kwh * EV_RATE.public };
}

/**
 * Public transport fares, estimated by distance (GTFS feeds here carry no fares).
 * Rapid KL rail: from RM1.20, rising about 17 sen a km, capped near RM6.40 within the Klang Valley;
 * longer trips use an intercity rate like KTM ETS. Rapid KL buses: RM1 to RM2.50 within the city.
 */
export function transitFare(km, mode) {
  if (mode === 'train') return km <= 45 ? clamp(1.2 + 0.17 * km, 1.2, 6.4) : 0.16 * km;
  return km <= 30 ? clamp(1 + 0.08 * km, 1, 2.5) : 0.1 * km; // long trips: express bus rate
}

/** GrabCar estimate as a range: base + per km + per minute, with a busy-time upper bound. */
export function grabFare(km, min) {
  const low = Math.max(6, 2 + 0.65 * km + 0.25 * min);
  return { low, high: low * 1.6 };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round10 = (v) => Math.round(v * 10) / 10;
export const rm = (v) => `RM${v < 10 ? v.toFixed(2) : v.toFixed(v < 100 ? 1 : 0)}`;
