const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;

export function distKm(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Shortest distance (km) from point p to a polyline (array of [lon, lat]). Equirectangular approx. */
export function distToLineKm(p, line) {
  const k = Math.cos(rad(p[1]));
  const toXY = (c) => [rad(c[0]) * k * R, rad(c[1]) * R];
  const P = toXY(p);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const A = toXY(line[i - 1]), B = toXY(line[i]);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = A[0] + t * dx - P[0], ey = A[1] + t * dy - P[1];
    best = Math.min(best, Math.hypot(ex, ey));
  }
  return best;
}

export function fmtDist(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function fmtDur(sec, lang = 'en') {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return lang === 'bm' ? `${h} j ${mm} min` : `${h} h ${mm} min`;
}

export function fmtAgo(iso, lang = 'en') {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return lang === 'bm' ? 'baru tadi' : 'just now';
  if (m < 60) return lang === 'bm' ? `${m} min lalu` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return lang === 'bm' ? `${h} jam lalu` : `${h} h ago`;
  return new Date(iso).toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short' });
}

/** Approximate circle polygon for map display. */
export function circle(lon, lat, km, steps = 48) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (km / R) * (180 / Math.PI) * Math.sin(a);
    const dLon = (km / R) * (180 / Math.PI) * Math.cos(a) / Math.cos(rad(lat));
    coords.push([lon + dLon, lat + dLat]);
  }
  return coords;
}

// Malaysia bounding box [west, south, east, north]
export const MY_BBOX = [99.6, 0.85, 119.3, 7.4];
export const KL = [101.7117, 3.1579]; // KLCC, default centre
