// Bus and train trip planning on real Malaysian timetables.
//
// The timetables are the Malaysian government's free GTFS feeds on data.gov.my
// (Rapid KL rail and bus, MRT feeder, KTM Komuter and ETS, Rapid Penang, Rapid
// Kuantan, myBAS and others). Transitous (transitous.org), a free and open
// public-transport router, loads those feeds and plans door-to-door trips with
// walking and transfers. /api/transit asks it and trims the answer; the helpers
// here are shared by that function and the app.

export const TRANSIT_API = 'https://api.transitous.org/api/v1/plan';
export const TZ = 'Asia/Kuala_Lumpur';

// MOTIS (the engine behind Transitous) mode names.
const RAIL = ['RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL',
  'SUBURBAN', 'SUBWAY', 'METRO', 'TRAM', 'MONORAIL', 'CABLE_CAR', 'FUNICULAR', 'AERIAL_LIFT'];
const ROAD = ['BUS', 'COACH', 'TROLLEYBUS'];
export const MODE_FILTER = { bus: ['BUS', 'COACH'], train: ['RAIL', 'SUBWAY', 'TRAM'] };

export const isRail = (m) => RAIL.includes(m);
export const isBus = (m) => ROAD.includes(m);
export const isWalk = (m) => m === 'WALK' || m === 'FOOT';
export const isRide = (m) => !isWalk(m) && m !== 'BIKE' && m !== 'CAR' && m !== 'RENTAL';

/** Query string for Transitous. `modes` false = any public transport. */
export function planUrl({ from, to, time, arriveBy, mode, modes = true }) {
  const q = new URLSearchParams({
    fromPlace: `${from[1]},${from[0]}`,
    toPlace: `${to[1]},${to[0]}`,
    numItineraries: '5',
    arriveBy: String(Boolean(arriveBy)),
  });
  if (time) q.set('time', time);
  if (modes && MODE_FILTER[mode]) q.set('transitModes', MODE_FILTER[mode].join(','));
  return `${TRANSIT_API}?${q}`;
}

/** Google encoded polyline. Transitous says which precision it used; guess if it does not. */
export function decodePolyline(str, precision) {
  const f = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / f, lat / f]);
  }
  return out;
}

function legCoords(leg) {
  const g = leg.legGeometry;
  const ends = [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
  if (g?.points) {
    const near = (c) => Math.abs(c[0] - leg.from.lon) < 0.05 && Math.abs(c[1] - leg.from.lat) < 0.05;
    for (const p of g.precision ? [g.precision] : [7, 6, 5]) {
      try {
        const c = decodePolyline(g.points, p);
        if (c.length > 1 && near(c[0])) return c;
      } catch { /* try the next precision */ }
    }
  }
  const mid = (leg.intermediateStops || []).map((s) => [s.lon, s.lat]);
  return [ends[0], ...mid, ends[1]];
}

const stop = (p = {}) => ({
  name: p.name || '', lat: p.lat, lon: p.lon, track: p.track || '',
  dep: p.departure || null, depPlan: p.scheduledDeparture || null,
  arr: p.arrival || null, arrPlan: p.scheduledArrival || null,
});

/** Keep only what the app shows, so the response stays small on weak signal. */
export function trimPlan(json) {
  const its = (json?.itineraries || []).map((it) => ({
    duration: it.duration, start: it.startTime, end: it.endTime, transfers: it.transfers ?? 0,
    legs: (it.legs || []).map((l) => ({
      mode: l.mode,
      from: stop(l.from), to: stop(l.to),
      start: l.startTime, end: l.endTime,
      startPlan: l.scheduledStartTime || l.startTime, endPlan: l.scheduledEndTime || l.endTime,
      live: Boolean(l.realTime),
      duration: l.duration, distance: l.distance ?? null,
      line: l.routeShortName || l.displayName || '', lineName: l.routeLongName || '',
      headsign: l.headsign || '', agency: l.agencyName || '',
      color: l.routeColor ? `#${String(l.routeColor).replace('#', '')}` : '',
      textColor: l.routeTextColor ? `#${String(l.routeTextColor).replace('#', '')}` : '',
      stops: (l.intermediateStops || []).length,
      coords: legCoords(l).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]),
    })),
  }));
  return { itineraries: its };
}

/** Does this trip fit the chosen tab? Train trips use a train; bus trips use a bus and no train. */
export function fitsMode(it, mode) {
  const rides = it.legs.filter((l) => isRide(l.mode));
  if (!rides.length) return false;
  if (mode === 'train') return rides.some((l) => isRail(l.mode));
  if (mode === 'bus') return rides.every((l) => isBus(l.mode));
  return true;
}

const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Shape a trip like a driving route so the hazard scan and the map can use it. */
export function toRoute(it) {
  const coords = it.legs.flatMap((l) => l.coords);
  let distance = 0;
  for (let i = 1; i < coords.length; i++) distance += km(coords[i - 1], coords[i]) * 1000;
  return {
    transit: true, coords, distance, duration: it.duration,
    start: it.start, end: it.end, transfers: it.transfers, legs: it.legs, steps: [],
    walkSec: it.legs.filter((l) => isWalk(l.mode)).reduce((s, l) => s + (l.duration || 0), 0),
  };
}

export async function getTransit({ from, to, mode, time, arriveBy }, signal) {
  const q = new URLSearchParams({ from: `${from[1]},${from[0]}`, to: `${to[1]},${to[0]}`, mode });
  if (time) q.set('time', time);
  if (arriveBy) q.set('arriveBy', '1');
  const res = await fetch(`/api/transit?${q}`, { signal });
  if (!res.ok) throw new Error(`Transit ${res.status}`);
  const json = await res.json();
  const fit = json.itineraries.filter((it) => fitsMode(it, mode));
  if (!fit.length) throw Object.assign(new Error('No trip found'), { code: 'none' });
  return fit.map(toRoute);
}

/** "08:12" in Malaysian time, whatever the phone's time zone. */
export function clock(iso, lang) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(lang === 'bm' ? 'ms-MY' : 'en-MY', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

/** Minutes late (+) or early (-) against the timetable, when live data says so. */
export function delayMin(actual, planned) {
  if (!actual || !planned) return 0;
  return Math.round((new Date(actual) - new Date(planned)) / 60000);
}
