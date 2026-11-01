import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { t, L, getLang, setLang, applyStatic } from './lib/i18n.js';
import { icon, maneuverIcon } from './lib/icons.js';
import { distKm, distToLineKm, fmtDist, fmtDur, fmtAgo, circle, KL, MY_BBOX } from './lib/geo.js';
import { CATEGORIES, fetchNearby, prefetchNearby } from './lib/places.js';
import { searchPlaces, reverseName } from './lib/search.js';
import { getRoutes, stepText } from './lib/routing.js';
import { loadAlerts } from './lib/alerts.js';
import { speak, spokenDist, setVoice, voiceOn, voiceSupported } from './lib/voice.js';
import { PIN_TYPES } from './lib/pin-types.js';
import { listPins, addPin, removePin } from './lib/pins.js';
import * as pinsMod from './lib/pins.js';
import { fetchWeather, wmo, aqiLabel, AQ_LEVELS, placeName, radarFrames } from './lib/weather.js';
import { HOTLINE_GROUPS } from './lib/hotlines.js';

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';
const ALERT_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- state
const S = {
  stats: null,
  tab: 'explore',
  cat: null,
  places: [], placesStatus: 'idle', showAll: false, placesCenter: null,
  selected: null,           // place object shown in detail card
  dest: null,               // { name, lat, lon }
  start: null,              // custom start { name, lat, lon }; null = my location
  ptEdit: null,             // 'start' | 'end' while its search box is open in the Drive tab
  picking: null,            // 'start' | 'end' while waiting for a tap on the map
  routes: [], routeIdx: 0, routeStatus: 'idle', routeOrigin: null,
  alerts: [], alertMode: 'loading', alertsAt: null, alertFilter: 'all',
  reports: [],
  wx: null, wxStatus: 'idle', wxPlace: '', radar: false,
  news: [], newsStatus: 'idle', newsAt: 0, newsRegion: 'all', newsTopic: 'all',
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
  attributionControl: { compact: true, customAttribution: '© 2026 Yush Abdullah' },
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
let startMarker = null;
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

function drawStart() {
  startMarker?.remove();
  startMarker = null;
  if (!S.start) return;
  startMarker = new maplibregl.Marker({ element: pinEl('start', 'nav', S.start.name) }).setLngLat([S.start.lon, S.start.lat]).addTo(map);
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
    el.className = `report-pin sev-${r.severity}${r.mine ? ' mine' : ''}`;
    el.setAttribute('aria-label', L(r, 'title'));
    el.innerHTML = icon(r.icon || 'report');
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
    .setHTML(`<b>${esc(L(a, 'title'))}</b>${a.place ? `${esc(a.place)}<br>` : ''}${esc(L(a, 'desc'))}<br><small>${esc(a.source)} · ${esc(fmtAgo(a.time, getLang()))}</small>${a.mine ? `<button class="unpin" data-unpin="${esc(a.pinId)}">${icon('close')}${t('unpin')}</button>` : ''}`)
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
    loadWeather(true);
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
  openSheet();
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
  openSheet();
  S.selected = p;
  S.tab = 'explore';
  drawPlaces();
  map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), padding: mapPadding(), duration: 600 });
  render();
}

let routeAbort;
function routeTo(dest) {
  S.dest = dest;
  return computeRoute();
}

// Route from the start point (my location unless the user picked one) to S.dest.
async function computeRoute() {
  openSheet();
  S.tab = 'drive';
  S.routes = []; S.routeIdx = 0;
  drawDest(); drawStart(); drawRoutes();
  if (!S.dest) { S.routeStatus = 'idle'; render(); return; }
  S.routeStatus = 'loading';
  render();
  if (!S.start && !S.me) await locate({ fly: false, quiet: false });
  const from = S.start ? [S.start.lon, S.start.lat] : origin();
  const dest = S.dest;
  S.routeOrigin = S.start ? 'custom' : S.me ? 'me' : 'centre';
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

// ---------------------------------------------------------------- start / end points
function setPoint(which, p) {
  S.ptEdit = null; S.picking = null;
  document.body.classList.remove('picking');
  if (which === 'start') S.start = p; else S.dest = p;
  computeRoute();
}

async function swapPoints() {
  if (!S.dest) return;
  let from = S.start;
  if (!from) {
    if (!S.me) await locate({ fly: false, quiet: false });
    if (!S.me) return;
    from = { id: 'me', name: t('myLocation'), lon: S.me[0], lat: S.me[1] };
  }
  // "My location" moving into the start slot goes back to following GPS.
  S.start = S.dest.id === 'me' ? null : S.dest;
  S.dest = from;
  S.ptEdit = null;
  computeRoute();
}

function pickOnMap(which) {
  S.ptEdit = null; S.picking = which;
  document.body.classList.add('picking');
  setSheet('peek');
  render();
  toast(which === 'start' ? t('tapStart') : t('tapEnd'));
}

async function pickedAt(lngLat) {
  const which = S.picking;
  const p = { id: `map-${lngLat.lng.toFixed(5)},${lngLat.lat.toFixed(5)}`, name: t('droppedPin'), lon: lngLat.lng, lat: lngLat.lat };
  setSheet('half');
  setPoint(which, p);
  const name = await reverseName(p.lat, p.lon);
  if (name && (S.start === p || S.dest === p)) { p.name = name; drawStart(); drawDest(); if (S.tab === 'drive') render(); }
}

let ptResults = [];
let ptTimer, ptAbort;
function ptSearch(v) {
  clearTimeout(ptTimer);
  const list = $('#pt-results');
  if (!list) return;
  if (v.length < 2) { list.querySelectorAll('.pt-hit').forEach((li) => li.remove()); return; }
  ptTimer = setTimeout(async () => {
    ptAbort?.abort();
    ptAbort = new AbortController();
    try {
      ptResults = await searchPlaces(v, center(), ptAbort.signal);
      if (!$('#pt-results')) return;
      $('#pt-results').querySelectorAll('.pt-hit').forEach((li) => li.remove());
      $('#pt-results').insertAdjacentHTML('afterbegin', ptResults.length
        ? ptResults.map((r, i) => `<li class="pt-hit"><button type="button" class="row" data-action="pt-result" data-i="${i}"><span class="ic">${icon('pin')}</span><span class="mid"><b>${esc(r.name)}</b><small>${esc(r.sub || t('inMalaysia'))}</small></span></button></li>`).join('')
        : `<li class="pt-hit empty muted">${t('none').split('.')[0]}.</li>`);
    } catch (e) {
      if (e.name !== 'AbortError' && $('#pt-results')) $('#pt-results').insertAdjacentHTML('beforeend', `<li class="pt-hit empty muted">${t('failed')}</li>`);
    }
  }, 280);
}
document.addEventListener('input', (e) => { if (e.target.id === 'pt-q') ptSearch(e.target.value.trim()); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'pt-q') return;
  if (e.key === 'Escape') { S.ptEdit = null; render(); }
  if (e.key === 'Enter') { e.preventDefault(); if (ptResults[0]) setPoint(S.ptEdit, toPoint(ptResults[0])); }
});
const toPoint = (r) => ({ id: `search-${r.id}`, name: r.name, lat: r.lat, lon: r.lon });

function alertsOnRoute(coords) {
  const sampled = coords.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 400)) === 0 || i === a.length - 1);
  return allAlerts().filter((a) => a.lat != null && a.kind !== 'quake' && distToLineKm([a.lon, a.lat], sampled) <= (a.radiusKm || 1));
}

