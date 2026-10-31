import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { t, L, getLang, setLang, applyStatic } from './lib/i18n.js';
import { icon, maneuverIcon } from './lib/icons.js';
import { distKm, distToLineKm, fmtDist, fmtDur, fmtAgo, circle, KL, MY_BBOX } from './lib/geo.js';
import { CATEGORIES, fetchNearby, prefetchNearby } from './lib/places.js';
import { searchPlaces } from './lib/search.js';
import { getRoutes, stepText } from './lib/routing.js';
import { loadAlerts } from './lib/alerts.js';
import { REPORT_TYPES, listReports, addReport } from './lib/reports.js';

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';
const ALERT_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- state
const S = {
  tab: 'explore',
  cat: null,
  places: [], placesStatus: 'idle', showAll: false, placesCenter: null,
  selected: null,           // place object shown in detail card
  dest: null,               // { name, lat, lon }
  routes: [], routeIdx: 0, routeStatus: 'idle', routeOrigin: null,
  alerts: [], alertMode: 'loading', alertsAt: null, alertFilter: 'all',
  reports: listReports(),
  me: null,                 // [lon, lat]
  nav: null,                // { step, watchId }
  showAlertLayer: true,
};

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: KL,
  zoom: 13,
  maxBounds: [[MY_BBOX[0] - 4, MY_BBOX[1] - 3], [MY_BBOX[2] + 4, MY_BBOX[3] + 3]],
  attributionControl: { compact: true },
});
const mapReady = new Promise((resolve) => map.on('load', resolve));

