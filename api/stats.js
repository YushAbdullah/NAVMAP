// Vercel serverless function: anonymous public visitor counter.
//   POST /api/stats  -> count this visit, return { today, week, pins }
//   GET  /api/stats  -> return the numbers without counting
// Privacy: a visit is counted as a one-way hash of (IP + browser + today's date + server secret),
// added to a Redis HyperLogLog for that day. HyperLogLog only keeps a fuzzy count, so the
// hash cannot be read back, and the date in the hash means one day cannot be linked to the next.
// No IP, cookie, or identifier is stored. Days expire after 40 days.
import { createHash } from 'node:crypto';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|curl|wget|python|node-fetch/i;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Calendar day in Malaysia (UTC+8), so "today" resets at local midnight.
export const myDay = (ms = Date.now(), back = 0) => new Date(ms + 8 * 3600e3 - back * 86400e3).toISOString().slice(0, 10);
const dayKey = (d) => `navmap:v:${d}`;

async function activePinCount() {
  const flat = (await redis('HGETALL', 'navmap:pins')) || [];
  const now = Date.now();
  let n = 0;
  for (let i = 1; i < flat.length; i += 2) {
    try { if (new Date(JSON.parse(flat[i]).expiresAt).getTime() > now) n++; } catch { /* skip */ }
  }
  return n;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) { res.status(503).json({ configured: false }); return; }
  try {
    const today = myDay();
    const ua = String(req.headers['user-agent'] || '');
    if (req.method === 'POST' && ua && !BOT_RE.test(ua)) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const id = sha(`visit:${TOKEN}:${today}:${ip}:${ua}`).slice(0, 32);
      await redis('PFADD', dayKey(today), id);
      await redis('EXPIRE', dayKey(today), 40 * 86400);
    } else if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' }); return;
    }
    const week = Array.from({ length: 7 }, (_, i) => dayKey(myDay(Date.now(), i)));
    const [t, w, pins] = await Promise.all([redis('PFCOUNT', dayKey(today)), redis('PFCOUNT', ...week), activePinCount()]);
    res.status(200).json({ configured: true, day: today, today: t, week: w, pins });
  } catch (err) {
    res.status(502).json({ error: 'server', message: String(err?.message || err) });
  }
}
