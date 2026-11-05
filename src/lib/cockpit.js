// In-car screen: a second map seen from the driver's seat (eye height, looking down the road),
// with a dashboard and a steering wheel that turns with the road, the next turn arrow and a
// toll-ahead pill drawn over it. It follows the same car position as the main map, during a
// simulated or a real drive. Three sizes: a small screen you can drag, a big one, and a split
// screen (map on top, in-car view below).
import { applyDriveView } from './driveview.js';

const R = Math.PI / 180;
/** The point `m` metres from p in direction `deg`. */
function ahead(p, deg, m) {
  const dLat = (m * Math.cos(deg * R)) / 110540;
  const dLon = (m * Math.sin(deg * R)) / (111320 * Math.cos(p[1] * R));
  return [p[0] + dLon, p[1] + dLat];
}

// Camera: MapLibre puts the camera 1.5 × the screen height (in pixels) from the map centre.
// We pick the zoom that makes that distance CAM_M metres for this screen's size, then aim the
// centre that far ahead, so the eye sits right above the driver's seat at any screen size.
const PITCH = 82;
const CAM_M = 26;                                   // eye about 3.6 m up (26 × cos 82°)
const EYE_AHEAD = CAM_M * Math.sin(PITCH * R);
function eyeZoom(lat, heightPx) {
  const metresPerPx = (CAM_M) / (1.5 * Math.max(60, heightPx));
  return Math.log2((40075016.7 * Math.cos(lat * R)) / (512 * metresPerPx));
}

export const SIZES = ['small', 'big', 'split'];

const DASH = `<svg class="ck-dash" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="ckd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#253129"/><stop offset="1" stop-color="#121a15"/></linearGradient></defs>
  <path d="M-40 52 Q200 22 440 52 V140 H-40z" fill="url(#ckd)"/>
  <path d="M-40 52 Q200 22 440 52" fill="none" stroke="#3a4a40" stroke-width="2.5"/>
  <rect x="160" y="40" width="80" height="26" rx="8" fill="#0c120e" stroke="#2f3d34"/>
</svg>`;
const WHEEL = `<svg class="ck-wheel" viewBox="-60 -60 120 120" aria-hidden="true">
  <circle r="52" fill="none" stroke="#0b0f0c" stroke-width="13"/>
  <circle r="52" fill="none" stroke="#3b4740" stroke-width="2.5"/>
  <path d="M-46 8 L-14 14 L-10 30 M46 8 L14 14 L10 30 M0 22 V48" fill="none" stroke="#141a16" stroke-width="11" stroke-linecap="round"/>
  <circle r="17" fill="#141a16" stroke="#3b4740" stroke-width="2"/>
  <circle r="7" fill="#6BE683"/>
  <rect x="-5" y="-58" width="10" height="7" rx="2" fill="#6BE683"/>
</svg>`;

export class Cockpit {
  /** host: element to fill. style: the map style URL or object. lib: maplibregl. */
  constructor(host, style, lib) {
    this.host = host;
    host.innerHTML = `<div class="ck-map"></div>${DASH}
      <div class="ck-cluster"><b>0</b><small>km/h</small></div>${WHEEL}
      <div class="ck-turn"><span class="ck-ic"></span><b class="ck-dist"></b></div>
      <div class="ck-toll" hidden></div>`;
    this.wheel = host.querySelector('.ck-wheel');
    this.steer = 0;
    this.ready = false;
    this.route = null;
    this.map = new lib.Map({
      container: host.querySelector('.ck-map'), style, interactive: false, attributionControl: false,
      center: [101.7, 3.15], zoom: 18, pitch: PITCH, maxPitch: 85, fadeDuration: 0,
    });
    this.map.on('load', () => {
      this.ready = true;
      const m = this.map;
      roadLook(m);
      m.addSource('ck-route', { type: 'geojson', data: this.routeData() });
      m.addLayer({ id: 'ck-route', type: 'line', source: 'ck-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6BE683', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 2, 20, 40], 'line-opacity': 0.55 } }, firstSymbol(m));
      applyDriveView(m, true);
      try { m.setSky({ 'sky-color': '#7FC3F0', 'horizon-color': '#DDF0FF', 'fog-color': '#DCE8DE', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.85, 'atmosphere-blend': 0.4 }); } catch { /* old spec */ }
      if (this.last) this.follow(...this.last);
    });
  }
  routeData() {
    return { type: 'FeatureCollection', features: this.route ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.route } }] : [] };
  }
  setRoute(coords) {
    this.route = coords;
    if (this.ready) this.map.getSource('ck-route')?.setData(this.routeData());
  }
  /**
   * Put the driver's eye at `p` looking along `bearing`. ms > 0 eases (real GPS), 0 jumps (simulator frames).
   * turn: how far the road bends ahead in degrees (+ right), which turns the steering wheel.
   */
  follow(p, bearing, ms = 0, turn = 0) {
    this.last = [p, bearing, ms, turn];
    // Hands follow the road: up to about one and a half turns of the wheel, eased so it doesn't snap.
    const want = Math.max(-200, Math.min(200, turn * 3.2));
    this.steer += (want - this.steer) * (ms ? 1 : 0.18);
    this.wheel.style.transform = `translateX(-50%) rotate(${this.steer.toFixed(1)}deg)`;
    if (!this.ready || !p) return;
    const h = this.map.getContainer().clientHeight;
    const cam = { center: ahead(p, bearing, EYE_AHEAD), bearing, pitch: PITCH, zoom: eyeZoom(p[1], h) };
    if (ms) this.map.easeTo({ ...cam, duration: ms }); else this.map.jumpTo(cam);
  }
  /** turnIcon / turnDist: the next manoeuvre. toll: text or ''. kmh: number. */
  info({ turnIcon, turnDist, toll, kmh }) {
    const h = this.host;
    h.querySelector('.ck-ic').innerHTML = turnIcon || '';
    h.querySelector('.ck-dist').textContent = turnDist || '';
    const tl = h.querySelector('.ck-toll');
    tl.hidden = !toll;
    if (toll) tl.innerHTML = `<b>TOL</b><span>${toll}</span>`;
    h.querySelector('.ck-cluster b').textContent = String(Math.max(0, Math.round(kmh || 0)));
  }
  resize() {
    this.map.resize();
    if (this.last) this.follow(this.last[0], this.last[1], 0, this.last[3]);
  }
  destroy() {
    try { this.map.remove(); } catch { /* already gone */ }
    this.host.innerHTML = '';
  }
}

const firstSymbol = (m) => m.getStyle().layers.find((l) => l.type === 'symbol')?.id;

/** Grey asphalt roads and grass so the road reads clearly from eye height (the base map is very pale). */
function roadLook(m) {
  for (const l of m.getStyle().layers) {
    const id = l.id.toLowerCase();
    try {
      if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', '#C9DEC6');
      else if (l.type === 'fill' && /park|wood|forest|grass|landcover|green/.test(id)) m.setPaintProperty(l.id, 'fill-color', '#AFD3A8');
      else if (l.type === 'fill' && /landuse|residential/.test(id)) m.setPaintProperty(l.id, 'fill-color', '#D2DDD0');
      else if (l.type === 'line' && /highway|road|street|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel/.test(id) && !/rail|path|track/.test(id)) {
        m.setPaintProperty(l.id, 'line-color', id.includes('casing') ? '#E9ECE8' : '#6E7672');
      } else if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none'); // no floating labels in the windscreen
    } catch { /* layer without that property */ }
  }
}