map.on('load', () => {
  tintStyle();
  map.addSource('alerts', { type: 'geojson', data: fc([]) });
  map.addSource('routes', { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'alert-fill', type: 'fill', source: 'alerts', filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': ['match', ['get', 'severity'], 'danger', '#C42A36', 'warning', '#E0A100', '#1CBB6C'], 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'alert-line', type: 'line', source: 'alerts', filter: ['==', '$type', 'Polygon'],
    paint: { 'line-color': ['match', ['get', 'severity'], 'danger', '#C42A36', 'warning', '#9A6A00', '#1A7F55'], 'line-width': 1.5, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'route-alt', type: 'line', source: 'routes', filter: ['!=', ['get', 'sel'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9AA59C', 'line-width': 6, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#003503', 'line-width': 10 } });
  map.addLayer({ id: 'route-main', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6BE683', 'line-width': 6 } });
  map.addLayer({ id: 'alert-dot', type: 'circle', source: 'alerts', filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 7, 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF',
      'circle-color': ['match', ['get', 'severity'], 'danger', '#C42A36', 'warning', '#9A6A00', '#1A7F55'] } });

  map.on('click', 'route-alt', (e) => {
    const i = e.features[0]?.properties?.idx;
    if (i != null) { S.routeIdx = i; drawRoutes(); render(); }
  });
  map.on('click', 'alert-dot', (e) => {
    const a = allAlerts().find((x) => x.id === e.features[0].properties.id);
    if (a) alertPopup(a);
  });
  for (const l of ['alert-dot', 'route-alt']) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }
  drawAlerts();
});

// Gently recolour the base style toward the NAVMAP mint palette.
function tintStyle() {
  try {
    for (const layer of map.getStyle().layers) {
      const id = layer.id.toLowerCase();
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#EEF5EF');
      else if (layer.type === 'fill' && id.includes('water')) map.setPaintProperty(layer.id, 'fill-color', '#BFE2EC');
      else if (layer.type === 'fill' && /park|wood|forest|grass|landcover/.test(id)) map.setPaintProperty(layer.id, 'fill-color', '#D3EFD8');
    }
  } catch { /* style differs, keep defaults */ }
}

const fc = (features) => ({ type: 'FeatureCollection', features });

// ---------------------------------------------------------------- markers
let poiMarkers = [];
let destMarker = null;
let meMarker = null;
let reportMarkers = [];

function pinEl(cls, iconName, label) {
  const b = document.createElement('button');
  b.className = `pin ${cls}`;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(iconName);
  return b;
}

function drawPlaces() {
  poiMarkers.forEach((m) => m.remove());
  poiMarkers = S.places.slice(0, 80).map((p) => {
    const el = pinEl(S.selected?.id === p.id ? 'sel' : '', p.cat, p.name);
    el.addEventListener('click', (e) => { e.stopPropagation(); selectPlace(p); });
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
  });
}

function drawDest() {
  destMarker?.remove();
  destMarker = null;
  if (!S.dest || (S.selected && S.places.some((p) => p.id === S.dest.id))) return;
  const el = pinEl('dest', 'pin', S.dest.name);
  destMarker = new maplibregl.Marker({ element: el }).setLngLat([S.dest.lon, S.dest.lat]).addTo(map);
}

function drawMe() {
  if (!S.me) return;
  if (!meMarker) {
    const el = document.createElement('div');
    el.className = 'me';
    el.setAttribute('aria-label', t('myLocation'));
    meMarker = new maplibregl.Marker({ element: el }).setLngLat(S.me).addTo(map);
  } else meMarker.setLngLat(S.me);
}

function drawReports() {
  reportMarkers.forEach((m) => m.remove());
  reportMarkers = S.showAlertLayer ? S.reports.map((r) => {
    const el = document.createElement('button');
    el.className = 'report-pin';
    el.setAttribute('aria-label', L(r, 'title'));
    el.innerHTML = icon(r.type === 'flood' ? 'flood' : r.type);
    el.addEventListener('click', (e) => { e.stopPropagation(); alertPopup(r); });
    return new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(map);
  }) : [];
}

function allAlerts() { return [...S.reports, ...S.alerts]; }

async function drawAlerts() {
  await mapReady;
  const feats = [];
  if (S.showAlertLayer) {
    for (const a of S.alerts) {
      if (a.lat == null) continue;
      if (a.radiusKm) feats.push({ type: 'Feature', properties: { id: a.id, severity: a.severity }, geometry: { type: 'Polygon', coordinates: [circle(a.lon, a.lat, a.radiusKm)] } });
      feats.push({ type: 'Feature', properties: { id: a.id, severity: a.severity }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } });
    }
  }
  map.getSource('alerts')?.setData(fc(feats));
  drawReports();
}

let popup;
function alertPopup(a) {
  popup?.remove();
  popup = new maplibregl.Popup({ offset: 14, maxWidth: '260px' })
    .setLngLat([a.lon, a.lat])
    .setHTML(`<b>${esc(L(a, 'title'))}</b>${a.place ? `${esc(a.place)}<br>` : ''}${esc(L(a, 'desc'))}<br><small>${esc(a.source)} · ${esc(fmtAgo(a.time, getLang()))}</small>`)
    .addTo(map);
}

async function drawRoutes() {
  await mapReady;
  const feats = S.routes.map((r, i) => ({ type: 'Feature', properties: { idx: i, sel: i === S.routeIdx }, geometry: { type: 'LineString', coordinates: r.coords } }));
  // selected route drawn last
  feats.sort((a, b) => Number(a.properties.sel) - Number(b.properties.sel));
  map.getSource('routes')?.setData(fc(feats));
}

// ---------------------------------------------------------------- location
function center() { const c = map.getCenter(); return [c.lng, c.lat]; }
function origin() { return S.me || center(); }

// Location: a fast coarse fix first (cell/Wi-Fi, usually < 1 s), then refine with GPS.
let locating = null;
let refineWatch = null;
function setMe(pos, fly) {
  const first = !S.me;
  S.me = [pos.coords.longitude, pos.coords.latitude];
  drawMe();
  if (fly && first) map.flyTo({ center: S.me, zoom: Math.max(map.getZoom(), 14), duration: 700 });
  if (first) {
    prefetchNearby(['ev', 'fuel'], S.me);
    // results were loaded for the default map centre: reload them for the real location
    if (S.cat && S.placesCenter && distKm(S.placesCenter, S.me) > 2) loadPlaces(S.cat);
  }
}

function locate({ fly = true, quiet = false } = {}) {
  if (!navigator.geolocation) { if (!quiet) toast(t('geoDenied')); return Promise.resolve(null); }
  if (!fly && locating) return locating;
  locating = new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMe(pos, fly); if (fly && S.me) map.flyTo({ center: S.me, zoom: Math.max(map.getZoom(), 14), duration: 700 }); finish(S.me); },
      () => { if (!quiet && !S.me) toast(t('geoDenied')); finish(S.me); },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 });
    // refine with GPS for up to 30 s
    if (refineWatch == null) {
      refineWatch = navigator.geolocation.watchPosition((pos) => {
        setMe(pos, fly);
        finish(S.me);
        if (pos.coords.accuracy < 50) stopRefine();
      }, () => stopRefine(), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      setTimeout(stopRefine, 30000);
    }
  });
  return locating;
}
function stopRefine() {
  if (refineWatch != null && !S.nav) navigator.geolocation.clearWatch(refineWatch);
  refineWatch = null;
}

