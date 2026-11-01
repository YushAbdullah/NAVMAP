// Community pins: shared through /api/pins when the server database is connected,
// otherwise kept on this device only. Only the person who placed a pin can remove it;
// anyone else can say "Still there" (keeps it alive longer) or "Gone" (enough of these hide it).
import { PIN_BY_ID } from './pin-types.js';
import { staleness } from './pin-trust.js';

const TOKEN_KEY = 'navmap.device';
const LOCAL_KEY = 'navmap.pins.local.v1';
const VOTES_KEY = 'navmap.pinVotes'; // { pinId: 'confirm'|'gone' } so the buttons remember your choice

function token() {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch { return 'anon'; }
}

const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (l) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(l)); } catch { /* ignore */ } };
const alive = (p) => new Date(p.expiresAt).getTime() > Date.now();

const readVotes = () => { try { return JSON.parse(localStorage.getItem(VOTES_KEY) || '{}'); } catch { return {}; } };
function writeVote(id, v, liveIds) {
  try {
    const all = readVotes();
    if (v) all[id] = v; else delete all[id];
    if (liveIds) for (const k of Object.keys(all)) if (!liveIds.has(k)) delete all[k];
    localStorage.setItem(VOTES_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export let shared = null; // true = everyone sees pins; false = device only; null = unknown yet

/** Pin -> the alert shape the rest of the app understands. */
export function toAlert(p) {
  const t = PIN_BY_ID[p.type] || { en: p.type, bm: p.type, sev: 'info', icon: 'report' };
  return {
    id: `pin-${p.id}`, pinId: p.id, kind: 'report', type: p.type, icon: t.icon, severity: t.sev,
    title: t.en, title_bm: t.bm, place: '',
    desc: p.mine ? 'Your pin' : 'Pinned by the community', desc_bm: p.mine ? 'Pin anda' : 'Dipin oleh komuniti',
    lat: p.lat, lon: p.lon, radiusKm: 0.5, time: p.createdAt, expiresAt: p.expiresAt, mine: !!p.mine,
    source: shared ? 'Community' : 'This device',
    confirms: p.confirms || 0, gone: p.gone || 0, lastConfirmedAt: p.lastConfirmedAt || null,
    stale: staleness(p), myVote: readVotes()[p.id] || null, canVote: !!shared && !p.mine && !String(p.id).startsWith('l'),
  };
}

export async function listPins() {
  try {
    const r = await fetch('/api/pins', { headers: { 'x-navmap-token': token() } });
    const d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    if (r.ok && d?.configured) {
      shared = true;
      writeVote('', null, new Set(d.pins.map((p) => p.id))); // forget votes on pins that are gone
      return d.pins.filter(alive).map(toAlert); // a saved (offline) copy may hold expired pins
    }
  } catch { /* fall through */ }
  shared = false;
  const l = readLocal().filter(alive);
  writeLocal(l);
  return l.map((p) => toAlert({ ...p, mine: true }));
}

export async function addPin(type, lat, lon) {
  if (shared !== false) {
    try {
      const r = await fetch('/api/pins', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-navmap-token': token() },
        body: JSON.stringify({ type, lat, lon }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.merged) {
        // the same thing was already pinned close by, so this counted as "Still there" on that pin
        shared = true;
        if (d.myVote) writeVote(d.pin.id, d.myVote);
        const a = toAlert(d.pin);
        a.merged = true;
        return a;
      }
      if (r.ok && d?.pin) { shared = true; return toAlert({ ...d.pin, mine: true }); }
      if (r.status === 429) throw new Error('rate');
      if (r.status === 400) throw new Error(d?.error || 'bad');
    } catch (e) {
      if (e.message === 'rate' || e.message === 'bad') throw e;
    }
  }
  shared = false;
  const hours = PIN_BY_ID[type]?.hours || 2;
  const p = { id: `l${Date.now()}`, type, lat, lon, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + hours * 3600e3).toISOString() };
  writeLocal([...readLocal().filter(alive), p]);
  return toAlert({ ...p, mine: true });
}

export async function removePin(pinId) {
  if (String(pinId).startsWith('l')) {
    writeLocal(readLocal().filter((p) => p.id !== pinId));
    return true;
  }
  const r = await fetch(`/api/pins?id=${encodeURIComponent(pinId)}`, { method: 'DELETE', headers: { 'x-navmap-token': token() } });
  return r.ok;
}

/**
 * "Still there" (vote = 'confirm') or "Gone" (vote = 'gone') on someone else's pin.
 * Resolves to { alert } with fresh counts, or { removed: true } when the pin was hidden.
 */
export async function votePin(pinId, vote) {
  const r = await fetch('/api/pins', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-navmap-token': token() },
    body: JSON.stringify({ id: pinId, vote }),
  });
  const d = await r.json().catch(() => null);
  if (r.status === 429) throw new Error('rate');
  if (r.status === 404) return { removed: true };
  if (!r.ok || !d) throw new Error('failed');
  writeVote(pinId, vote);
  if (d.removed) return { removed: true };
  return { alert: toAlert(d.pin) };
}
