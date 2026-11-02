// Vercel serverless function: community weather / hazard pins.
//   GET    /api/pins                         -> all active pins (with confirm / gone counts)
//   POST   /api/pins {type,lat,lon}          -> new pin (or a confirmation if the same type is already pinned within 300 m)
//   POST   /api/pins {id, vote:'confirm'|'gone'} -> "Still there" / "Gone"
//   DELETE /api/pins?id=...                  -> only the device that created the pin can remove it
//   GET    /api/pins?thread=<id>             -> one pin with its community updates
//   POST   /api/pins {id, comment:{text,tag}} -> add an update (a status tag can also count as Still there / Gone)
//   POST   /api/pins {id, cid, react:'helpful'|'flag'} -> "Helpful" (toggles) or "Report"; enough reports hide the update
//   DELETE /api/pins?id=...&cid=...          -> remove your own update
//   POST   /api/pins {topic:{url,title,source}} -> start (or reuse) a discussion about a news story; the
//                                             same thread/comment/react calls work with its id
//   GET    /api/pins?config=1                -> public sign-in settings (Supabase URL + anon key) or null
// Members: an "authorization: Bearer <Supabase access token>" header makes posts show the member's
// display name and a Member badge, and lets them delete their posts from any device.
// Storage: Upstash Redis (free tier). Connect it in Vercel → Storage → Upstash for Redis;
// Vercel then sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).
//
// Trust and abuse limits, with no login (PDPA: we keep no name, account or raw IP):
// - "Still there" pushes the expiry out (capped per type, see pin-types.js); enough "Gone" votes delete the pin.
// - One vote per device per pin, stored as a hash of (pin id + device code) that expires with the pin,
//   so votes on different pins cannot be linked to each other or to a person.
// - At most 3 votes per network (hashed IP) on one pin, 60 votes and 20 new pins per network per hour,
//   and 10 live pins per device.
// - Updates: nickname from a hash of the device code (no name), links and phone numbers refused,
//   swear words masked, 20 updates per device and 60 per network per hour, 3 reports hide one.
import { createHash, randomBytes } from 'node:crypto';
import { PIN_BY_ID } from '../src/lib/pin-types.js';
import { shouldHide, confirmedExpiry, SAME_SPOT_M } from '../src/lib/pin-trust.js';
import { distKm } from '../src/lib/geo.js';
import { TAG_BY_ID, PIN_TAG_IDS, DISCUSS_TAG_IDS, cleanText, cleanName, handleFrom, newsUrlOk, plain, MAX_COMMENTS, FLAGS_TO_HIDE } from '../src/lib/community.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'navmap:pins';
const TKEY = 'navmap:topics';     // news discussions
const TOPIC_DAYS = 7;             // a discussion lives 7 days after its last update ...
const TOPIC_MAX_DAYS = 21;        // ... and never more than 21 days
const MAX_TOPICS = 500;
const TOPICS_PER_HOUR = 10;       // new discussions per network per hour
const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const MAX_PINS = 5000;
const PER_HOUR = 20;          // new pins per network per hour
const VOTES_PER_HOUR = 60;    // votes per network per hour
const VOTES_PER_IP_PIN = 3;   // votes per network on one pin (shared mobile networks need a few)
const LIVE_PER_DEVICE = 10;   // live pins one device may have at once
const POSTS_PER_HOUR = 60;    // updates per network per hour
const POSTS_PER_DEVICE = 20;  // updates per device per hour
const POST_GAP_SEC = 10;      // shortest gap between two updates from one device
const REACTS_PER_HOUR = 120;  // helpful / report taps per network per hour

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
  note: p.note || null, comments: p.comments || 0, lastActivityAt: p.lastActivityAt || null, last: p.last || null,
});

const cKey = (id) => `navmap:pinc:${id}`;   // list of updates (JSON), newest last
const rKey = (id) => `navmap:pincr:${id}`;  // who pressed Helpful / Report on which update (hashed)

const publicComment = (c, me, pinOwner) => ({
  id: c.id, at: c.at, text: c.text, tag: c.tag || null, handle: c.handle, member: !!c.member,
  helpful: c.helpful || 0, mine: me.ids.includes(c.by), byPinner: !!pinOwner && c.by === pinOwner,
});

const publicTopic = (x, me) => ({
  id: x.id, kind: 'news', url: x.url, title: x.title, source: x.source, createdAt: x.createdAt, expiresAt: x.expiresAt,
  comments: x.comments || 0, lastActivityAt: x.lastActivityAt || x.createdAt, last: x.last || null, mine: me.ids.includes(x.owner),
});
const isTopicId = (id) => /^t[0-9a-f]{11}$/.test(id);