// ---------------------------------------------------------------- data actions
let placesAbort;
async function loadPlaces(cat) {
  S.cat = cat; S.selected = null; S.showAll = false;
  S.tab = 'explore';
  renderChips();
  if (!cat) { S.places = []; drawPlaces(); render(); return; }
  placesAbort?.abort();
  placesAbort = new AbortController();
  S.placesStatus = 'loading'; render();
  // if location is still being detected, give it a moment so we search the right area
  if (!S.me && locating) await Promise.race([locating, new Promise((r) => setTimeout(r, 2000))]);
  const signal = placesAbort.signal;
  if (signal.aborted) return;
  const c = S.me && distKm(S.me, center()) < 3 ? S.me : center();
  S.placesCenter = c;
  try {
    const list = await fetchNearby(cat, c, signal);
    // distance from the person, if we know where they are
    if (S.me) list.forEach((p) => { p.distKm = distKm(S.me, [p.lon, p.lat]); });
    list.sort((a, b) => a.distKm - b.distKm);
    S.places = list;
    S.placesStatus = list.length ? 'ok' : 'empty';
    drawPlaces();
    if (list.length) fitTo(list.slice(0, 8).map((p) => [p.lon, p.lat]).concat(S.me ? [S.me] : []));
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.placesStatus = 'error';
  }
  render();
}

function fitTo(points, maxZoom = 15) {
  if (!points.length) return;
  const b = points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(b, { padding: mapPadding(), maxZoom, duration: 800 });
}

function mapPadding() {
  const desktop = innerWidth >= 900;
  const top = desktop ? 40 : ($('.top').offsetHeight + 24);
  const bottom = desktop ? 40 : ($('#sheet').offsetHeight + 24);
  const left = desktop ? $('#sheet').offsetWidth + 64 : 40;
  return { top, bottom, left, right: 72 };
}

function selectPlace(p) {
  S.selected = p;
  S.tab = 'explore';
  drawPlaces();
  map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), padding: mapPadding(), duration: 600 });
  render();
}

let routeAbort;
async function routeTo(dest) {
  S.dest = dest; S.tab = 'drive';
  S.routes = []; S.routeIdx = 0; S.routeStatus = 'loading';
  drawDest(); render();
  if (!S.me) await locate({ fly: false, quiet: false });
  const from = origin();
  S.routeOrigin = S.me ? 'me' : 'centre';
  routeAbort?.abort();
  routeAbort = new AbortController();
  try {
    const routes = await getRoutes(from, [dest.lon, dest.lat], routeAbort.signal);
    routes.forEach((r) => { r.hits = alertsOnRoute(r.coords); });
    // Prefer a route with fewer alert hits if one exists.
    const fastest = routes[0];
    const safer = routes.findIndex((r) => r.hits.length < fastest.hits.length);
    routes.forEach((r, i) => { r.label = i === 0 ? 'fastest' : (i === safer ? 'safest' : 'alt'); });
    S.routes = routes;
    S.routeIdx = 0;
    S.routeStatus = 'ok';
    drawRoutes();
    fitTo(routes[0].coords.filter((_, i, a) => i % Math.ceil(a.length / 60) === 0).concat([[dest.lon, dest.lat], from]), 16);
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.routeStatus = 'error';
  }
  render();
}

