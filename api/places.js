// Vercel serverless function: GET /api/places?cat=ev&lat=3.16&lon=101.71
// Races the public Overpass mirrors and caches the answer at the edge for a day,
// so the same ~1 km area is instant for everyone after the first request.
import { CATEGORIES, overpassQuery, raceOverpass, snap, toPlace } from '../src/lib/places.js';

export default async function handler(req, res) {
  const { cat } = req.query;
  const lat = snap(parseFloat(req.query.lat));
  const lon = snap(parseFloat(req.query.lon));
  if (!CATEGORIES[cat] || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -2 || lat > 10 || lon < 97 || lon > 122) {
    res.status(400).json({ error: 'cat, lat and lon (within Malaysia) are required' });
    return;
  }
  try {
    const json = await raceOverpass(overpassQuery(cat, lat, lon), { timeoutMs: 8500 });
    const places = json.elements.map((el) => toPlace(el, cat)).filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ places, cat, lat, lon });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(504).json({ error: String(err?.message || err) });
  }
}