function clearRoute() {
  routeAbort?.abort();
  S.routes = []; S.dest = null; S.routeStatus = 'idle'; S.ptEdit = null;
  drawRoutes(); drawDest(); render();
}

// ---------------------------------------------------------------- navigation
const OFF_ROUTE_KM = 0.06;      // > 60 m from the line counts as off route
const VOICE_STAGES = [          // [metres before the turn, stage id]
  [1200, 'far'], [500, 'mid'], [120, 'near'],
];

function startNav() {
  const r = S.routes[S.routeIdx];
  if (!r) return;
  S.nav = { step: 1, watchId: null, said: new Set(), offCount: 0, rerouting: false, alertSaid: new Set() };
  document.body.classList.add('navigating');
  $('#hud').hidden = false;
  syncVoiceBtn();
  // First announcement happens inside the tap, which unlocks speech on iOS.
  const lang = getLang();
  speak(`${lang === 'bm' ? 'Mula navigasi.' : 'Starting navigation.'} ${stepText(r.steps[0], lang)}. ${announce(r.steps[1], r.steps[0].distance, lang)}`, lang);
  markSaid(1, r.steps[0].distance);
  if (navigator.geolocation) {
    S.nav.watchId = navigator.geolocation.watchPosition(onNavPos, () => {}, { enableHighAccuracy: true, maximumAge: 1000 });
  }
  map.easeTo({ center: S.me || r.coords[0], zoom: 16.5, pitch: 45, padding: mapPadding(), duration: 800 });
  updateHud();
}

/** "In 500 metres, turn left onto Jalan Pudu" */
function announce(step, metres, lang) {
  if (!step) return '';
  const text = stepText(step, lang);
  if (metres == null || metres < 150) return text;
  const lower = text.charAt(0).toLowerCase() + text.slice(1);
  return lang === 'bm' ? `Dalam ${spokenDist(metres, lang)}, ${lower}` : `In ${spokenDist(metres, lang)}, ${lower}`;
}

function onNavPos(pos) {
  const r = S.routes[S.routeIdx];
  if (!r || !S.nav || S.nav.rerouting) return;
  S.me = [pos.coords.longitude, pos.coords.latitude];
  drawMe();
  const lang = getLang();

  // Off route? Three bad fixes in a row (ignoring very inaccurate fixes) triggers a reroute.
  const near = r.coords.slice(Math.max(0, nearestIdx(r, S.me) - 30), nearestIdx(r, S.me) + 30);
  const off = distToLineKm(S.me, near.length > 1 ? near : r.coords) > Math.max(OFF_ROUTE_KM, (pos.coords.accuracy || 0) / 1000);
  S.nav.offCount = off ? S.nav.offCount + 1 : 0;
  if (S.nav.offCount >= 3) { reroute(); return; }

  // Advance past steps we've reached.
  while (S.nav.step < r.steps.length - 1 && distKm(S.me, r.steps[S.nav.step].location) < 0.03) S.nav.step++;
  const step = r.steps[S.nav.step];
  const m = distKm(S.me, step.location) * 1000;

  // Voice prompts at 1.2 km, 500 m and ~120 m before each turn, and on arrival.
  if (step.type === 'arrive' && m < 40) {
    if (!S.nav.said.has('arrived')) { S.nav.said.add('arrived'); speak(t('arrived'), lang); }
  } else {
    // closest stage first, so entering a short step speaks once, not twice
    for (const [limit, id] of [...VOICE_STAGES].reverse()) {
      const key = `${S.nav.step}:${id}`;
      if (m > limit) continue;
      if (!S.nav.said.has(key)) {
        VOICE_STAGES.forEach(([l, other]) => { if (l >= limit) S.nav.said.add(`${S.nav.step}:${other}`); });
        speak(id === 'near' ? stepText(step, lang) : announce(step, m, lang), lang);
      }
      break;
    }
  }

  // Warn once when an active alert on this route is within 2 km.
  for (const a of r.hits || []) {
    if (S.nav.alertSaid.has(a.id) || distKm(S.me, [a.lon, a.lat]) > 2 + (a.radiusKm || 0)) continue;
    S.nav.alertSaid.add(a.id);
    speak(lang === 'bm' ? `Amaran di hadapan: ${L(a, 'title')}. Pandu dengan berhati-hati.` : `Alert ahead: ${L(a, 'title')}. Drive carefully.`, lang);
    toast(`${L(a, 'title')}${a.place ? ` · ${a.place}` : ''}`);
  }

  map.easeTo({ center: S.me, bearing: Number.isFinite(pos.coords.heading) && pos.coords.speed > 1 ? pos.coords.heading : map.getBearing(), duration: 600 });
  updateHud();
}

/** Remember which prompts for a step are already covered by an announcement made at `metres`. */
function markSaid(stepIdx, metres) {
  VOICE_STAGES.forEach(([limit, id]) => { if (limit >= metres) S.nav.said.add(`${stepIdx}:${id}`); });
}