/** A live pin or discussion by id: { item, topic } or null. */
async function getItem(id) {
  const topic = isTopicId(id);
  const raw = await redis('HGET', topic ? TKEY : KEY, id);
  const item = raw && JSON.parse(raw);
  if (!item || new Date(item.expiresAt).getTime() <= Date.now() || (!topic && shouldHide(item))) return null;
  return { item, topic };
}

/** Who is calling: device code (always) and, when signed in, the Supabase member. */
async function whoIs(req) {
  const rawToken = req.headers['x-navmap-token'];
  const deviceToken = typeof rawToken === 'string' && /^[0-9a-f]{16,64}$/.test(rawToken) ? rawToken : null;
  const owner = deviceToken ? sha(`owner:${deviceToken}`) : null;
  let member = null;
  const auth = String(req.headers.authorization || '');
  if (SB_URL && SB_ANON && auth.startsWith('Bearer ') && auth.length < 4096) {
    try {
      const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: auth } });
      if (r.ok) {
        const u = await r.json();
        const md = u.user_metadata || {};
        const name = cleanName(md.display_name) || cleanName(String(md.full_name || md.name || '').split(' ')[0]) || 'Member';
        member = { id: u.id, name, key: sha(`user:${u.id}`) };
      }
    } catch { /* treat as anonymous */ }
  }
  // author = what posts are stored under; ids = everything that counts as "mine"
  const author = member ? member.key : owner;
  return { deviceToken, owner, member, author, ids: [owner, member?.key].filter(Boolean) };
}

async function readComments(id) {
  const raw = (await redis('LRANGE', cKey(id), 0, -1)) || [];
  const out = [];
  for (const r of raw) { try { out.push(JSON.parse(r)); } catch { /* skip */ } }
  return out;
}

/** Summary kept on the pin or discussion so the feed needs no extra reads. */
function summarise(pin, list) {
  const shown = list.filter((c) => !c.hidden);
  const last = shown[shown.length - 1];
  pin.comments = shown.length;
  pin.last = last ? { handle: last.handle, text: last.text, tag: last.tag || null, at: last.at } : null;
  pin.lastActivityAt = last ? last.at : pin.lastActivityAt || null;
}

async function saveSummary(id, list, bump = false) {
  const key = isTopicId(id) ? TKEY : KEY;
  const raw = await redis('HGET', key, id);
  if (!raw) return null;
  const cur = JSON.parse(raw);
  summarise(cur, list);
  if (bump && key === TKEY) {
    // an active discussion stays up: 7 days after the last update, at most 21 days in all
    const cap = new Date(cur.createdAt).getTime() + TOPIC_MAX_DAYS * 864e5;
    cur.expiresAt = new Date(Math.max(new Date(cur.expiresAt).getTime(), Math.min(Date.now() + TOPIC_DAYS * 864e5, cap))).toISOString();
  }
  await redis('HSET', key, id, JSON.stringify(cur));
  return cur;
}

/** Add one update to a pin. Returns { status, body }. */
async function addComment(p, { text, tag }, me, ipHash, ip) {
  const { deviceToken, owner } = me;
  const topic = isTopicId(p.id);
  const tg = tag && (topic ? DISCUSS_TAG_IDS : PIN_TAG_IDS).has(tag) ? tag : null;
  const clean = cleanText(text);
  if (clean.error) return { status: 400, body: { error: clean.error } };
  if (!clean.text && !tg) return { status: 400, body: { error: 'empty' } };
  if (await overLimit(`navmap:rlc:${ipHash}`, POSTS_PER_HOUR, 3600)) return { status: 429, body: { error: 'rate' } };
  const devKey = sha(`dev:${deviceToken}`).slice(0, 24);
  if (await overLimit(`navmap:rlcd:${devKey}`, POSTS_PER_DEVICE, 3600)) return { status: 429, body: { error: 'rate' } };
  if ((await redis('SET', `navmap:rlcg:${devKey}`, '1', 'EX', POST_GAP_SEC, 'NX')) !== 'OK') return { status: 429, body: { error: 'slow' } };
  const c = {
    id: randomBytes(4).toString('hex'), at: new Date().toISOString(), text: clean.text, tag: tg,
    handle: me.member ? me.member.name : handleFrom(sha(`handle:${deviceToken}`)), by: me.author, helpful: 0, flags: 0,
    ...(me.member ? { member: true } : {}),
  };
  await redis('RPUSH', cKey(p.id), JSON.stringify(c));
  await redis('LTRIM', cKey(p.id), -MAX_COMMENTS, -1);
  await redis('EXPIRE', cKey(p.id), lifeLeftSec(p));
  // A status tag also counts as "Still there" / "Gone" for someone else's pin.
  const v = !topic && tg && TAG_BY_ID[tg].vote;
  let removed = false;
  if (v && p.owner !== owner) {
    const out = await vote(p, v, deviceToken, owner, ip).catch(() => null);
    removed = !!out?.body?.removed;
  }
  if (removed) return { status: 200, body: { removed: true } };
  const list = await readComments(p.id);
  const cur = await saveSummary(p.id, list, true);
  const pub = cur && (topic ? { topic: publicTopic(cur, me) } : { pin: publicPin(cur, owner) });
  return { status: 201, body: { comment: publicComment(c, me, p.owner), ...pub } };
}

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

