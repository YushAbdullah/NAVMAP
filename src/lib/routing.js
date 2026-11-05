// Driving directions via OSRM. The public demo server is fine for testing;
// for real public traffic, self-host OSRM or switch to a paid provider (see README).
const OSRM = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

/** A fetch that gives up after `ms`, so a slow server never leaves the driver waiting on an old route. */
function timedSignal(signal, ms) {
  const own = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : null;
  if (!own) return signal;
  if (!signal) return own;
  return AbortSignal.any ? AbortSignal.any([signal, own]) : signal;
}

/**
 * Car routes from OSRM. opts.via routes through a point. The public OSRM server cannot avoid tolls
 * (it rejects exclude=toll and exclude=motorway with HTTP 400), so toll-free routes come from getNoTollRoutes.
 */
export async function getRoutes(from, to, signal, opts = {}) {
  if (opts.noToll) return getNoTollRoutes(from, to, signal, opts);
  const pts = [from, opts.via, to].filter(Boolean).map((p) => `${p[0]},${p[1]}`).join(';');
  // A known heading (when rerouting a moving car) makes OSRM start on the road in the direction of travel, not the other carriageway.
  const n = opts.via ? 3 : 2;
  const bearings = Number.isFinite(opts.bearing) ? `&bearings=${Math.round((opts.bearing + 360) % 360)},60${';'.repeat(n - 1)}` : '';
  const url = `${OSRM}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&alternatives=${opts.via || opts.single ? 'false' : 'true'}${bearings}`;
  const res = await fetch(url, { signal: timedSignal(signal, opts.timeoutMs || 15000) });
  if (!res.ok) throw new Error(`Routing ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.message || 'No route found');
  return json.routes.map((r) => ({
    distance: r.distance, duration: r.duration,
    tolls: tollStretches(r.legs.flatMap((l) => l.steps)),
    coords: r.geometry.coordinates,
    via: r.legs[0]?.summary || '',
    steps: r.legs.flatMap((l) => l.steps).map((s) => ({
      type: s.maneuver.type, modifier: s.maneuver.modifier || '', name: s.name || s.ref || '',
      distance: s.distance, duration: s.duration, location: s.maneuver.location,
      exit: s.maneuver.exit,
    })),
  }));
}

// Valhalla (free FOSSGIS server, no key) can really keep off toll roads, which OSRM cannot.
const VALHALLA = import.meta.env?.VITE_VALHALLA_URL || 'https://valhalla1.openstreetmap.de';

/** Valhalla shapes are Google polylines with 6 decimals. Returns [[lon, lat], …]. */
export function decodePolyline6(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

// Valhalla maneuver type number -> the OSRM-style { type, modifier } the rest of the app speaks.
const VTYPE = {
  1: ['depart', ''], 2: ['depart', 'right'], 3: ['depart', 'left'],
  4: ['arrive', ''], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  7: ['new name', 'straight'], 8: ['continue', 'straight'],
  9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'],
  12: ['turn', 'uturn'], 13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'],
  17: ['on ramp', 'straight'], 18: ['on ramp', 'right'], 19: ['on ramp', 'left'],
  20: ['off ramp', 'right'], 21: ['off ramp', 'left'],
  22: ['fork', 'straight'], 23: ['fork', 'slight right'], 24: ['fork', 'slight left'],
  25: ['merge', 'straight'], 26: ['roundabout', ''], 27: ['continue', 'straight'],
  28: ['continue', 'straight'], 29: ['continue', 'straight'],
  37: ['merge', 'slight right'], 38: ['merge', 'slight left'],
};

/** One Valhalla trip as the same route object getRoutes returns. */
export function fromValhalla(trip) {
  const coords = [], steps = [], pseudo = [];
  for (const leg of trip.legs || []) {
    const shape = decodePolyline6(leg.shape || '');
    const base = coords.length;
    coords.push(...shape);
    for (const m of leg.maneuvers || []) {
      const [type, modifier] = VTYPE[m.type] || ['turn', 'straight'];
      if (m.type === 27) continue; // leaving the roundabout is part of its "take exit N" instruction
      const name = (m.street_names || m.begin_street_names || [])[0] || '';
      const refs = [...(m.street_names || []), ...(m.begin_street_names || [])].join(';');
      const step = {
        type, modifier, name,
        distance: (m.length || 0) * 1000, duration: m.time || 0,
        location: coords[base + (m.begin_shape_index || 0)] || shape[0],
        exit: m.roundabout_exit_count,
      };
      if (type === 'arrive' && steps.length && leg !== trip.legs[trip.legs.length - 1]) continue;
      steps.push(step);
      pseudo.push({ distance: step.distance, ref: refs, maneuver: { location: step.location }, intersections: m.toll ? [{ classes: ['toll'] }] : [] });
    }
  }
  return {
    distance: (trip.summary?.length || 0) * 1000, duration: trip.summary?.time || 0,
    tolls: tollStretches(pseudo), coords,
    via: steps.filter((s) => s.name).sort((a, b) => b.distance - a.distance).slice(0, 2).map((s) => s.name).join(', '),
    steps,
  };
}

/**
 * Routes that keep off toll roads. Valhalla avoids roads tagged toll=yes, but some Malaysian expressways
 * (e.g. LDP E11) only have toll plazas tagged, so when every result still uses an E-numbered expressway we ask
 * again keeping off motorways too (in Malaysia nearly all motorways are tolled). Throws when unreachable.
 */
export async function getNoTollRoutes(from, to, signal, opts = {}) {
  const ask = async (auto) => {
    const body = {
      locations: [from, to].map(([lon, lat], i) => (i === 0 && Number.isFinite(opts.bearing)
        ? { lon, lat, heading: Math.round((opts.bearing + 360) % 360), heading_tolerance: 60 } : { lon, lat })),
      costing: 'auto',
      costing_options: { auto },
      units: 'kilometers', alternates: opts.single ? 0 : 1, directions_type: 'maneuvers',
    };
    const res = await fetch(`${VALHALLA}/route?json=${encodeURIComponent(JSON.stringify(body))}`, { signal: timedSignal(signal, opts.timeoutMs || 15000) });
    if (!res.ok) throw new Error(`Routing ${res.status}`);
    const json = await res.json();
    if (!json.trip) throw new Error(json.error || 'No route found');
    return [json.trip, ...(json.alternates || []).map((a) => a.trip)].filter(Boolean).map(fromValhalla);
  };
  const first = await ask({ use_tolls: 0 });
  if (first.some((r) => !r.tolls.length)) return first;
  const strict = await ask({ use_tolls: 0, use_highways: 0 }).catch(() => []);
  return [...strict.filter((r) => !r.tolls.length), ...first];
}

/**
 * OSRM marks road segments that charge a toll ("toll" in intersection classes).
 * Returns the tolled stretches as [{ km, name }], joining consecutive tolled steps.
 */
export const isExpressway = (ref) => /(^|[;\s])E\d+/.test(ref || '');

export function tollStretches(steps) {
  const out = [];
  let cur = null;
  for (const s of steps) {
    // OSRM's toll class is often missing for Malaysia, so also go by the road number:
    // expressways are numbered E1, E11, E35… and nearly all of them charge tolls.
    const toll = (s.intersections || []).some((i) => i.classes?.includes('toll')) || isExpressway(s.ref);
    if (toll && s.distance > 0) {
      if (!cur) { cur = { km: 0, name: s.ref || s.name || '', at: s.maneuver?.location }; out.push(cur); }
      cur.km += s.distance / 1000;
    } else if (s.distance > 300) cur = null; // a short untolled link (ramp, plaza) keeps the stretch going
  }
  return out;
}

export function stepText(s, lang) {
  const bm = lang === 'bm';
  const road = s.name ? (bm ? ` ke ${s.name}` : ` onto ${s.name}`) : '';
  const dir = {
    left: bm ? 'kiri' : 'left', right: bm ? 'kanan' : 'right',
    'slight left': bm ? 'sedikit ke kiri' : 'slight left', 'slight right': bm ? 'sedikit ke kanan' : 'slight right',
    'sharp left': bm ? 'tajam ke kiri' : 'sharp left', 'sharp right': bm ? 'tajam ke kanan' : 'sharp right',
    straight: bm ? 'terus' : 'straight', uturn: bm ? 'pusing U' : 'U-turn',
  }[s.modifier] || '';
  switch (s.type) {
    case 'depart': return bm ? `Mula${s.name ? ` di ${s.name}` : ''}` : `Head out${s.name ? ` on ${s.name}` : ''}`;
    case 'arrive': return bm ? 'Anda telah tiba' : 'You have arrived';
    case 'roundabout': case 'rotary':
      return bm ? `Di bulatan, ambil susur ${s.exit || ''}${road}` : `At the roundabout, take exit ${s.exit || ''}${road}`;
    case 'merge': return bm ? `Masuk${road}` : `Merge${road}`;
    case 'on ramp': return bm ? `Ambil susur masuk${road}` : `Take the ramp${road}`;
    case 'off ramp': return bm ? `Ambil susur keluar${road}` : `Take the exit${road}`;
    case 'fork': return bm ? `Di simpang, ikut ${dir}${road}` : `At the fork, keep ${dir}${road}`;
    case 'continue': case 'new name':
      return bm ? `Teruskan${road}` : `Continue${road}`;
    default:
      if (s.modifier === 'straight') return bm ? `Terus${road}` : `Go straight${road}`;
      if (s.modifier === 'uturn') return bm ? `Buat pusingan U${road}` : `Make a U-turn${road}`;
      return bm ? `Belok ${dir}${road}` : `Turn ${dir}${road}`;
  }
}
