// Place search (geocoding) via Photon (OpenStreetMap data, free, no key), limited to Malaysia.
import { MY_BBOX } from './geo.js';

export async function searchPlaces(q, near, signal) {
  const p = new URLSearchParams({ q, limit: '8', bbox: MY_BBOX.join(',') });
  if (near) { p.set('lat', near[1]); p.set('lon', near[0]); }
  const res = await fetch(`https://photon.komoot.io/api/?${p}`, { signal });
  if (!res.ok) throw new Error(`Search ${res.status}`);
  const json = await res.json();
  const seen = new Set();
  return (json.features || []).map((f) => {
    const pr = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const name = pr.name || [pr.housenumber, pr.street].filter(Boolean).join(' ') || pr.city || 'Unnamed place';
    const sub = [pr.street && pr.name ? pr.street : null, pr.district, pr.city, pr.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return { id: `${pr.osm_type}${pr.osm_id}`, name, sub, lat, lon, kind: pr.osm_value || '' };
  }).filter((r) => {
    const k = `${r.name}|${r.sub}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