function nearestIdx(r, p) {
  let best = 0, bd = Infinity;
  const stride = Math.max(1, Math.floor(r.coords.length / 2000));
  for (let i = 0; i < r.coords.length; i += stride) {
    const d = distKm(p, r.coords[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

async function reroute() {
  if (!S.nav || !S.dest || !S.me) return;
  S.nav.rerouting = true;
  const lang = getLang();
  speak(lang === 'bm' ? 'Mengira semula laluan' : 'Rerouting', lang);
  $('#hud-text').textContent = lang === 'bm' ? 'Mengira semula laluan…' : 'Rerouting…';
  try {
    const routes = await getRoutes(S.me, [S.dest.lon, S.dest.lat]);
    if (!S.nav) return;
    routes.forEach((x) => { x.hits = alertsOnRoute(x.coords); x.label = 'fastest'; });
    S.routes = [routes[0]]; S.routeIdx = 0;
    S.nav.step = 1; S.nav.said = new Set(); S.nav.offCount = 0;
    drawRoutes();
    speak(announce(routes[0].steps[1], routes[0].steps[0].distance, lang), lang);
    markSaid(1, routes[0].steps[0].distance);
  } catch { /* keep the old route, try again on the next bad fixes */ }
  if (S.nav) { S.nav.rerouting = false; S.nav.offCount = 0; updateHud(); }
}

function updateHud() {
  const r = S.routes[S.routeIdx];
  const s = r.steps[Math.min(S.nav.step, r.steps.length - 1)];
  const d = S.me ? distKm(S.me, s.location) : s.distance / 1000;
  $('#hud-ic').innerHTML = maneuverIcon(s);
  $('#hud-dist').textContent = s.type === 'arrive' && d < 0.05 ? t('arrived') : fmtDist(d);
  $('#hud-text').textContent = stepText(s, getLang());
  const current = r.steps[Math.max(0, S.nav.step - 1)]?.name;
  $('#hud-road').textContent = current ? `${getLang() === 'bm' ? 'Kini di' : 'On'} ${current}` : '';
  const remain = r.steps.slice(S.nav.step).reduce((acc, x) => ({ d: acc.d + x.distance, t: acc.t + x.duration }), { d: 0, t: 0 });
  const eta = new Date(Date.now() + remain.t * 1000).toLocaleTimeString(getLang() === 'bm' ? 'ms-MY' : 'en-MY', { hour: 'numeric', minute: '2-digit' });
  $('#hud-eta').textContent = `${fmtDur(remain.t, getLang())} · ${fmtDist(remain.d / 1000)} · ETA ${eta}`;
}

function syncVoiceBtn() {
  const b = $('#hud-voice');
  b.hidden = !voiceSupported();
  b.setAttribute('aria-pressed', String(voiceOn()));
  b.setAttribute('aria-label', voiceOn() ? t('voiceOff') : t('voiceOn'));
  b.innerHTML = icon(voiceOn() ? 'sound' : 'mute');
}

function stopNav() {
  if (S.nav?.watchId != null) navigator.geolocation.clearWatch(S.nav.watchId);
  S.nav = null;
  if (voiceSupported()) speechSynthesis.cancel();
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
  $('#banner-title').textContent = `${L(n.a, 'title')}${S.alertMode === 'sample' && n.a.kind !== 'report' ? ' · SAMPLE' : ''}`;
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
  if (tab === 'weather') loadWeather();
  if (tab === 'news') loadNews();
  if (sheetState === 'peek') setSheet('half');
  S.tab = tab;
  render();
  renderBanner();
  renderNewsBar();
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const body = $('#sheet-body');
  body.innerHTML = S.tab === 'drive' ? viewDrive() : S.tab === 'alerts' ? viewAlerts() : S.tab === 'weather' ? viewWeather() : S.tab === 'news' ? viewNews() : (S.selected ? viewPlace() : viewExplore());
  body.insertAdjacentHTML('beforeend', `${statsLine()}<p class="copyright">${t('copyright')}<br><a href="/terms.html">${t('terms')}</a> · <a href="/privacy.html">${t('privacy')}</a> · <button class="linkish" data-action="subscribe">${t('subLink')}</button></p>`);
  syncLayout();
  if (S.tab === 'drive' && S.ptEdit) $('#pt-q')?.focus({ preventScroll: true });
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
    return `<div class="sh-head"><h2>${t('pickCat')}</h2></div><p class="muted">${t('pickCatHint')}</p>${quickGrid()}<div class="sub-card"><span class="sub-ic">${icon('mail')}</span><span class="mid"><b>${t('subTitle')}</b><small>${t('subCard')}</small></span><button class="btn sm" data-action="subscribe">${t('subBtn')}</button></div>`;
  }
  const c = CATEGORIES[S.cat];
  const head = `<div class="sh-head"><h2>${esc(c[getLang()])} ${t('nearby').toLowerCase()}</h2>${S.places.length > 3 ? `<button class="link" data-action="toggle-all">${S.showAll ? t('showLess') : `${t('seeAll')} (${S.places.length})`}</button>` : ''}</div>`;
  if (S.placesStatus === 'loading') return `${head}<div class="empty-state"><span class="spinner"></span>${t('loading')}</div>`;
  if (S.placesStatus === 'error') return `${head}<div class="empty-state">${icon('search')}${t('failed')}<button class="btn-ghost" data-action="retry">${t('retry')}</button>${gmapsBtn(S.cat)}</div>`;
  if (S.placesStatus === 'empty') return `${head}<div class="empty-state">${icon('search')}${t('none')}<button class="btn-ghost" data-action="retry">${t('searchArea')}</button>${gmapsBtn(S.cat)}</div>`;
  const list = S.showAll ? S.places : S.places.slice(0, 3);
  const first = S.places[0];
  return `${head}<ul class="list">${list.map(placeRow).join('')}</ul>
    <div class="btns"><button class="btn" data-action="go" data-place="${esc(first.id)}">${icon('nav')}${t('directions')}: ${esc(first.name)}</button></div>
    <p class="gmaps-row">${t('gmapsMore')} ${gmapsBtn(S.cat)}</p>`;
}

// "Search on Google Maps" hand-off: opens Google Maps (app or web) searching this category near the
// area being viewed. Uses the official Maps URLs, so no API key, no cost, and no Google data on our map.
const GMAPS_Q = {
  ev: 'EV charging station', fuel: 'petrol station', food: 'fast food', toilet: 'public toilet',
  surau: 'surau masjid', hospital: 'hospital klinik', workshop: 'car workshop bengkel kereta',
};
function gmapsSearchUrl(cat) {
  const c = S.placesCenter || center();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${GMAPS_Q[cat] || CATEGORIES[cat].en} near ${c[1].toFixed(5)},${c[0].toFixed(5)}`)}`;
}
const gmapsBtn = (cat) => `<a class="btn-ghost gmaps" href="${gmapsSearchUrl(cat)}" target="_blank" rel="noopener">${icon('search')}${t('gmapsSearch')}</a>`;

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
    <p class="gmaps-row"><a class="btn-ghost gmaps" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.lat},${p.lon}`)}" target="_blank" rel="noopener">${icon('search')}${t('gmapsPlace')}</a></p>
  </div>`;
}

function ptRow(which) {
  const isStart = which === 'start';
  const p = isStart ? S.start : S.dest;
  if (S.ptEdit === which) {
    return `<div class="pt-edit">
      <div class="route-pt"><span class="dot${isStart ? '' : ' dest'}"></span>
        <label for="pt-q" class="sr-only">${t(isStart ? 'from' : 'to')}</label>
        <input id="pt-q" type="text" placeholder="${esc(t(isStart ? 'searchStart' : 'searchEnd'))}" enterkeyhint="search" autocomplete="off">
        <button class="pt-x" data-action="pt-cancel" aria-label="${t('close')}">${icon('close')}</button></div>
      <ul class="list pt-results" id="pt-results">
        <li><button type="button" class="row" data-action="pt-me"><span class="ic">${icon('nav')}</span><span class="mid"><b>${t('myLocation')}</b></span></button></li>
        <li><button type="button" class="row" data-action="pt-map"><span class="ic">${icon('pin')}</span><span class="mid"><b>${t('pickOnMap')}</b></span></button></li>
      </ul></div>`;
  }
  const name = isStart
    ? (p ? p.name : S.routeOrigin === 'centre' && S.dest ? t('mapCentre') : t('myLocation'))
    : (p ? p.name : t('chooseDest'));
  return `<div class="route-pt"><span class="dot${isStart ? '' : ' dest'}"></span>
    <button class="pt-btn${p || isStart ? '' : ' empty'}" data-action="edit-pt" data-pt="${which}"><small>${t(isStart ? 'from' : 'to')}</small><span>${esc(name)}</span></button>
    ${!isStart && p ? `<button class="pt-x" data-action="clear-route" aria-label="${t('clearDest')}">${icon('close')}</button>` : ''}
    ${isStart && S.start ? `<button class="pt-x" data-action="pt-reset-start" aria-label="${t('useMyLocation')}">${icon('close')}</button>` : ''}
  </div>`;
}

function viewDrive() {
  const lang = getLang();
  const pts = `<div class="route-pts">${ptRow('start')}${ptRow('end')}${S.dest && !S.ptEdit ? `<button class="pt-swap" data-action="pt-swap" aria-label="${t('swap')}" title="${t('swap')}">${icon('swap')}</button>` : ''}</div>`;
  if (!S.dest) {
    return `<div class="sh-head"><h2>${t('noDest')}</h2></div>${pts}${S.ptEdit ? '' : `<p class="muted">${t('noDestHint')}</p>${quickGrid()}`}`;
  }
  if (S.ptEdit) return pts;
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
  // Live turn-by-turn follows GPS, so it needs the route to begin where the user is.
  const go = S.start
    ? `<p class="muted pt-note">${t('previewOnly')}</p><button class="btn-ghost" data-action="pt-reset-start">${icon('nav')}${t('navFromMe')}</button>`
    : `<button class="btn" data-action="start-nav">${icon('nav')}${t('start')}</button>`;
  return `${pts}
    <div class="summary"><b>${fmtDur(r.duration, lang)}</b><span>${fmtDist(r.distance / 1000)}${r.via ? ` · ${t('via')} ${esc(r.via)}` : ''}</span></div>
    ${alts}${warn}
    ${go}
    <div class="sh-head" style="margin-top:16px"><h2 style="font-size:16px">${t('steps')}</h2></div>
    <ol class="list steps">${steps}</ol>`;
}

// ---------------------------------------------------------------- weather
async function loadWeather(force = false) {
  const at = origin();
  if (!force && S.wx && distKm([S.wx.lon, S.wx.lat], at) < 3 && Date.now() - new Date(S.wx.at).getTime() < 10 * 60e3) return;
  if (!S.wx) S.wxStatus = 'loading';
  if (S.tab === 'weather') render();
  try {
    const [wx, name] = await Promise.all([fetchWeather(at[1], at[0]), placeName(at[1], at[0])]);
    S.wx = wx; S.wxPlace = name; S.wxStatus = 'ok';
  } catch { if (!S.wx) S.wxStatus = 'error'; }
  renderWxFab();
  if (S.tab === 'weather') render();
}

function renderWxFab() {
  const b = $('#wx-btn');
  if (!S.wx) { b.hidden = true; return; }
  const w = wmo(S.wx.now.code, S.wx.now.isDay);
  b.hidden = false;
  b.innerHTML = `${icon(w.icon)}<b>${Math.round(S.wx.now.temp)}°</b>`;
  b.setAttribute('aria-label', `${Math.round(S.wx.now.temp)}° ${getLang() === 'bm' ? w.bm : w.en}. ${t('tabWeather')}`);
}

function viewWeather() {
  const lang = getLang();
  const nearPins = S.reports
    .filter((r) => distKm(origin(), [r.lon, r.lat]) < 25)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const pinRows = nearPins.length ? `<ul class="list">${nearPins.slice(0, 30).map((r) => `<li><div class="row">
      <button class="pinrow" data-alert="${esc(r.id)}"><span class="ic ${r.severity === 'danger' ? 'danger' : r.severity === 'warning' ? 'warn' : 'info'}">${icon(r.icon)}</span>
      <span class="mid"><b>${esc(L(r, 'title'))}</b><small>${fmtDist(distKm(origin(), [r.lon, r.lat]))} · ${esc(fmtAgo(r.time, lang))} · ${esc(L(r, 'desc'))}</small></span></button>
      ${r.mine ? `<button class="btn-ghost sm" data-unpin="${esc(r.pinId)}">${t('unpin')}</button>` : ''}
    </div></li>`).join('')}</ul>` : `<p class="muted">${t('noPins')}</p>`;
  const community = `<div class="sh-head" style="margin-top:18px"><h2 style="font-size:18px">${t('communityWx')}</h2><span class="live-dot">${pinsMod.shared ? t('liveShared') : t('deviceOnly')}</span></div>
    ${pinRows}
    <div class="btns"><button class="btn" data-action="pin-weather">${icon('pin')}${t('pinWeather')}</button></div>`;
  if (S.wxStatus === 'loading' || (!S.wx && S.wxStatus === 'idle')) return `<div class="empty-state"><span class="spinner"></span></div>${community}`;
  if (!S.wx) return `<div class="empty-state">${icon('cloud')}${t('wxFailed')}<button class="btn-ghost" data-action="wx-retry">${t('retry')}</button></div>${community}`;
  const w = S.wx, n = w.now, cur = wmo(n.code, n.isDay), today = w.days[0];
  const hours = w.hours.slice(0, 13).map((h, i) => {
    const c = wmo(h.code, h.isDay);
    const label = i === 0 ? t('now') : new Date(`${h.time}:00+08:00`).toLocaleTimeString(lang === 'bm' ? 'ms-MY' : 'en-MY', { hour: 'numeric' });
    return `<li><span>${esc(label)}</span>${icon(c.icon)}<small class="pop">${h.pop >= 20 ? `${h.pop}%` : '&nbsp;'}</small><b>${Math.round(h.temp)}°</b></li>`;
  }).join('');
  const lo = Math.min(...w.days.map((d) => d.min)), hi = Math.max(...w.days.map((d) => d.max));
  const days = w.days.map((d, i) => {
    const c = wmo(d.code, 1);
    const name = i === 0 ? t('today') : new Date(`${d.date}T12:00:00+08:00`).toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', { weekday: 'short' });
    const left = ((d.min - lo) / (hi - lo || 1)) * 100, width = ((d.max - d.min) / (hi - lo || 1)) * 100;
    return `<li><span class="d">${esc(name)}</span>${icon(c.icon)}<small class="pop">${d.pop >= 20 ? `${d.pop}%` : ''}</small><span class="lo">${Math.round(d.min)}°</span><span class="bar"><i style="left:${left}%;width:${Math.max(width, 6)}%"></i></span><span class="hi">${Math.round(d.max)}°</span></li>`;
  }).join('');
  const aq = aqiLabel(w.aqi);
  return `<div class="wx-card sky-${cur.sky}">
      <div class="wx-top"><div><div class="wx-place">${esc(S.wxPlace || t('myLocation'))}</div><div class="wx-temp">${Math.round(n.temp)}°</div><div class="wx-cond">${esc(lang === 'bm' ? cur.bm : cur.en)}</div>
      <div class="wx-hl">H ${Math.round(today.max)}° · L ${Math.round(today.min)}° · ${t('feels')} ${Math.round(n.feels)}°</div></div>
      <span class="wx-big">${icon(cur.icon)}</span></div>
      <ul class="wx-hours">${hours}</ul>
    </div>
    <div class="wx-stats">
      <div><small>${t('humidity')}</small><b>${Math.round(n.humidity)}%</b></div>
      <div><small>${t('wind')}</small><b>${Math.round(n.wind)} km/h</b></div>
      <div><small>UV</small><b>${today.uv != null ? Math.round(today.uv) : '–'}</b></div>
      <div class="aq-${aq?.level || 'na'}" data-action="poll-jump" role="button"><small>${t('air')}</small><b>${w.aqi != null ? Math.round(w.aqi) : '–'}</b><em>${aq ? esc(lang === 'bm' ? aq.bm : aq.en) : ''}</em></div>
    </div>
    <button class="btn-ghost radar-btn" data-action="radar" aria-pressed="${S.radar}">${icon('radar')}${S.radar ? t('radarOff') : t('radarOn')}</button>
    <h3 class="wx-h">${t('sevenDay')}</h3>
    <ul class="wx-days">${days}</ul>
    ${pollutionCard(w)}
    ${community}
    <p class="source">${t('wxSource')}</p>`;
}

// Pollution index: big number, a Clean -> Worst scale with a marker, the level list and pollutants.
function pollutionCard(w) {
  const lang = getLang();
  if (w.aqi == null) return `<section class="poll" id="poll"><h3 class="wx-h">${t('pollution')}</h3><p class="muted">${t('pollNa')}</p></section>`;
  const aq = aqiLabel(w.aqi);
  const pos = Math.min(w.aqi, 300) / 300 * 100; // scale runs 0..300+, the last band is "worst"
  const levels = AQ_LEVELS.map((l, i) => {
    const lo = i ? AQ_LEVELS[i - 1].max + 1 : 0, range = l.max === Infinity ? `${lo}+` : `${lo}–${l.max}`;
    return `<li class="${l === aq ? 'on' : ''}"><i style="background:${l.color}"></i><span>${esc(lang === 'bm' ? l.bm : l.en)}</span><b>${range}</b></li>`;
  }).join('');
  const a = w.air || {};
  const part = (k, label) => (a[k] != null ? `<div><small>${label}</small><b>${Math.round(a[k])}</b></div>` : '');
  const peak = a.peak && aqiLabel(a.peak.aqi);
  const peakTime = a.peak ? new Date(`${a.peak.time}:00+08:00`).toLocaleTimeString(lang === 'bm' ? 'ms-MY' : 'en-MY', { weekday: 'short', hour: 'numeric' }) : '';
  return `<section class="poll" id="poll">
    <h3 class="wx-h">${t('pollution')}</h3>
    <div class="poll-card" style="--lvl:${aq.color}">
      <div class="poll-top">
        <div class="poll-num"><b>${Math.round(w.aqi)}</b><small>${t('pollNow')}</small></div>
        <div class="poll-txt"><b>${esc(lang === 'bm' ? aq.bm : aq.en)}</b><p>${esc(aq.adv[lang] || aq.adv.en)}</p></div>
      </div>
      <div class="poll-scale" role="img" aria-label="${t('pollution')} ${Math.round(w.aqi)} / 300+">
        <div class="poll-bar"><span class="poll-mark" style="left:${pos}%"></span></div>
        <div class="poll-ends"><span>${t('pollClean')} · 0</span><span>300+ · ${t('pollWorst')}</span></div>
      </div>
      ${peak ? `<p class="poll-peak">${t('pollPeak')}: <b style="color:${peak.color}">${Math.round(a.peak.aqi)} · ${esc(lang === 'bm' ? peak.bm : peak.en)}</b> <small>(${esc(peakTime)})</small></p>` : ''}
    </div>
    <h4 class="poll-h">${t('pollLevels')}</h4>
    <ul class="poll-levels">${levels}</ul>
    <h4 class="poll-h">${t('pollParts')}</h4>
    <div class="poll-parts">${part('pm25', 'PM2.5')}${part('pm10', 'PM10')}${part('o3', 'O₃')}${part('no2', 'NO₂')}${part('so2', 'SO₂')}${part('co', 'CO')}</div>
    <p class="source">${t('pollSource')} <a href="https://eqms.doe.gov.my/APIMS/main" target="_blank" rel="noopener">APIMS (DOE)</a>.</p>
  </section>`;
}

// Rain radar (RainViewer): animated frames over the past ~2 hours.
let radarTimer = null, radarIds = [];
async function toggleRadar(on = !S.radar) {
  S.radar = on;
  await mapReady;
  clearInterval(radarTimer);
  radarIds.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
  radarIds = [];
  if (on) {
    try {
      const frames = (await radarFrames()).slice(-10);
      const before = map.getLayer('alert-fill') ? 'alert-fill' : undefined;
      frames.forEach((f, i) => {
        const id = `radar-${i}`;
        map.addSource(id, { type: 'raster', tiles: [f.url], tileSize: 256, maxzoom: 7, attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>' });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 300 } } }, before);
        radarIds.push(id);
      });
      let k = 0;
      const show = () => {
        radarIds.forEach((id, i) => map.setPaintProperty(id, 'raster-opacity', i === k ? 0.65 : 0));
        k = (k + 1) % radarIds.length;
      };
      show();
      radarTimer = setInterval(show, 700);
      if (map.getZoom() > 9) map.easeTo({ zoom: 8, duration: 600 });
    } catch { S.radar = false; toast(t('radarFailed')); }
  }
  $('#radar-fab').setAttribute('aria-pressed', String(S.radar));
  if (S.tab === 'weather') render();
}

// ---------------------------------------------------------------- community pins
async function loadPins() {
  try { S.reports = await listPins(); } catch { /* keep old */ }
  drawAlerts(); renderBanner();
  if (S.tab === 'weather' || S.tab === 'alerts') render();
}

async function unpin(pinId) {
  popup?.remove();
  const ok = await removePin(pinId).catch(() => false);
  if (ok) { S.reports = S.reports.filter((r) => r.pinId !== pinId); toast(t('unpinned')); }
  else toast(t('unpinFailed'));
  drawAlerts(); renderBanner(); render();
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
    const ic = a.kind === 'report' ? (a.icon || 'report') : a.kind;
    return `<li><button class="row wrap" data-alert="${esc(a.id)}">
      <span class="ic ${a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info'}">${icon(ic)}</span>
      <span class="mid"><b style="font-size:15px">${esc(L(a, 'title'))}</b><small>${esc(a.place ? `${a.place} · ` : '')}${esc(L(a, 'desc'))}</small><small>${esc(a.source)} · ${esc(fmtAgo(a.time, lang))}</small></span>
      ${d != null ? `<span class="end"><b>${fmtDist(d)}</b></span>` : ''}
    </button></li>`;
  }).join('')}</ul>` : `<div class="empty-state">${icon('weather')}${t('noAlerts')}</div>`;
  return `${head}${sample}${filters}${rows}<p class="source">${t('sourceNote')}</p>`;
}

// ---------------------------------------------------------------- live news (environment & nature)
async function loadNews(force = false) {
  if (!force && (S.newsStatus === 'loading' || (S.news.length && Date.now() - S.newsAt < 10 * 60e3))) return;
  S.newsStatus = 'loading'; if (S.tab === 'news') render();
  try {
    const r = await fetch('/api/news');
    const j = await r.json();
    if (!j.items?.length) throw new Error('empty');
    S.news = j.items; S.newsAt = Date.now(); S.newsStatus = 'ok';
  } catch { S.newsStatus = S.news.length ? 'ok' : 'error'; }
  if (S.tab === 'news') render();
  renderNewsBar();
}
setInterval(() => { if (!document.hidden) loadNews(); }, 5 * 60e3);
setTimeout(() => loadNews(), 2500);

// ---------------------------------------------------------------- public visitor counter
// Anonymous: the server keeps only a fuzzy daily count, never who visited (see api/stats.js).
function statsLine() {
  const st = S.stats;
  if (!st || !(st.today > 0)) return '';
  const n = (x) => Number(x).toLocaleString(getLang() === 'bm' ? 'ms-MY' : 'en-MY');
  const parts = [`<b>${n(st.today)}</b> ${t(st.today === 1 ? 'statVisitor' : 'statVisitors')}`];
  if (st.pins > 0) parts.push(`<b>${n(st.pins)}</b> ${t(st.pins === 1 ? 'statPin' : 'statPins')}`);
  return `<p class="stats-line" aria-live="polite">${icon('users')}<span>${parts.join(' · ')}</span></p>`;
}
async function loadStats() {
  try {
    const optOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
    const counted = (() => { try { return sessionStorage.getItem('navmap.counted') === '1'; } catch { return false; } })();
    const r = await fetch('/api/stats', { method: optOut || counted ? 'GET' : 'POST' });
    if (!r.ok) return;
    S.stats = await r.json();
    try { sessionStorage.setItem('navmap.counted', '1'); } catch { /* private mode */ }
    const el = document.querySelector('#sheet-body .stats-line');
    const html = statsLine();
    if (el) el.outerHTML = html || '';
    else if (html) document.querySelector('#sheet-body .copyright')?.insertAdjacentHTML('beforebegin', html);
  } catch { /* counter is optional */ }
}
setTimeout(loadStats, 1500);
setInterval(() => { if (!document.hidden) loadStats(); }, 10 * 60e3);

// Headline ticker above the alert banner: rotates the most relevant fresh stories, tap to read.
let newsBarTimer = null, newsBarIdx = 0;
const newsBarHidden = () => { try { return sessionStorage.getItem('navmap.newsbar') === 'off'; } catch { return false; } };
function newsBarItems() {
  const fresh = S.news.filter((n) => !n.time || Date.now() - new Date(n.time).getTime() < 24 * 3600e3);
  const score = (n) => (n.region === 'my' ? 2 : 0) + (['disaster', 'weather', 'haze'].includes(n.topic) ? 1 : 0);
  return [...fresh].sort((a, b) => score(b) - score(a) || (b.time || '').localeCompare(a.time || '')).slice(0, 6);
}
function renderNewsBar() {
  const bar = $('#news-bar');
  const items = newsBarItems();
  const show = items.length && S.tab !== 'news' && !newsBarHidden();
  bar.hidden = !show;
  clearInterval(newsBarTimer);
  if (show) {
    const paint = () => {
      const n = items[newsBarIdx % items.length];
      const txt = $('#news-bar-txt');
      txt.classList.remove('in'); void txt.offsetWidth; txt.classList.add('in');
      $('#news-bar-tag').textContent = n.region === 'my' ? (getLang() === 'bm' ? 'BERITA' : 'NEWS') : (getLang() === 'bm' ? 'DUNIA' : 'WORLD');
      $('#news-bar-tag').className = `nb-tag t-${n.topic}`;
      txt.textContent = `${n.title} · ${n.source}`;
      $('#news-bar-main').setAttribute('aria-label', `${t('newsTitle')}: ${n.title}`);
      $('#news-bar-main').dataset.link = n.link;
    };
    paint();
    newsBarTimer = setInterval(() => { if (!document.hidden) { newsBarIdx++; paint(); } }, 7000);
  }
  syncLayout();
}
$('#news-bar-main').addEventListener('click', () => { openSheet(); setTab('news'); });
$('#news-bar-x').addEventListener('click', () => {
  try { sessionStorage.setItem('navmap.newsbar', 'off'); } catch { /* ignore */ }
  renderNewsBar();
});

const NEWS_TOPICS = ['disaster', 'weather', 'haze', 'climate', 'nature'];
const NEWS_ICON = { disaster: 'flood', weather: 'rain', haze: 'haze', climate: 'sun', nature: 'leaf' };
function viewNews() {
  const lang = getLang();
  const head = `<div class="sh-head"><h2>${t('newsTitle')}</h2><small style="color:var(--text-subtle);font-size:12px">${S.newsAt ? `${t('updated')} ${fmtAgo(new Date(S.newsAt).toISOString(), lang)}` : ''}</small></div>
    <p class="muted" style="margin-bottom:10px">${t('newsLead')}</p>`;
  if (S.newsStatus === 'loading' && !S.news.length) return `${head}<div class="empty-state"><span class="spinner"></span>${t('newsLoading')}</div>`;
  if (S.newsStatus === 'error') return `${head}<div class="empty-state">${icon('leaf')}${t('newsFailed')}<button class="btn-ghost" data-action="news-retry">${t('retry')}</button></div>`;
  const byRegion = S.news.filter((n) => S.newsRegion === 'all' || n.region === S.newsRegion);
  const list = byRegion.filter((n) => S.newsTopic === 'all' || n.topic === S.newsTopic);
  const regions = [['all', t('all')], ['my', t('newsLocal')], ['world', t('newsWorld')]].map(([k, label]) =>
    `<button class="chip" data-news-region="${k}" aria-pressed="${S.newsRegion === k}">${label}</button>`).join('');
  const topics = ['all', ...NEWS_TOPICS].map((k) => {
    const n = byRegion.filter((x) => k === 'all' || x.topic === k).length;
    if (k !== 'all' && !n) return '';
    return `<button class="chip sm" data-news-topic="${k}" aria-pressed="${S.newsTopic === k}">${k === 'all' ? t('allTopics') : t(`topic_${k}`)} ${n}</button>`;
  }).join('');
  const rows = list.length ? `<ul class="news-list">${list.map((n) => `<li><a class="news-row" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
      <span class="mid">
        <span class="news-tag t-${esc(n.topic)}">${icon(NEWS_ICON[n.topic] || 'leaf')}${t(`topic_${n.topic}`)}${n.region === 'my' ? ' · Malaysia' : ''}</span>
        <b>${esc(n.title)}</b>
        ${n.summary ? `<small class="sum">${esc(n.summary)}</small>` : ''}
        <small>${esc(n.source)}${n.time ? ` · ${esc(fmtAgo(n.time, lang))}` : ''}</small>
      </span>
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    </a></li>`).join('')}</ul>` : `<div class="empty-state">${icon('leaf')}${t('newsNone')}</div>`;
  return `${head}<div class="filters" role="group">${regions}</div><div class="filters topics" role="group">${topics}</div>${rows}<div class="sub-card"><span class="sub-ic">${icon('mail')}</span><span class="mid"><b>${t('subTitle')}</b><small>${t('subCard')}</small></span><button class="btn sm" data-action="subscribe">${t('subBtn')}</button></div><p class="source">${t('newsSource')}</p>`;
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
  openSheet();
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
  const up = e.target.closest('[data-unpin]');
  if (up) { e.stopPropagation(); unpin(up.dataset.unpin); return; }
  const el = e.target.closest('[data-news-region],[data-news-topic],[data-cat],[data-place],[data-action],[data-route],[data-filter],[data-alert],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) { setTab(el.dataset.tab); return; }
  if (el.dataset.cat) { loadPlaces(S.cat === el.dataset.cat && S.tab === 'explore' ? null : el.dataset.cat); return; }
  if (el.dataset.newsRegion) { S.newsRegion = el.dataset.newsRegion; render(); return; }
  if (el.dataset.newsTopic) { S.newsTopic = el.dataset.newsTopic; render(); return; }
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
  if (act === 'toggle-all') { S.showAll = !S.showAll; setSheet(S.showAll ? 'full' : 'half'); render(); }
  if (act === 'retry') loadPlaces(S.cat);
  if (act === 'back') { S.selected = null; drawPlaces(); render(); }
  if (act === 'clear-route') clearRoute();
  if (act === 'reroute' && S.dest) computeRoute();
  if (act === 'edit-pt') { S.ptEdit = el.dataset.pt; ptResults = []; render(); }
  if (act === 'pt-cancel') { S.ptEdit = null; render(); }
  if (act === 'pt-me') {
    if (S.ptEdit === 'start') setPoint('start', null);
    else if (S.me) setPoint('end', { id: 'me', name: t('myLocation'), lon: S.me[0], lat: S.me[1] });
    else locate({ fly: false, quiet: false }).then(() => { if (S.me) setPoint('end', { id: 'me', name: t('myLocation'), lon: S.me[0], lat: S.me[1] }); });
  }
  if (act === 'pt-map') pickOnMap(S.ptEdit);
  if (act === 'pt-result') { const r = ptResults[Number(el.dataset.i)]; if (r) setPoint(S.ptEdit, toPoint(r)); }
  if (act === 'pt-swap') swapPoints();
  if (act === 'pt-reset-start') { S.start = null; computeRoute(); }
  if (act === 'start-nav') startNav();
  if (act === 'pin-weather') openPinDialog();
  if (act === 'radar') toggleRadar();
  if (act === 'wx-retry') loadWeather(true);
  if (act === 'news-retry') loadNews(true);
  if (act === 'subscribe') openSubscribe();
  if (act === 'poll-jump') $('#poll')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------- map-first sheet (mobile)
// The map is the main view: touching the map shrinks the panel to a small strip,
// tapping or swiping the strip brings it back. Desktop keeps the side panel.
const isMobile = () => innerWidth < 900;
let sheetState = 'half';
function setSheet(state) {
  if (!isMobile()) state = 'half';
  sheetState = state;
  const sh = $('#sheet');
  sh.classList.toggle('peek', state === 'peek');
  sh.classList.toggle('expanded', state === 'full');
  document.body.classList.toggle('map-focus', state === 'peek');
  $('#grab').setAttribute('aria-expanded', String(state !== 'peek'));
  if (state === 'peek') $('#sheet-body').scrollTop = 0;
}
const LEVELS = ['peek', 'half', 'full'];
function openSheet() { if (sheetState === 'peek') setSheet('half'); }
const stepSheet = (dir) => setSheet(LEVELS[Math.max(0, Math.min(2, LEVELS.indexOf(sheetState) + dir))]);

map.on('dragstart', () => { if (isMobile() && !S.nav) setSheet('peek'); });
map.on('click', (e) => {
  if (S.picking) { pickedAt(e.lngLat); return; }
  if (isMobile() && !S.nav) setSheet(sheetState === 'peek' ? 'half' : 'peek');
});

$('#grab').addEventListener('click', () => setSheet(sheetState === 'peek' ? 'half' : sheetState === 'half' ? 'full' : 'half'));
$('#sheet').addEventListener('click', (e) => {
  if (sheetState === 'peek' && !e.target.closest('.tabs, #grab')) setSheet('half');
}, true);

// swipe up / down on the handle or the panel content
let swipeY = null;
$('#sheet').addEventListener('touchstart', (e) => {
  const fromBody = e.target.closest('#sheet-body');
  swipeY = !fromBody || $('#sheet-body').scrollTop <= 0 || sheetState === 'peek' ? e.touches[0].clientY : null;
}, { passive: true });
$('#sheet').addEventListener('touchend', (e) => {
  if (swipeY == null) return;
  const dy = e.changedTouches[0].clientY - swipeY;
  swipeY = null;
  if (dy < -40) stepSheet(1);
  else if (dy > 40) stepSheet(-1);
}, { passive: true });

// keep the map canvas matched to its container (iOS toolbars change the height)
new ResizeObserver(() => map.resize()).observe($('#map'));
window.visualViewport?.addEventListener('resize', () => map.resize());
$('#locate-btn').addEventListener('click', () => locate());
$('#hud-stop').addEventListener('click', stopNav);
$('#hud-voice').addEventListener('click', () => {
  setVoice(!voiceOn());
  syncVoiceBtn();
  if (voiceOn() && S.nav) speak(stepText(S.routes[S.routeIdx].steps[S.nav.step], getLang()), getLang());
});
$('#lang-btn').addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'bm' : 'en');
  $('#lang-btn').textContent = getLang() === 'en' ? 'BM' : 'EN';
  renderChips(); renderBanner(); render(); renderReportGrid(); renderWxFab();
  if (S.nav) updateHud();
});
// ---------------------------------------------------------------- map layers menu
// Base map: the OpenFreeMap street map, or Esri World Imagery satellite photos with the
// street map's place and road labels drawn on top (a "hybrid" view).
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTR = 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics';
const labelPaint = new Map(); // original label colours, restored when leaving satellite
const getBasemap = () => { try { return localStorage.getItem('navmap.basemap') === 'satellite' ? 'satellite' : 'map'; } catch { return 'map'; } };
async function setBasemap(kind) {
  try { localStorage.setItem('navmap.basemap', kind); } catch { /* private mode */ }
  document.querySelectorAll('[data-basemap]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.basemap === kind)));
  document.documentElement.dataset.basemap = kind;
  await mapReady;
  const sat = kind === 'satellite';
  const layers = map.getStyle().layers;
  if (sat && !map.getLayer('sat')) {
    if (!map.getSource('sat')) map.addSource('sat', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: SAT_ATTR });
    // under the base map's labels and under every NAVMAP layer (radar, alerts, routes)
    const below = layers.find((l) => l.type === 'symbol' || /^(radar-|alert-|route-)/.test(l.id))?.id;
    map.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 200 } }, below);
  } else if (!sat && map.getLayer('sat')) {
    map.removeLayer('sat');
    map.removeSource('sat');
  }
  // White labels with a dark outline read well on photos; restore the originals for the street map.
  for (const l of layers) {
    if (l.type !== 'symbol' || l.source === 'alerts' || l.id === 'sat') continue;
    try {
      if (sat) {
        if (!labelPaint.has(l.id)) labelPaint.set(l.id, [map.getPaintProperty(l.id, 'text-color'), map.getPaintProperty(l.id, 'text-halo-color'), map.getPaintProperty(l.id, 'text-halo-width')]);
        map.setPaintProperty(l.id, 'text-color', '#FFFFFF');
        map.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,0.75)');
        map.setPaintProperty(l.id, 'text-halo-width', 1.4);
      } else if (labelPaint.has(l.id)) {
        const [c, h, w] = labelPaint.get(l.id);
        map.setPaintProperty(l.id, 'text-color', c);
        map.setPaintProperty(l.id, 'text-halo-color', h);
        map.setPaintProperty(l.id, 'text-halo-width', w);
      }
    } catch { /* layer without text */ }
  }
}
if (getBasemap() === 'satellite') setBasemap('satellite');

const layersBtn = $('#alerts-layer-btn');
const layersPop = $('#layers-pop');
function placeLayersPop() {
  const r = layersBtn.getBoundingClientRect();
  const w = layersPop.offsetWidth, h = layersPop.offsetHeight;
  const leftSide = r.left < window.innerWidth / 2;
  const left = leftSide ? r.right + 8 : r.left - w - 8;
  layersPop.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  layersPop.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - h - 8))}px`;
}
function toggleLayersPop(open = layersPop.hidden) {
  layersPop.hidden = !open;
  layersBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    $('#lp-alerts').checked = S.showAlertLayer;
    $('#lp-radar').checked = !!S.radar;
    placeLayersPop();
    layersPop.querySelector('[aria-checked="true"]')?.focus();
  }
}
layersBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLayersPop(); });
layersPop.addEventListener('click', (e) => {
  const b = e.target.closest('[data-basemap]');
  if (b) setBasemap(b.dataset.basemap);
});
$('#lp-alerts').addEventListener('change', (e) => { S.showAlertLayer = e.target.checked; drawAlerts(); });
$('#lp-radar').addEventListener('change', (e) => { if (e.target.checked !== !!S.radar) toggleRadar(); });
document.addEventListener('click', (e) => { if (!layersPop.hidden && !layersPop.contains(e.target)) toggleLayersPop(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.picking) { S.picking = null; document.body.classList.remove('picking'); setSheet('half'); render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !layersPop.hidden) { toggleLayersPop(false); layersBtn.focus(); } });
window.addEventListener('resize', () => { if (!layersPop.hidden) placeLayersPop(); });

