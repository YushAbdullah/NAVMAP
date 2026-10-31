// Vercel serverless function: community weather / hazard pins.
//   GET    /api/pins            -> all active pins
//   POST   /api/pins {type,lat,lon}
//   DELETE /api/pins?id=...     -> only the device that created the pin can remove it
// Storage: Upstash Redis (free tier). Connect it in Vercel → Storage → Upstash for Redis;
// Vercel then sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).
import { createHash, randomBytes } from 'node:crypto';
import { PIN_BY_ID } from '../src/lib/pin-types.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'navmap:pins';
const MAX_PINS = 5000;
const PER_HOUR = 20;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const publicPin = (p, owner) => ({ id: p.id, type: p.type, lat: p.lat, lon: p.lon, createdAt: p.createdAt, expiresAt: p.expiresAt, mine: !!owner && p.owner === owner });

async function activePins() {
  const flat = (await redis('HGETALL', KEY)) || [];
  const now = Date.now();
  const pins = [], dead = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const p = JSON.parse(flat[i + 1]);
      if (new Date(p.expiresAt).getTime() > now) pins.push(p); else dead.push(flat[i]);
    } catch { dead.push(flat[i]); }
  }
  if (dead.length) redis('HDEL', KEY, ...dead).catch(() => {});
  return pins;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Health check: /api/pins?status=1 always answers 200 so setup problems are easy to see.
  if (req.method === 'GET' && req.query?.status) {
    let redisOk = false, error = null;
    if (URL_ && TOKEN) { try { redisOk = (await redis('PING')) === 'PONG'; } catch (e) { error = String(e.message || e); } }
    res.status(200).json({
      configured: !!(URL_ && TOKEN), redisOk, error,
      env: ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'KV_URL'].filter((k) => !!process.env[k]),
    });
    return;
  }
  if (!URL_ || !TOKEN) { res.status(503).json({ configured: false, pins: [] }); return; }
  const deviceToken = req.headers['x-navmap-token'];
  const owner = deviceToken && deviceToken !== 'anon' ? sha(`owner:${deviceToken}`) : null;
  try {
    if (req.method === 'GET') {
      const pins = await activePins();
      res.status(200).json({ configured: true, pins: pins.map((p) => publicPin(p, owner)) });
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const t = PIN_BY_ID[body.type];
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!t || !owner || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 0 || lat > 8 || lon < 99 || lon > 120) {
        res.status(400).json({ configured: true, error: 'Pins must be inside Malaysia' });
        return;
      }
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const rlKey = `navmap:rl:${sha(`ip:${ip}`).slice(0, 24)}`;
      const n = await redis('INCR', rlKey);
      if (n === 1) await redis('EXPIRE', rlKey, 3600);
      if (n > PER_HOUR) { res.status(429).json({ configured: true, error: 'Too many pins, try again later' }); return; }
      if ((await redis('HLEN', KEY)) >= MAX_PINS) await activePins(); // prune
      const now = Date.now();
      const p = {
        id: randomBytes(6).toString('hex'), type: body.type,
        lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + t.hours * 3600e3).toISOString(), owner,
      };
      await redis('HSET', KEY, p.id, JSON.stringify(p));
      res.status(201).json({ configured: true, pin: publicPin(p, owner) });
      return;
    }
    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const raw = id && (await redis('HGET', KEY, id));
      if (!raw) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
      const p = JSON.parse(raw);
      if (!owner || p.owner !== owner) { res.status(403).json({ configured: true, error: 'Only the person who pinned it can remove it' }); return; }
      await redis('HDEL', KEY, id);
      res.status(200).json({ configured: true, ok: true });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ configured: true, error: String(err?.message || err) });
  }
}
