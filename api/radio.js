// Vercel serverless function: GET /api/radio
// Malaysian radio stations from the free, open Radio Browser directory (radio-browser.info, public domain data).
// Only HTTPS streams that passed Radio Browser's last check are kept, so they play on navmap.vercel.app.
// NAVMAP never hosts or relays audio: the browser plays each station's own public stream.
import { fetchStations } from '../src/lib/radio-core.js';

export default async function handler(req, res) {
  try {
    const stations = await fetchStations(fetch);
    res.setHeader('Cache-Control', stations.length ? 's-maxage=43200, stale-while-revalidate=86400' : 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(stations.length ? 200 : 502).json({ stations });
  } catch (err) {
    res.status(502).json({ stations: [], message: String(err?.message || err) });
  }
}