// Pin dialog: what is happening at the centre of the map (or your location)
const dlg = $('#report-dlg');
function renderReportGrid() {
  $('#report-grid').innerHTML = PIN_TYPES.map((r) =>
    `<button type="button" data-report="${r.id}" class="sev-${r.sev}">${icon(r.icon)}${esc(getLang() === 'bm' ? r.bm : r.en)}</button>`).join('');
}
function openPinDialog() { renderReportGrid(); dlg.showModal(); }
$('#report-btn').addEventListener('click', openPinDialog);
$('#report-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-report]');
  if (!b) return;
  // pin where the person is if they're looking near themselves, otherwise at the map centre
  const c = S.me && distKm(S.me, center()) < 1 ? S.me : center();
  dlg.close();
  try {
    const r = await addPin(b.dataset.report, c[1], c[0]);
    S.reports = [...S.reports.filter((x) => x.id !== r.id), r];
    drawAlerts(); renderBanner(); render();
    toast(pinsMod.shared ? t('pinnedShared') : t('pinnedLocal'));
  } catch (err) {
    toast(err.message === 'rate' ? t('pinRate') : t('pinFailed'));
  }
});
$('#wx-btn').addEventListener('click', () => { openSheet(); setTab('weather'); });

// Email updates sign-up: explicit, unticked consent box (PDPA); stored by /api/subscribe.
const subDlg = $('#sub-dlg');
let subMode = 'subscribe';
function setSubMode(mode) {
  subMode = mode;
  const unsub = mode === 'unsubscribe';
  $('#sub-title').textContent = unsub ? t('subUnsubTitle') : t('subTitle');
  $('#sub-form .muted').textContent = unsub ? t('subUnsubLead') : t('subLead');
  $('#sub-consent').closest('label').hidden = unsub;
  $('#sub-submit').textContent = unsub ? t('subUnsubBtn') : t('subBtn');
  $('#sub-unsub').textContent = unsub ? t('subBackLink') : t('subUnsubLink');
  $('#sub-msg').textContent = ''; $('#sub-msg').className = 'sub-msg';
  syncSubBtn();
}
function syncSubBtn() {
  const okEmail = /^\S+@\S+\.\S+$/.test($('#sub-email').value.trim());
  $('#sub-submit').disabled = !okEmail || (subMode === 'subscribe' && !$('#sub-consent').checked);
}
function openSubscribe() {
  $('#sub-consent').checked = false;
  $('#sub-consent-txt').innerHTML = t('subConsent');
  setSubMode('subscribe');
  subDlg.showModal();
}
$('#sub-email').addEventListener('input', syncSubBtn);
$('#sub-consent').addEventListener('change', syncSubBtn);
$('#sub-cancel').addEventListener('click', () => subDlg.close());
$('#sub-unsub').addEventListener('click', () => setSubMode(subMode === 'subscribe' ? 'unsubscribe' : 'subscribe'));
$('#sub-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#sub-msg');
  const email = $('#sub-email').value.trim();
  const body = subMode === 'unsubscribe'
    ? { email, action: 'unsubscribe' }
    : { email, consent: $('#sub-consent').checked, lang: getLang(), consentText: $('#sub-consent-txt').textContent.trim() };
  $('#sub-submit').disabled = true;
  try {
    const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'server');
    msg.className = 'sub-msg ok';
    msg.textContent = subMode === 'unsubscribe' ? t('subUnsubDone') : t('subDone');
    if (subMode === 'subscribe') { try { localStorage.setItem('navmap.subscribed', '1'); } catch { /* ignore */ } }
    setTimeout(() => subDlg.close(), 2200);
  } catch (err) {
    msg.className = 'sub-msg err';
    msg.textContent = err.message === 'invalid_email' ? t('subBadEmail') : err.message === 'rate' ? t('subRate') : t('subFailed');
    syncSubBtn();
  }
});

