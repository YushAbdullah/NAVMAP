// Choosing points on tolled expressways to route through, for the "Use toll roads" option.
import { distKm } from './geo.js';

/**
 * points: [[lon, lat, ref], …] from public/data/tolls.json. Returns up to `n` via points [lon, lat]
 * near the trip: fewest extra kilometres first, spread out and on different expressways where possible.
 */
export function pickTollVias(points, from, to, n = 4) {
  const direct = distKm(from, to);
  const cands = points.map(([x, y, ref]) => {
    const c = [x, y];
    return { c, ref, detour: distKm(from, c) + distKm(c, to) - direct };
  }).filter((p) => p.detour < direct * 0.5 + 4 && distKm(from, p.c) > 0.8 && distKm(p.c, to) > 0.8)
    .sort((a, b) => a.detour - b.detour);
  const picks = [];
  for (const p of cands) {
    if (picks.length === n) break;
    if (picks.some((q) => distKm(q.c, p.c) < 3 || (q.ref && q.ref === p.ref))) continue;
    picks.push(p);
  }
  for (const p of cands) {
    if (picks.length >= n) break;
    if (!picks.includes(p) && picks.every((q) => distKm(q.c, p.c) > 3)) picks.push(p);
  }
  return picks.map((p) => p.c);
}

/** The quickest of the tried routes that really uses a toll road and is not absurdly slower. */
export const bestTollRoute = (tries, fastest) =>
  tries.filter((r) => r?.tolls?.length && r.duration < fastest.duration * 1.6).sort((a, b) => a.duration - b.duration)[0] || null;
