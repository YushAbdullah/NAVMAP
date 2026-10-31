// Vercel serverless function: GET /api/news
// Reads public environment and nature news feeds (Malaysia + world) server-side,
// so the browser avoids CORS limits, and caches the result at the edge for 15 minutes.
import { fetchNews } from '../src/lib/news-core.js';

export default async function handler(req, res) {
  try {
    const data = await fetchNews(fetch);
    res.setHeader('Cache-Control', data.items.length ? 's-maxage=900, stale-while-revalidate=3600' : 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(data.items.length ? 200 : 502).json(data);
  } catch (err) {
    res.status(502).json({ items: [], feedsOk: 0, message: String(err?.message || err) });
  }
}
