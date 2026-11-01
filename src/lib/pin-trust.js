// Trust rules for community pins, shared by the app and the /api/pins server so both agree.
import { PIN_BY_ID } from './pin-types.js';

const H = 3600e3;
export const GONE_TO_HIDE = 2;     // a pin disappears after this many "Gone" votes ...
export const SAME_SPOT_M = 300;    // a new pin of the same type this close counts as a confirmation

/** ... as long as more people said "Gone" than "Still there" (the person who pinned it counts as one, ties keep the pin). */
export function shouldHide(p) {
  const gone = p.gone || 0, ok = (p.confirms || 0) + 1;
  return gone >= GONE_TO_HIDE && gone > ok;
}

/** New expiry after someone confirms: now + the type's normal life, capped at createdAt + maxHours. */
export function confirmedExpiry(p, now = Date.now()) {
  const t = PIN_BY_ID[p.type] || { hours: 2, maxHours: 4 };
  const cap = new Date(p.createdAt).getTime() + (t.maxHours || t.hours) * H;
  const next = Math.min(now + t.hours * H, cap);
  return new Date(Math.max(next, new Date(p.expiresAt).getTime())).toISOString();
}

/** 0 = just reported or confirmed, 1 = about to expire. Used to fade older pins on the map. */
export function staleness(p, now = Date.now()) {
  const from = new Date(p.lastConfirmedAt || p.createdAt).getTime();
  const to = new Date(p.expiresAt).getTime();
  if (!(to > from)) return 1;
  return Math.min(1, Math.max(0, (now - from) / (to - from)));
}