// Emergency calls: Government, Car problem, NGOs, plus your coordinates to read to the operator.
const sosDlg = $('#sos-dlg');
function renderSos() {
  const lang = getLang();
  const me = S.me ? `${S.me[1].toFixed(5)}, ${S.me[0].toFixed(5)}` : null;
  const groups = HOTLINE_GROUPS.map((g) => `<section class="sos-group">
      <h3>${icon(g.icon)}${esc(g[lang])}</h3>
      <ul>${g.items.map((h) => `<li class="${h.urgent ? 'urgent' : ''}">
        <a class="sos-call" href="tel:${h.tel}"><span class="mid"><b>${esc(h.show)}</b><small>${esc(h[lang])}</small></span><span class="sos-ph">${icon('phone')}</span></a>
        ${h.wa ? `<a class="sos-wa" href="https://wa.me/${h.wa}" target="_blank" rel="noopener" aria-label="${t('whatsapp')} ${esc(h.show)}">${icon('chat')}</a>` : ''}
      </li>`).join('')}</ul>
      ${g.note ? `<p class="muted sm">${esc(g.note[lang])}</p>` : ''}
      ${g.workshop ? `<button class="btn-ghost" data-sos-workshop>${icon('workshop')}${t('findWorkshop')}</button>` : ''}
    </section>`).join('');
  $('#sos-body').innerHTML = `<a class="sos-999" href="tel:999">${icon('phone')}<span><b>999</b><small>${t('sosLead')}</small></span></a>
    <div class="sos-loc"><small>${t('myCoords')}</small>${me ? `<div><b>${me}</b><button class="btn-ghost sm" data-sos-copy="${me}">${icon('copy')}${t('copy')}</button></div>` : `<p class="muted sm">${t('locUnknown')}</p>`}</div>
    ${groups}
    <p class="source">${t('sosNote')}</p>
    <p class="copyright">${t('copyright')}<br><a href="/terms.html">${t('terms')}</a> · <a href="/privacy.html">${t('privacy')}</a> · <button class="linkish" data-action="subscribe">${t('subLink')}</button></p>`;
}
$('#sos-btn').addEventListener('click', () => { renderSos(); sosDlg.showModal(); });
$('#sos-close').addEventListener('click', () => sosDlg.close());
sosDlg.addEventListener('click', async (e) => {
  if (e.target === sosDlg) { sosDlg.close(); return; } // tap outside
  const cp = e.target.closest('[data-sos-copy]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.sosCopy); toast(t('copied')); } catch { /* ignore */ } return; }
  if (e.target.closest('[data-sos-workshop]')) { sosDlg.close(); openSheet(); loadPlaces('workshop'); }
});
$('#radar-fab').addEventListener('click', () => toggleRadar());

// ---------------------------------------------------------------- boot
applyStatic();
$('#lang-btn').textContent = getLang() === 'en' ? 'BM' : 'EN';
renderChips();
render();
renderReportGrid();
locate({ fly: true, quiet: true });
refreshAlerts();
setInterval(refreshAlerts, ALERT_REFRESH_MS);
loadPins();
setInterval(() => { if (document.visibilityState === 'visible') loadPins(); }, 30 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadPins(); loadWeather(); } });
setTimeout(() => loadWeather(), 1200);

// deep link: ?cat=ev
const urlCat = new URLSearchParams(location.search).get('cat');
if (urlCat && CATEGORIES[urlCat]) mapReady.then(() => loadPlaces(urlCat));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
