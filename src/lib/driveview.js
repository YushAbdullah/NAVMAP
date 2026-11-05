// Drive view: a low chase camera behind the car with real-height 3D buildings and a sky,
// so navigating feels like looking through the windscreen. Also the route simulator that
// "drives" the chosen route at road speed so you can preview a trip like a driving game.

export const DRIVE_PITCH = 72;    // chase camera tilt (MapLibre allows up to 85)
export const FLAT_PITCH = 55;     // the older, higher navigation camera
export const DRIVE_ZOOM = 18.2;

const KEY = 'navmap.driveView';
export function getDriveView() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setDriveView(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

const SKY = {
  'sky-color': '#8CCBF2',
  'horizon-color': '#E3F3FF',
  'fog-color': '#EEF6EF',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.35,
  'atmosphere-blend': 0.5,
};

const height = ['coalesce', ['get', 'render_height'], ['get', 'height'], 8];
const base = ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0];
// Taller buildings a little darker, so the skyline reads as a city, not a block of white.
const shade = ['interpolate', ['linear'], height, 0, '#ECEFEA', 30, '#D9DED8', 120, '#BCC4BE'];

/** Turn the 3D buildings and sky on or off. `play` keeps the Play view's own toy buildings. */
export function applyDriveView(map, on, { play = false } = {}) {
  if (map.getMaxPitch() < 80) map.setMaxPitch(80);
  try { map.setSky(on ? SKY : undefined); } catch { /* older style spec */ }
  const want = on && !play;
  if (!want) {
    if (map.getLayer('drive-buildings')) map.removeLayer('drive-buildings');
    return;
  }
  if (map.getLayer('drive-buildings')) return;
  const layers = map.getStyle().layers;
  const src = layers.find((l) => l['source-layer'] === 'building' || /building/i.test(l.id))?.source
    || Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
  if (!src) return;
  const below = layers.find((l) => l.type === 'symbol' || /^(radar-|alert-|route-)/.test(l.id))?.id;
  map.addLayer({
    id: 'drive-buildings', type: 'fill-extrusion', source: src, minzoom: 14,
    ...(map.getSource(src)?.type === 'vector' ? { 'source-layer': 'building' } : {}),
    paint: {
      'fill-extrusion-color': shade,
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, height],
      'fill-extrusion-base': base,
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  }, below);
}

/** The car seen from behind, chase-camera style. It stands upright on screen and turns with the road. */
export const CAR_SVG = `<svg class="car-3d" viewBox="0 0 64 52" aria-hidden="true">
  <ellipse cx="32" cy="48" rx="29" ry="4" fill="rgba(0,20,10,.30)"/>
  <rect x="5" y="38" width="10" height="11" rx="3" fill="#1B1F1C"/><rect x="49" y="38" width="10" height="11" rx="3" fill="#1B1F1C"/>
  <path d="M15 8q2-5 7-5h20q5 0 7 5l5 14H10z" fill="#2569D8"/>
  <path d="M18 9q1.5-3 5-3h18q3.5 0 5 3l3.5 10h-35z" fill="#132C52"/>
  <path d="M22 8h8l-5 9h-5z" fill="rgba(255,255,255,.18)"/>
  <rect x="3" y="20" width="58" height="22" rx="7" fill="#2D7FF9"/>
  <rect x="3" y="20" width="58" height="5" rx="2.5" fill="#4C97FF"/>
  <rect x="6" y="26" width="13" height="6" rx="2" fill="#FF3B3B"/><rect x="45" y="26" width="13" height="6" rx="2" fill="#FF3B3B"/>
  <rect x="7" y="27" width="5" height="2" rx="1" fill="#FFB3B3"/><rect x="52" y="27" width="5" height="2" rx="1" fill="#FFB3B3"/>
  <rect x="24" y="31" width="16" height="6" rx="1.5" fill="#F4F7F4"/>
  <rect x="8" y="38" width="48" height="3" rx="1.5" fill="#1E58B8"/>
</svg>`;

// ---------------------------------------------------------------- route simulator
const R = Math.PI / 180;
const hav = (a, b) => {
  const dLat = (b[1] - a[1]) * R, dLon = (b[0] - a[0]) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * R) * Math.cos(b[1] * R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const brg = (a, b) => {
  const y = Math.sin((b[0] - a[0]) * R) * Math.cos(b[1] * R);
  const x = Math.cos(a[1] * R) * Math.sin(b[1] * R) - Math.sin(a[1] * R) * Math.cos(b[1] * R) * Math.cos((b[0] - a[0]) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
};
/** Shortest turn from angle a towards b, k of the way (0..1). */
export const turnTowards = (a, b, k) => (a + ((((b - a) % 360) + 540) % 360 - 180) * k + 360) % 360;

export const SIM_SPEEDS = [1, 2, 4, 8];

/**
 * A route measured for the simulator: where the car is after `m` metres, which way the road
 * points, and how fast traffic moves there (from each step's OSRM distance and time).
 */
export function measureRoute(route) {
  const c = route.coords;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + hav(c[i - 1], c[i]));
  const total = cum[cum.length - 1];
  // speed bands: step i covers the metres from the sum of earlier steps to that plus its distance
  const bands = [];
  let at = 0;
  for (const s of route.steps || []) {
    const v = s.duration > 0 ? s.distance / s.duration : 12;
    bands.push({ to: at + s.distance, v: Math.max(4, Math.min(33, v)) }); // 15..120 km/h
    at += s.distance;
  }
  const scale = at > 0 ? total / at : 1; // OSRM step sums and the line length differ a little
  // Where the driver has to turn (in line metres), so the car slows down into corners and roundabouts.
  const turns = [];
  let acc = 0;
  for (const st of route.steps || []) {
    if (acc > 0 && st.type !== 'arrive' && !/straight/.test(st.modifier || '') && !['new name', 'continue'].includes(st.type)) {
      turns.push({ at: acc * scale, v: /slight/.test(st.modifier || '') || ['merge', 'on ramp', 'off ramp', 'fork'].includes(st.type) ? 14 : 6 });
    }
    acc += st.distance;
  }
  turns.push({ at: total, v: 0 }); // stop gently at the destination
  let seg = 0;
  function seek(m) {
    if (m <= 0) { seg = 0; return 0; }
    if (cum[seg] > m) seg = 0;
    while (seg < c.length - 2 && cum[seg + 1] < m) seg++;
    return seg;
  }
  return {
    total,
    point(m) {
      m = Math.max(0, Math.min(total, m));
      const i = seek(m);
      const len = cum[i + 1] - cum[i] || 1;
      const k = (m - cum[i]) / len;
      return [c[i][0] + (c[i + 1][0] - c[i][0]) * k, c[i][1] + (c[i + 1][1] - c[i][1]) * k];
    },
    /** Direction of the road from m to about 25 m further on, so the camera looks into bends. */
    bearing(m) {
      const a = this.point(m), b = this.point(Math.min(total, m + 25));
      if (hav(a, b) < 1) return brg(this.point(Math.max(0, m - 25)), a);
      return brg(a, b);
    },
    /** Road speed in m/s at m. */
    speed(m) {
      const sm = m / scale;
      let v = (bands.find((b) => b.to >= sm) || bands[bands.length - 1] || { v: 12 }).v;
      // Brake for the next corner: about 1.5 m/s less for every 10 m closer to it.
      for (const t of turns) {
        const d = t.at - m;
        if (d < -15) continue;
        v = Math.min(v, Math.max(t.v, t.v + Math.max(0, d) * 0.15));
        if (d > 300) break;
      }
      return Math.max(v, 2);
    },
  };
}
