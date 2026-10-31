// Vercel serverless function: GET /api/alerts
// Fetches Malaysia's official open-data feeds server-side (avoids browser CORS limits),
// normalises them, and caches the result at the edge for 5 minutes.
import { fetchGovAlerts } from '../src/lib/alerts-core.js';

export default async function handler(req, res) {
  try {
    const data = await fetchGovAlerts(fetch);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(data.live ? 200 : 502).json(data);
  } catch (err) {
    res.status(502).json({ alerts: [], errors: ['all'], live: false, message: String(err?.message || err) });
  }
}
