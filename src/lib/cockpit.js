// In-car mini screen: a small second map seen from the driver's seat (eye height, looking
// down the road), with a dashboard, the next turn arrow and a toll-ahead pill drawn over it.
// It follows the same car position as the main map, during a simulated or a real drive.
import { applyDriveView } from './driveview.js';

const R = Math.PI / 180;
/** The point `m` metres from p in direction `deg`. */
function ahead(p, deg, m) {
  const dLat = (m * Math.cos(deg * R)) / 110540;
  const dLon = (m * Math.sin(deg * R)) / (111320 * Math.cos(p[1] * R));
  return [p[0] + dLon, p[1] + dLat];
}

const DASH_SVG = `<svg class="ck-dash" viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 40 Q160 18 320 40 V90 H0z" fill="#16201A"/>
  <path d="M0 40 Q160 18 320 40" fill="none" stroke="#2C3A31" stroke-width="3"/>
  <path d="M96 90 Q96 46 160 46 Q224 46 224 90" fill="none" stroke="#0B100D" stroke-width="15" stroke-linecap="round"/>
  <path d="M96 90 Q96 46 160 46 Q224 46 224 90" fill="none" stroke="#2A332D" stroke-width="3"/>
  <circle cx="160" cy="90" r="14" fill="#0B100D"/>
</svg>`;

export class Cockpit {
  /** host: element to fill. style: the map style URL or object. lib: maplibregl. */
  constructor(host, style, lib) {
    this.host = host;
    host.innerHTML = `<div class="ck-map"></div>${DASH_SVG}
      <div class="ck-turn"><span class="ck-ic"></span><b class="ck-dist"></b></div>
      <div class="ck-toll" hidden></div>
      <div class="ck-speed"><b>0</b><small>km/h</small></div>`;
    this.ready = false;
    this.route = null;
    this.map = new lib.Map({
      container: host.querySelector('.ck-map'), style, interactive: false, attributionControl: false,
      center: [101.7, 3.15], zoom: 18.4, pitch: 80, maxPitch: 85, fadeDuration: 0,
    });
    this.map.on('load', () => {
      this.ready = true;
      const m = this.map;
      m.addSource('ck-route', { type: 'geojson', data: this.routeData() });
      m.addLayer({ id: 'ck-route', type: 'line', source: 'ck-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#6BE683', 'line-width': 9, 'line-opacity': 0.85 } });
      applyDriveView(m, true);
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
  /** Put the driver's eye at `p` looking along `bearing`. ms > 0 eases (real GPS), 0 jumps (simulator frames). */
  follow(p, bearing, ms = 0) {
    this.last = [p, bearing, ms];
    if (!this.ready || !p) return;
    // The camera sits behind the map centre, so aim the centre a little way down the road.
    const cam = { center: ahead(p, bearing, 55), bearing, pitch: 80, zoom: 18.4 };
    if (ms) this.map.easeTo({ ...cam, duration: ms }); else this.map.jumpTo(cam);
  }
  /** turn: { icon html, dist text }, toll: text or '', kmh: number. */
  info({ turnIcon, turnDist, toll, kmh }) {
    const h = this.host;
    h.querySelector('.ck-ic').innerHTML = turnIcon || '';
    h.querySelector('.ck-dist').textContent = turnDist || '';
    const tl = h.querySelector('.ck-toll');
    tl.hidden = !toll;
    if (toll) tl.innerHTML = `<b>TOL</b><span>${toll}</span>`;
    h.querySelector('.ck-speed b').textContent = String(Math.max(0, Math.round(kmh || 0)));
  }
  resize() { this.map.resize(); }
  destroy() {
    try { this.map.remove(); } catch { /* already gone */ }
    this.host.innerHTML = '';
  }
}
