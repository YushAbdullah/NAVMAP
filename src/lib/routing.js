// Driving directions via OSRM. The public demo server is fine for testing;
// for real public traffic, self-host OSRM or switch to a paid provider (see README).
const OSRM = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

/**
 * opts.noToll keeps off expressways (OSRM exclude=motorway: the public server does not support exclude=toll,
 * and in Malaysia the motorways are the tolled expressways). opts.via routes through a point.
 */
export async function getRoutes(from, to, signal, opts = {}) {
  const pts = [from, opts.via, to].filter(Boolean).map((p) => `${p[0]},${p[1]}`).join(';');
  const url = `${OSRM}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&alternatives=${opts.via ? 'false' : 'true'}${opts.noToll ? '&exclude=motorway' : ''}`;
  const res = await fetch(url, { signal });
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
