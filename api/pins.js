// Vercel serverless function: community weather / hazard pins.
//   GET    /api/pins                         -> all active pins (with confirm / gone counts)
//   POST   /api/pins {type,lat,lon}          -> new pin (or a confirmation if the same type is already pinned within 300 m)
//   POST   /api/pins {id, vote:'confirm'|'gone'} -> "Still there" / "Gone"
//   DELETE /api/pins?id=...                  -> only the device that created the pin can remove it
// Storage: Upstash Redis (free tier). Connect it in Vercel → Storage → Upstash for Redis;
// Vercel then sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).
//
// Trust and abuse limits, with no login (PDPA: we keep no name, account or raw IP):
// - "Still there" pushes the expiry out (capped per type, see pin-types.js); enough "Gone" votes delete the pin.
// - One vote per device per pin, stored as a hash of (pin id + device code) that expires with the pin,
//   so votes on different pins cannot be linked to each other or to a person.
// - At most 3 votes per network (hashed IP) on one pin, 60 votes and 20 new pins per network per hour,
//   and 10 live pins per device.
import { createHash, randomBytes } from 'node:crypto';
import { PIN_BY_ID } from '../src/lib/pin-types.js';
import { shouldHide, confirmedExpiry, SAME_SPOT_M } from '../src/lib/pin-trust.js';
import { distKm } from '../src/lib/geo.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'navmap:pins';
const MAX_PINS = 5000;
const PER_HOUR = 20;          // new pins per network per hour
const VOTES_PER_HOUR = 60;    // votes per network per hour
const VOTES_PER_IP_PIN = 3;   // votes per network on one pin (shared mobile networks need a few)
const LIVE_PER_DEVICE = 10;   // live pins one device may have at once

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const publicPin = (p, owner) => ({
  id: p.id, type: p.type, lat: p.lat, lon: p.lon, createdAt: p.createdAt, expiresAt: p.expiresAt,
  confirms: p.confirms || 0, gone: p.gone || 0, lastConfirmedAt: p.lastConfirmedAt || null,
  mine: !!owner && p.owner === owner,
});

async function activePins() {
  const flat = (await redis('HGETALL', KEY)) || [];
  const now = Date.now();
  const pins = [], dead = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const p = JSON.parse(flat[i + 1]);
      if (new Date(p.expiresAt).getTime() > now && !shouldHide(p)) pins.push(p); else dead.push(flat[i]);
    } catch { dead.push(flat[i]); }
  }
  if (dead.length) dropPins(dead).catch(() => {});
  return pins;
}