function alertsOnRoute(coords) {
  const sampled = coords.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 400)) === 0 || i === a.length - 1);
  return allAlerts().filter((a) => a.lat != null && a.kind !== 'quake' && distToLineKm([a.lon, a.lat], sampled) <= (a.radiusKm || 1));
}

function clearRoute() {
  S.routes = []; S.dest = null; S.routeStatus = 'idle';
  drawRoutes(); drawDest(); render();
}

// ---------------------------------------------------------------- navigation
function startNav() {
  const r = S.routes[S.routeIdx];
  if (!r) return;
  S.nav = { step: 1, watchId: null };
  document.body.classList.add('navigating');
  $('#hud').hidden = false;
  if (navigator.geolocation) {
    S.nav.watchId = navigator.geolocation.watchPosition(onNavPos, () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
  }
  map.easeTo({ center: r.coords[0], zoom: 16.5, pitch: 45, padding: mapPadding(), duration: 800 });
  updateHud();
}

function onNavPos(pos) {
  const r = S.routes[S.routeIdx];
  if (!r || !S.nav) return;
  S.me = [pos.coords.longitude, pos.coords.latitude];
  drawMe();
  // advance past steps we've reached
  while (S.nav.step < r.steps.length - 1 && distKm(S.me, r.steps[S.nav.step].location) < 0.03) S.nav.step++;
  map.easeTo({ center: S.me, bearing: pos.coords.heading ?? map.getBearing(), duration: 600 });
  updateHud();
}

function updateHud() {
  const r = S.routes[S.routeIdx];
  const s = r.steps[Math.min(S.nav.step, r.steps.length - 1)];
  const d = S.me ? distKm(S.me, s.location) : s.distance / 1000;
  $('#hud-ic').innerHTML = maneuverIcon(s);
  $('#hud-dist').textContent = s.type === 'arrive' && d < 0.05 ? t('arrived') : fmtDist(d);
  $('#hud-text').textContent = stepText(s, getLang());
  const remain = r.steps.slice(S.nav.step).reduce((acc, x) => ({ d: acc.d + x.distance, t: acc.t + x.duration }), { d: 0, t: 0 });
  const eta = new Date(Date.now() + remain.t * 1000).toLocaleTimeString(getLang() === 'bm' ? 'ms-MY' : 'en-MY', { hour: 'numeric', minute: '2-digit' });
  $('#hud-eta').textContent = `${fmtDur(remain.t, getLang())} · ${fmtDist(remain.d / 1000)} · ETA ${eta}`;
}

function stopNav() {
  if (S.nav?.watchId != null) navigator.geolocation.clearWatch(S.nav.watchId);
  S.nav = null;
  document.body.classList.remove('navigating');
  $('#hud').hidden = true;
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
}

// ---------------------------------------------------------------- alerts
async function refreshAlerts() {
  const d = await loadAlerts();
  S.alerts = d.alerts; S.alertMode = d.mode; S.alertsAt = d.fetchedAt;
  drawAlerts();
  renderBanner();
  render();
}

function nearestAlert() {
  const ref = origin();
  const withCoords = allAlerts().filter((a) => a.lat != null && a.severity !== 'info');
  let best = null;
  for (const a of withCoords) {
    const d = distKm(ref, [a.lon, a.lat]);
    if (d < 50 && (!best || d < best.d)) best = { a, d };
  }
  if (best) return best;
  const wx = S.alerts.find((a) => a.kind === 'weather');
  return wx ? { a: wx, d: null } : null;
}

function renderBanner() {
  const b = $('#banner');
  const n = nearestAlert();
  const count = allAlerts().filter((a) => a.severity !== 'info').length;
  const badge = $('#badge');
  badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count);
  if (!n || S.tab === 'alerts') { b.hidden = true; syncLayout(); return; }
  b.hidden = false;
  b.classList.toggle('warn', n.a.severity !== 'danger');
  $('#banner-title').textContent = `${L(n.a, 'title')}${S.alertMode === 'sample' ? ' · SAMPLE' : ''}`;
  $('#banner-sub').textContent = [n.a.place || L(n.a, 'desc'), n.d != null ? `${fmtDist(n.d)} ${t('away')}` : ''].filter(Boolean).join(' · ');
  b.onclick = () => {
    if (n.a.lat != null) { map.flyTo({ center: [n.a.lon, n.a.lat], zoom: 13, padding: mapPadding() }); alertPopup(n.a); }
    setTab('alerts');
  };
  syncLayout();
}

