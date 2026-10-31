// Vercel serverless function: email updates sign-up (opt-in, PDPA consent recorded).
//   POST /api/subscribe {email, consent: true, lang}      -> subscribe
//   POST /api/subscribe {email, action: 'unsubscribe'}    -> unsubscribe (also GET ?unsub=<email>&t=<token>)
//   GET  /api/subscribe?export=csv   header x-admin-key: <ADMIN_KEY>  -> CSV of subscribers (owner only)
//   GET  /api/subscribe?status=1     -> { configured, count } (count only, never emails)
// Storage: the same Upstash Redis as community pins, hash `navmap:subs` keyed by lower-case email.
import { createHash, timingSafeEqual } from 'node:crypto';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const KEY = 'navmap:subs';
const PER_HOUR = 5;
const MAX_SUBS = 100000;
export const CONSENT_VERSION = '2026-10-31';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,253}\.[a-z]{2,24}$/i;
export const unsubToken = (email) => sha(`unsub:${TOKEN}:${email}`).slice(0, 32);

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const sameKey = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) { res.status(503).json({ configured: false, error: 'Subscriptions are not set up yet' }); return; }
  try {
    const q = req.query || {};

    if (req.method === 'GET' && q.status) {
      res.status(200).json({ configured: true, count: await redis('HLEN', KEY), exportEnabled: !!ADMIN_KEY });
      return;
    }

    if (req.method === 'GET' && q.export) {
      if (!ADMIN_KEY || !sameKey(req.headers['x-admin-key'] || q.key || '', ADMIN_KEY)) { res.status(401).json({ error: 'Not allowed' }); return; }
      const flat = (await redis('HGETALL', KEY)) || [];
      const rows = [];
      for (let i = 1; i < flat.length; i += 2) { try { rows.push(JSON.parse(flat[i])); } catch { /* skip */ } }
      rows.sort((a, b) => String(a.consentAt).localeCompare(String(b.consentAt)));
      const csv = ['email,subscribed_at,language,consent_version,consent_text', ...rows.map((r) =>
        [r.email, r.consentAt, r.lang, r.consentVersion, r.consentText].map(csvCell).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="navmap-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.status(200).send(csv);
      return;
    }

    // One-click unsubscribe link for future emails
    if (req.method === 'GET' && q.unsub) {
      const email = String(q.unsub).trim().toLowerCase();
      if (q.t && sameKey(q.t, unsubToken(email))) await redis('HDEL', KEY, email);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:520px;margin:60px auto;padding:0 16px;line-height:1.6"><h1>Unsubscribed</h1><p>You will no longer receive NAVMAP emails. Anda telah berhenti melanggan.</p><p><a href="/">Back to NAVMAP</a></p>');
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) { res.status(400).json({ error: 'invalid_email' }); return; }

      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const rlKey = `navmap:rls:${sha(`ip:${ip}`).slice(0, 24)}`;
      const n = await redis('INCR', rlKey);
      if (n === 1) await redis('EXPIRE', rlKey, 3600);
      if (n > PER_HOUR) { res.status(429).json({ error: 'rate' }); return; }

      if (body.action === 'unsubscribe') {
        await redis('HDEL', KEY, email);
        res.status(200).json({ ok: true, unsubscribed: true });
        return;
      }

      if (body.consent !== true) { res.status(400).json({ error: 'consent_required' }); return; }
      if ((await redis('HLEN', KEY)) >= MAX_SUBS) { res.status(503).json({ error: 'full' }); return; }
      const lang = body.lang === 'bm' ? 'bm' : 'en';
      const record = {
        email, lang, source: 'navmap-app',
        consentAt: new Date().toISOString(), consentVersion: CONSENT_VERSION,
        consentText: String(body.consentText || '').slice(0, 400),
      };
      await redis('HSET', KEY, email, JSON.stringify(record));
      res.status(200).json({ ok: true, subscribed: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(502).json({ error: 'server', message: String(err?.message || err) });
  }
}
