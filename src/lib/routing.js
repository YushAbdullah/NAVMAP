// Driving directions via OSRM. The public demo server is fine for testing;
// for real public traffic, self-host OSRM or switch to a paid provider (see README).
const OSRM = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

export async function getRoutes(from, to, signal) {
  const url = `${OSRM}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.message || 'No route found');
  return json.routes.map((r) => ({
    distance: r.distance, duration: r.duration,
    coords: r.geometry.coordinates,
    via: r.legs[0]?.summary || '',
    steps: r.legs.flatMap((l) => l.steps).map((s) => ({
      type: s.maneuver.type, modifier: s.maneuver.modifier || '', name: s.name || s.ref || '',
      distance: s.distance, duration: s.duration, location: s.maneuver.location,
      exit: s.maneuver.exit,
    })),
  }));
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