// ---------------------------------------------------------------- rendering
function renderChips() {
  const lang = getLang();
  $('#chips').innerHTML = Object.entries(CATEGORIES).map(([k, c]) =>
    `<button class="chip" data-cat="${k}" aria-pressed="${S.cat === k}">${icon(k)}${esc(c.short[lang])}</button>`).join('');
}

function setTab(tab) {
  if (S.tab !== tab) $('#sheet-body').scrollTop = 0;
  S.tab = tab;
  render();
  renderBanner();
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const body = $('#sheet-body');
  body.innerHTML = S.tab === 'drive' ? viewDrive() : S.tab === 'alerts' ? viewAlerts() : (S.selected ? viewPlace() : viewExplore());
  syncLayout();
}

function placeRow(p) {
  return `<li><button class="row${S.selected?.id === p.id ? ' sel' : ''}" data-place="${esc(p.id)}">
    <span class="ic">${icon(p.cat)}</span>
    <span class="mid"><b>${esc(p.name)}</b><small>${esc(p.meta || CATEGORIES[p.cat][getLang()])}</small></span>
    <span class="end"><b>${fmtDist(p.distKm)}</b>${p.hours === '24/7' ? '<small>24h</small>' : ''}</span>
  </button></li>`;
}

function viewExplore() {
  if (!S.cat) {
    return `<div class="sh-head"><h2>${t('pickCat')}</h2></div><p class="muted">${t('pickCatHint')}</p>${quickGrid()}`;
  }
  const c = CATEGORIES[S.cat];
  const head = `<div class="sh-head"><h2>${esc(c[getLang()])} ${t('nearby').toLowerCase()}</h2>${S.places.length > 3 ? `<button class="link" data-action="toggle-all">${S.showAll ? t('showLess') : `${t('seeAll')} (${S.places.length})`}</button>` : ''}</div>`;
  if (S.placesStatus === 'loading') return `${head}<div class="empty-state"><span class="spinner"></span>${t('loading')}</div>`;
  if (S.placesStatus === 'error') return `${head}<div class="empty-state">${icon('search')}${t('failed')}<button class="btn-ghost" data-action="retry">${t('retry')}</button></div>`;
  if (S.placesStatus === 'empty') return `${head}<div class="empty-state">${icon('search')}${t('none')}<button class="btn-ghost" data-action="retry">${t('searchArea')}</button></div>`;
  const list = S.showAll ? S.places : S.places.slice(0, 3);
  const first = S.places[0];
  return `${head}<ul class="list">${list.map(placeRow).join('')}</ul>
    <div class="btns"><button class="btn" data-action="go" data-place="${esc(first.id)}">${icon('nav')}${t('directions')}: ${esc(first.name)}</button></div>`;
}

function quickGrid() {
  return `<div class="report-grid" style="margin-top:14px">${Object.entries(CATEGORIES).map(([k, c]) =>
    `<button data-cat="${k}"><span class="row" style="padding:0;background:none;width:auto"><span class="ic">${icon(k)}</span></span>${esc(c[getLang()])}</button>`).join('')}</div>`;
}