async function activeTopics() {
  const flat = (await redis('HGETALL', TKEY)) || [];
  const now = Date.now();
  const out = [], dead = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const x = JSON.parse(flat[i + 1]);
      if (new Date(x.expiresAt).getTime() > now) out.push(x); else dead.push(flat[i]);
    } catch { dead.push(flat[i]); }
  }
  if (dead.length) {
    redis('HDEL', TKEY, ...dead).then(() => redis('DEL', ...dead.flatMap((id) => [cKey(id), rKey(id)]))).catch(() => {});
  }
  return out;
}

async function dropPins(ids) {
  await redis('HDEL', KEY, ...ids);
  await redis('DEL', ...ids.flatMap((id) => [`navmap:pinv:${id}`, `navmap:pinvip:${id}`, cKey(id), rKey(id)]));
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

/** Fixed-window counter; true when the limit is passed. */
async function overLimit(key, limit, seconds) {
  const n = await redis('INCR', key);
  if (n === 1) await redis('EXPIRE', key, seconds);
  return n > limit;
}

const lifeLeftSec = (p) => {
  if (isTopicId(p.id)) return Math.max(60, Math.ceil((new Date(p.createdAt).getTime() + TOPIC_MAX_DAYS * 864e5 - Date.now()) / 1000) + 3600);
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
  if (req.method === 'GET' && req.query?.config) {
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(200).json({ auth: SB_URL && SB_ANON ? { url: SB_URL, anonKey: SB_ANON } : null });
    return;
  }
  if (!URL_ || !TOKEN) { res.status(503).json({ configured: false, pins: [] }); return; }
  try {
    const me = await whoIs(req);
    const { deviceToken, owner } = me;
    if (req.method === 'GET' && req.query?.thread) {
      const got = await getItem(String(req.query.thread));
      if (!got) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
      const p = got.item;
      const list = (await readComments(p.id)).filter((c) => !c.hidden);
      let mine = {};
      if (deviceToken && list.length) {
        const fields = list.map((c) => sha(`helpful:${c.id}:${deviceToken}`).slice(0, 32));
        const got = (await redis('HMGET', rKey(p.id), ...fields)) || [];
        list.forEach((c, i) => { if (got[i]) mine[c.id] = true; });
      }
      res.status(200).json({ configured: true, ...(got.topic ? { topic: publicTopic(p, me) } : { pin: publicPin(p, owner) }), comments: list.map((c) => ({ ...publicComment(c, me, got.topic ? null : p.owner), helpedByMe: !!mine[c.id] })) });
      return;
    }
    if (req.method === 'GET') {
      const [pins, topics] = await Promise.all([activePins(), activeTopics()]);
      res.status(200).json({ configured: true, pins: pins.map((p) => publicPin(p, owner)), topics: topics.map((x) => publicTopic(x, me)), member: me.member ? { name: me.member.name } : null });
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const ip = clientIp(req);
      const ipHash = sha(`ip:${ip}`).slice(0, 24);

      // Updates, Helpful and Report on someone's pin
      if (body.comment !== undefined || body.react !== undefined) {
        if (!owner || typeof body.id !== 'string') { res.status(400).json({ configured: true, error: 'bad' }); return; }
        const got = await getItem(body.id);
        if (!got) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
        const p = got.item;
        if (body.comment !== undefined) {
          const cm = body.comment && typeof body.comment === 'object' ? body.comment : {};
          const out = await addComment(p, { text: typeof cm.text === 'string' ? cm.text : '', tag: cm.tag }, me, ipHash, ip);
          res.status(out.status).json({ configured: true, ...out.body });
          return;
        }
        if (!['helpful', 'flag'].includes(body.react) || typeof body.cid !== 'string') { res.status(400).json({ configured: true, error: 'bad' }); return; }
        if (await overLimit(`navmap:rlr:${ipHash}`, REACTS_PER_HOUR, 3600)) { res.status(429).json({ configured: true, error: 'rate' }); return; }
        const list = await readComments(p.id);
        const i = list.findIndex((c) => c.id === body.cid);
        if (i < 0 || list[i].hidden) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
        const c = list[i];
        if (me.ids.includes(c.by)) { res.status(400).json({ configured: true, error: 'own' }); return; }
        const field = sha(`${body.react}:${c.id}:${deviceToken}`).slice(0, 32);
        let helpedByMe = false;
        if (body.react === 'helpful') {
          // toggles
          if (await redis('HDEL', rKey(p.id), field)) c.helpful = Math.max(0, (c.helpful || 0) - 1);
          else { await redis('HSET', rKey(p.id), field, '1'); c.helpful = (c.helpful || 0) + 1; helpedByMe = true; }
        } else {
          if (!(await redis('HSETNX', rKey(p.id), field, '1'))) { res.status(200).json({ configured: true, flagged: true }); return; }
          c.flags = (c.flags || 0) + 1;
          if (c.flags >= FLAGS_TO_HIDE) c.hidden = true;
        }
        await redis('EXPIRE', rKey(p.id), lifeLeftSec(p));
        // write back by position; skip if the list moved under us (rare, the tap can be retried)
        const now = await redis('LINDEX', cKey(p.id), i);
        if (now && JSON.parse(now).id === c.id) await redis('LSET', cKey(p.id), i, JSON.stringify(c));
        if (c.hidden) await saveSummary(p.id, list);
        res.status(200).json({ configured: true, hidden: !!c.hidden, flagged: body.react === 'flag', comment: c.hidden ? null : { ...publicComment(c, me, got.topic ? null : p.owner), helpedByMe } });
        return;
      }

      // Discuss a news story
      if (body.topic !== undefined) {
        const tp = body.topic && typeof body.topic === 'object' ? body.topic : {};
        const url = String(tp.url || '').slice(0, 1000), title = plain(tp.title, 200), source = plain(tp.source, 60) || 'News';
        if (!owner || !newsUrlOk(url) || title.length < 5) { res.status(400).json({ configured: true, error: 'bad' }); return; }
        const id = `t${sha(`topic:${url}`).slice(0, 11)}`;
        const have = await getItem(id);
        if (have) { res.status(200).json({ configured: true, topic: publicTopic(have.item, me) }); return; }
        if (await overLimit(`navmap:rlt:${ipHash}`, TOPICS_PER_HOUR, 3600)) { res.status(429).json({ configured: true, error: 'rate' }); return; }
        if ((await activeTopics()).length >= MAX_TOPICS) { res.status(503).json({ configured: true, error: 'full' }); return; }
        const now = Date.now();
        const x = { id, kind: 'news', url, title, source, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TOPIC_DAYS * 864e5).toISOString(), owner: me.author, comments: 0 };
        await redis('HSET', TKEY, id, JSON.stringify(x));
        res.status(201).json({ configured: true, topic: publicTopic(x, me) });
        return;
      }

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
      const note = typeof body.note === 'string' ? body.note : '';
      if (note) { const ck = cleanText(note); if (ck.error) { res.status(400).json({ configured: true, error: ck.error }); return; } }
      if (t.needsNote && !note.trim()) { res.status(400).json({ configured: true, error: 'empty' }); return; }
      if (same) {
        let out;
        if (same.owner === owner) out = { status: 200, body: { pin: publicPin(same, owner) } };
        else out = await vote(same, 'confirm', deviceToken, owner, ip);
        if (note.trim() && !out.body.removed) {
          const c = await addComment(same, { text: note }, me, ipHash, ip);
          if (c.body.pin) out.body.pin = c.body.pin;
        }
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
        ...(note.trim() ? { note: cleanText(note).text } : {}),
      };
      await redis('HSET', KEY, p.id, JSON.stringify(p));
      let pin = publicPin(p, owner);
      if (note.trim()) {
        const c = await addComment(p, { text: note }, me, ipHash, ip);
        if (c.body.pin) pin = c.body.pin;
      }
      res.status(201).json({ configured: true, pin });
      return;
    }
    if (req.method === 'DELETE' && req.query.cid) {
      const id = String(req.query.id || ''), cid = String(req.query.cid);
      const list = id ? await readComments(id) : [];
      const c = list.find((x) => x.id === cid);
      if (!c) { res.status(404).json({ configured: true, error: 'Not found' }); return; }
      if (!me.ids.includes(c.by)) { res.status(403).json({ configured: true, error: 'Only the person who wrote it can remove it' }); return; }
      await redis('LREM', cKey(id), 1, JSON.stringify(c));
      await saveSummary(id, list.filter((x) => x.id !== cid));
      res.status(200).json({ configured: true, ok: true });
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
