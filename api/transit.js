// Vercel serverless function: GET /api/transit?from=3.13,101.68&to=3.15,101.71&mode=train[&time=ISO][&arriveBy=1]
// Plans a bus or train trip on the free Malaysian GTFS timetables (data.gov.my) through Transitous,
// and returns a trimmed answer. Cached at the edge for a minute so a busy route is not asked twice.
import { planUrl, trimPlan, MODE_FILTER } from '../src/lib/transit.js';

const UA = 'NAVMAP/1.0 (+https://navmap.vercel.app; muhdyusry.abdullah@gmail.com)';
const inMY = (lat, lon) => lat > -2 && lat < 10 && lon > 97 && lon < 122;
const pt = (s) => {
  const [lat, lon] = String(s || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && inMY(lat, lon) ? [lon, lat] : null;
};

async function ask(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
}

export default async function handler(req, res) {
  const from = pt(req.query.from), to = pt(req.query.to);
  const mode = req.query.mode;
  const time = req.query.time && !Number.isNaN(Date.parse(req.query.time)) ? new Date(req.query.time).toISOString() : '';
  if (!from || !to || !MODE_FILTER[mode]) {
    res.status(400).json({ error: 'from, to (lat,lon within Malaysia) and mode (bus|train) are required' });
    return;
  }
  const opts = { from, to, mode, time, arriveBy: req.query.arriveBy === '1' };
  try {
    let r = await ask(planUrl(opts));
    // An older router may not know a mode name: ask for any transit and let the app filter.
    if (!r.ok && r.status >= 400 && r.status < 500) r = await ask(planUrl({ ...opts, modes: false }));
    if (!r.ok) throw new Error(`Planner ${r.status}`);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ ...trimPlan(r.json), source: 'Transitous · data.gov.my GTFS' });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(504).json({ error: String(err?.message || err) });
  }
}