function viewPlace() {
  const p = S.selected;
  const near = allAlerts().filter((a) => a.lat != null && distKm([p.lon, p.lat], [a.lon, a.lat]) < (a.radiusKm || 1) + 0.5);
  return `<div class="sh-head"><button class="link" data-action="back">${t('nearby')}</button><button class="link" data-action="back" aria-label="${t('close')}">${t('close')}</button></div>
  <div class="place">
    <h2>${esc(p.name)}</h2>
    <p class="meta">${[CATEGORIES[p.cat]?.[getLang()], `${fmtDist(p.distKm)} ${t('away')}`].filter(Boolean).map(esc).join(' · ')}</p>
    ${p.meta ? `<p class="meta">${esc(p.meta)}</p>` : ''}
    ${p.address && p.address !== p.meta ? `<p class="meta">${esc(p.address)}</p>` : ''}
    <div class="tags">
      ${p.hours ? `<span class="tag">${t('hours')}: ${esc(p.hours)}</span>` : ''}
      ${near.map((a) => `<span class="tag ${a.severity === 'danger' ? 'danger' : 'warn'}">${esc(L(a, 'title'))}</span>`).join('')}
    </div>
    <div class="btns">
      <button class="btn" data-action="go" data-place="${esc(p.id)}">${icon('nav')}${t('directions')}</button>
      ${p.phone ? `<a class="btn-ghost" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;flex:0 0 auto" href="tel:${esc(p.phone.replace(/\s/g, ''))}">${icon('phone')}${t('call')}</a>` : ''}
    </div>
  </div>`;
}

function viewDrive() {
  const lang = getLang();
  if (!S.dest) {
    return `<div class="sh-head"><h2>${t('noDest')}</h2></div><p class="muted">${t('noDestHint')}</p>${quickGrid()}`;
  }
  const pts = `<div class="route-pts">
    <div class="route-pt"><span class="dot"></span><span>${S.routeOrigin === 'centre' ? t('mapCentre') : t('myLocation')}</span></div>
    <div class="route-pt"><span class="dot dest"></span><span>${esc(S.dest.name)}</span><button class="link" style="border:0;background:none;padding:0" data-action="clear-route" aria-label="${t('close')}">${icon('close')}</button></div>
  </div>`;
  if (S.routeStatus === 'loading') return `${pts}<div class="empty-state"><span class="spinner"></span>${t('routing')}</div>`;
  if (S.routeStatus === 'error') return `${pts}<div class="empty-state">${icon('nav')}${t('routeFailed')}<button class="btn-ghost" data-action="reroute">${t('retry')}</button></div>`;
  const r = S.routes[S.routeIdx];
  if (!r) return pts;
  const alts = S.routes.length > 1 ? `<div class="alts" role="group">${S.routes.map((x, i) =>
    `<button class="alt" data-route="${i}" aria-pressed="${i === S.routeIdx}"><b>${fmtDur(x.duration, lang)}</b>${t(x.label)} · ${fmtDist(x.distance / 1000)}${x.hits.length ? ` · ⚠ ${x.hits.length}` : ''}</button>`).join('')}</div>` : '';
  const warn = r.hits.length
    ? `<div class="note">${icon('accident')}<div><b>${t('routeWarn')}</b><br>${r.hits.slice(0, 3).map((a) => esc(`${L(a, 'title')}${a.place ? ` · ${a.place}` : ''}`)).join('<br>')}</div></div>`
    : `<p class="muted" style="margin-bottom:10px;color:var(--success)">${t('routeOk')}</p>`;
  const steps = r.steps.map((s) => `<li class="row"><span class="ic info">${maneuverIcon(s)}</span><span class="mid"><b style="font-size:15px;font-weight:500;white-space:normal">${esc(stepText(s, lang))}</b></span><span class="end"><small style="color:var(--text-subtle)">${s.distance ? fmtDist(s.distance / 1000) : ''}</small></span></li>`).join('');
  return `${pts}
    <div class="summary"><b>${fmtDur(r.duration, lang)}</b><span>${fmtDist(r.distance / 1000)}${r.via ? ` · ${t('via')} ${esc(r.via)}` : ''}</span></div>
    ${alts}${warn}
    <button class="btn" data-action="start-nav">${icon('nav')}${t('start')}</button>
    <div class="sh-head" style="margin-top:16px"><h2 style="font-size:16px">${t('steps')}</h2></div>
    <ol class="list steps">${steps}</ol>`;
}

function viewAlerts() {
  const lang = getLang();
  const ref = origin();
  const kinds = [['all', 'all'], ['flood', 'flood'], ['weather', 'weather'], ['quake', 'quake'], ['report', 'reports']];
  const list = allAlerts().filter((a) => S.alertFilter === 'all' || a.kind === S.alertFilter);
  const filters = `<div class="filters" role="group">${kinds.map(([k, label]) => {
    const n = allAlerts().filter((a) => k === 'all' || a.kind === k).length;
    return `<button class="chip" data-filter="${k}" aria-pressed="${S.alertFilter === k}">${t(label)} ${n}</button>`;
  }).join('')}</div>`;
  const head = `<div class="sh-head"><h2>${t('alertsTitle')}</h2><small style="color:var(--text-subtle);font-size:12px">${S.alertsAt ? `${t('updated')} ${fmtAgo(S.alertsAt, lang)}` : ''}</small></div>`;
  if (S.alertMode === 'loading') return `${head}<div class="empty-state"><span class="spinner"></span></div>`;
  const sample = S.alertMode === 'sample' ? `<div class="note">${icon('accident')}<span>${t('sample')}</span></div>` : '';
  const rows = list.length ? `<ul class="list">${list.slice(0, 150).map((a) => {
    const d = a.lat != null ? distKm(ref, [a.lon, a.lat]) : null;
    const ic = a.kind === 'report' ? (a.type === 'flood' ? 'flood' : a.type) : a.kind;
    return `<li><button class="row wrap" data-alert="${esc(a.id)}">
      <span class="ic ${a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info'}">${icon(ic)}</span>
      <span class="mid"><b style="font-size:15px">${esc(L(a, 'title'))}</b><small>${esc(a.place ? `${a.place} · ` : '')}${esc(L(a, 'desc'))}</small><small>${esc(a.source)} · ${esc(fmtAgo(a.time, lang))}</small></span>
      ${d != null ? `<span class="end"><b>${fmtDist(d)}</b></span>` : ''}
    </button></li>`;
  }).join('')}</ul>` : `<div class="empty-state">${icon('weather')}${t('noAlerts')}</div>`;
  return `${head}${sample}${filters}${rows}<p class="source">${t('sourceNote')}</p>`;
}

// ---------------------------------------------------------------- layout sync
function syncLayout() {
  const sheet = $('#sheet');
  const top = $('.top');
  document.documentElement.style.setProperty('--sheet-peek', `${sheet.offsetHeight}px`);
  document.documentElement.style.setProperty('--top-h', `${top.offsetTop + top.offsetHeight + 12}px`);
}
new ResizeObserver(syncLayout).observe($('#sheet'));
new ResizeObserver(syncLayout).observe($('.top'));

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------------------------------------------------------------- search
const q = $('#q');
const results = $('#results');
let searchAbort, searchTimer, searchResults = [];

q.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const v = q.value.trim();
  if (v.length < 2) { results.hidden = true; return; }
  searchTimer = setTimeout(() => runSearch(v), 280);
});
q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; q.blur(); } });
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (searchResults[0]) pickResult(searchResults[0]);
  else if (q.value.trim().length >= 2) runSearch(q.value.trim());
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search, .results')) results.hidden = true; });

async function runSearch(v) {
  searchAbort?.abort();
  searchAbort = new AbortController();
  results.hidden = false;
  results.innerHTML = `<li class="empty"><span class="spinner" style="display:inline-block;vertical-align:middle"></span></li>`;
  try {
    searchResults = await searchPlaces(v, center(), searchAbort.signal);
    results.innerHTML = searchResults.length
      ? searchResults.map((r, i) => `<li><button type="button" role="option" data-i="${i}">${icon('pin')}<span><b>${esc(r.name)}</b><small>${esc(r.sub || t('inMalaysia'))}</small></span></button></li>`).join('')
      : `<li class="empty">${t('none').split('.')[0]}.</li>`;
  } catch (e) {
    if (e.name !== 'AbortError') results.innerHTML = `<li class="empty">${t('failed')}</li>`;
  }
}

results.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) pickResult(searchResults[Number(b.dataset.i)]);
});

function pickResult(r) {
  results.hidden = true;
  q.value = r.name;
  q.blur();
  const p = { id: `search-${r.id}`, cat: null, name: r.name, lat: r.lat, lon: r.lon, meta: r.sub, distKm: distKm(origin(), [r.lon, r.lat]) };
  S.dest = { id: p.id, name: r.name, lat: r.lat, lon: r.lon };
  map.flyTo({ center: [r.lon, r.lat], zoom: 15, padding: mapPadding(), duration: 900 });
  S.selected = { ...p, cat: 'pin' };
  S.tab = 'explore';
  drawDest();
  render();
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cat],[data-place],[data-action],[data-route],[data-filter],[data-alert],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) { setTab(el.dataset.tab); return; }
  if (el.dataset.cat) { loadPlaces(S.cat === el.dataset.cat && S.tab === 'explore' ? null : el.dataset.cat); return; }
  if (el.dataset.filter) { S.alertFilter = el.dataset.filter; render(); return; }
  if (el.dataset.route) { S.routeIdx = Number(el.dataset.route); drawRoutes(); render(); return; }
  if (el.dataset.alert) {
    const a = allAlerts().find((x) => x.id === el.dataset.alert);
    if (a?.lat != null) { map.flyTo({ center: [a.lon, a.lat], zoom: a.kind === 'quake' ? 6 : 13, padding: mapPadding() }); alertPopup(a); }
    return;
  }
  const act = el.dataset.action;
  const findPlace = (id) => S.places.find((p) => p.id === id) || (S.selected?.id === id ? S.selected : null);
  if (act === 'go') { const p = findPlace(el.dataset.place); if (p) routeTo({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }); return; }
  if (el.dataset.place && !act) { const p = findPlace(el.dataset.place); if (p) selectPlace(p); return; }
  if (act === 'toggle-all') { S.showAll = !S.showAll; if (S.showAll) $('#sheet').classList.add('expanded'); render(); }
  if (act === 'retry') loadPlaces(S.cat);
  if (act === 'back') { S.selected = null; drawPlaces(); render(); }
  if (act === 'clear-route') clearRoute();
  if (act === 'reroute' && S.dest) routeTo(S.dest);
  if (act === 'start-nav') startNav();
});

$('#grab').addEventListener('click', () => { $('#sheet').classList.toggle('expanded'); });
$('#locate-btn').addEventListener('click', () => locate());
$('#hud-stop').addEventListener('click', stopNav);
$('#lang-btn').addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'bm' : 'en');
  $('#lang-btn').textContent = getLang() === 'en' ? 'BM' : 'EN';
  renderChips(); renderBanner(); render(); renderReportGrid();
  if (S.nav) updateHud();
});
$('#alerts-layer-btn').addEventListener('click', (e) => {
  S.showAlertLayer = !S.showAlertLayer;
  e.currentTarget.setAttribute('aria-pressed', String(S.showAlertLayer));
  drawAlerts();
});

// Report dialog
const dlg = $('#report-dlg');
function renderReportGrid() {
  $('#report-grid').innerHTML = REPORT_TYPES.map((r) =>
    `<button type="button" data-report="${r.id}">${icon(r.id === 'flood' ? 'flood' : r.id)}${esc(getLang() === 'bm' ? r.bm : r.en)}</button>`).join('');
}
$('#report-btn').addEventListener('click', () => { renderReportGrid(); dlg.showModal(); });
$('#report-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-report]');
  if (!b) return;
  const c = center();
  const r = addReport(b.dataset.report, c[1], c[0]);
  S.reports = [...S.reports, r];
  dlg.close();
  drawAlerts(); renderBanner(); render();
  toast(t('reported'));
});

// ---------------------------------------------------------------- boot
applyStatic();
$('#lang-btn').textContent = getLang() === 'en' ? 'BM' : 'EN';
renderChips();
render();
renderReportGrid();
locate({ fly: true, quiet: true });
refreshAlerts();
setInterval(refreshAlerts, ALERT_REFRESH_MS);

// deep link: ?cat=ev
const urlCat = new URLSearchParams(location.search).get('cat');
if (urlCat && CATEGORIES[urlCat]) mapReady.then(() => loadPlaces(urlCat));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