async function dropPins(ids) {
  await redis('HDEL', KEY, ...ids);
  await redis('DEL', ...ids.flatMap((id) => [`navmap:pinv:${id}`, `navmap:pinvip:${id}`]));
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

/** Fixed-window counter; true when the limit is passed. */
async function overLimit(key, limit, seconds) {
  const n = await redis('INCR', key);
  if (n === 1) await redis('EXPIRE', key, seconds);
  return n > limit;
}

const lifeLeftSec = (p) => {
  const t = PIN_BY_ID[p.type] || { hours: 2, maxHours: 4 };
  const end = new Date(p.createdAt).getTime() + (t.maxHours || t.hours) * 3600e3;
  return Math.max(60, Math.ceil((end - Date.now()) / 1000) + 3600);
};

/**
 * Record one device's vote on a pin. Returns { status, body }.
 * A device can change its vote; the counts follow.
 */
async function vote(p, choice, deviceToken, owner, ip) {
  if (p.owner === owner) {
    if (choice === 'gone') { await dropPins([p.id]); return { status: 200, body: { removed: true } }; }
    return { status: 400, body: { error: 'own' } };
  }
  const vKey = `navmap:pinv:${p.id}`;
  const voter = sha(`vote:${p.id}:${deviceToken}`).slice(0, 32);
  const prev = await redis('HGET', vKey, voter);
  if (prev === choice) return { status: 200, body: { pin: publicPin(p, owner), myVote: choice } };
  if (!prev) {
    const ipKey = `navmap:pinvip:${p.id}`;
    const ipField = sha(`ip:${p.id}:${ip}`).slice(0, 24);
    const n = await redis('HINCRBY', ipKey, ipField, 1);
    await redis('EXPIRE', ipKey, lifeLeftSec(p));
    if (n > VOTES_PER_IP_PIN) return { status: 429, body: { error: 'rate' } };
  }
  await redis('HSET', vKey, voter, choice);
  await redis('EXPIRE', vKey, lifeLeftSec(p));
  // re-read just before writing so two votes at once rarely overwrite each other
  const raw = await redis('HGET', KEY, p.id);
  if (!raw) return { status: 200, body: { removed: true } };
  const cur = JSON.parse(raw);
  cur.confirms = cur.confirms || 0; cur.gone = cur.gone || 0;
  if (prev === 'confirm') cur.confirms = Math.max(0, cur.confirms - 1);
  if (prev === 'gone') cur.gone = Math.max(0, cur.gone - 1);
  if (choice === 'confirm') {
    cur.confirms++;
    cur.lastConfirmedAt = new Date().toISOString();
    cur.expiresAt = confirmedExpiry(cur);
  } else cur.gone++;
  if (shouldHide(cur)) { await dropPins([cur.id]); return { status: 200, body: { removed: true, myVote: choice } }; }
  await redis('HSET', KEY, cur.id, JSON.stringify(cur));
  return { status: 200, body: { pin: publicPin(cur, owner), myVote: choice } };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Health check: /api/pins?status=1 always answers 200 so setup problems are easy to see.
  if (req.method === 'GET' && req.query?.status) {
    let redisOk = false, error = null;
    let pinCount = null;
    if (URL_ && TOKEN) {
      try { redisOk = (await redis('PING')) === 'PONG'; pinCount = (await activePins()).length; } catch (e) { error = String(e.message || e); }
    }
    res.status(200).json({
      configured: !!(URL_ && TOKEN), redisOk, pinCount, error,
      env: ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'KV_URL'].filter((k) => !!process.env[k]),
    });
    return;
  }
  if (!URL_ || !TOKEN) { res.status(503).json({ configured: false, pins: [] }); return; }
  const rawToken = req.headers['x-navmap-token'];
  const deviceToken = typeof rawToken === 'string' && /^[0-9a-f]{16,64}$/.test(rawToken) ? rawToken : null;
  const owner = deviceToken ? sha(`owner:${deviceToken}`) : null;
  try {
    if (req.method === 'GET') {
      const pins = await activePins();
      res.status(200).json({ configured: true, pins: pins.map((p) => publicPin(p, owner)) });
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const ip = clientIp(req);
      const ipHash = sha(`ip:${ip}`).slice(0, 24);

      // "Still there" / "Gone"
      if (body.vote !== undefined) {
        if (!owner || !['confirm', 'gone'].includes(body.vote) || typeof body.id !== 'string') {
          res.status(400).json({ configured: true, error: 'bad' }); return;
        }
        const raw = await redis('HGET', KEY, body.id);
        const p = raw && JSON.parse(raw);
        if (!p || new Date(p.expiresAt).getTime() <= Date.now()) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
        if (await overLimit(`navmap:rlv:${ipHash}`, VOTES_PER_HOUR, 3600)) { res.status(429).json({ configured: true, error: 'rate' }); return; }
        const out = await vote(p, body.vote, deviceToken, owner, ip);
        res.status(out.status).json({ configured: true, ...out.body });
        return;
      }

      // New pin
      const t = PIN_BY_ID[body.type];
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!t || !owner || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 0 || lat > 8 || lon < 99 || lon > 120) {
        res.status(400).json({ configured: true, error: 'Pins must be inside Malaysia' });
        return;
      }
      if (await overLimit(`navmap:rl:${ipHash}`, PER_HOUR, 3600)) { res.status(429).json({ configured: true, error: 'Too many pins, try again later' }); return; }
      const live = await activePins();
      // Same thing already pinned close by: count it as a confirmation instead of stacking pins.
      const same = live
        .filter((x) => x.type === body.type && distKm([x.lon, x.lat], [lon, lat]) * 1000 <= SAME_SPOT_M)
        .sort((a, b) => distKm([a.lon, a.lat], [lon, lat]) - distKm([b.lon, b.lat], [lon, lat]))[0];
      if (same) {
        if (same.owner === owner) { res.status(200).json({ configured: true, merged: true, pin: publicPin(same, owner) }); return; }
        const out = await vote(same, 'confirm', deviceToken, owner, ip);
        res.status(out.status).json({ configured: true, merged: true, ...out.body });
        return;
      }
      if (live.filter((x) => x.owner === owner).length >= LIVE_PER_DEVICE) { res.status(429).json({ configured: true, error: 'Too many pins, try again later' }); return; }
      if (live.length >= MAX_PINS) { res.status(503).json({ configured: true, error: 'Pin board is full, try again later' }); return; }
      const now = Date.now();
      const p = {
        id: randomBytes(6).toString('hex'), type: body.type,
        lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + t.hours * 3600e3).toISOString(), owner,
        confirms: 0, gone: 0, lastConfirmedAt: null,
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
      await dropPins([id]);
      res.status(200).json({ configured: true, ok: true });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ configured: true, error: String(err?.message || err) });
  }
}
