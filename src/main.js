import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { t, L, getLang, setLang, applyStatic } from './lib/i18n.js';
import { icon, maneuverIcon } from './lib/icons.js';
import { distKm, distToLineKm, fmtDist, fmtDur, fmtAgo, circle, KL, MY_BBOX } from './lib/geo.js';
import { CATEGORIES, fetchNearby, prefetchNearby, raceOverpass } from './lib/places.js';
import { searchPlaces, reverseName } from './lib/search.js';
import { getRoutes, stepText } from './lib/routing.js';
import { pickTollVias, bestTollRoute } from './lib/tolls.js';
import { getTransit, clock, delayMin, isWalk, isRail, TZ } from './lib/transit.js';
import { RIDE_APPS, openRide, gmapsTransit } from './lib/rides.js';
import { getVehicle, setVehicle, loadFuelPrices, FUEL_DEFAULT, EV_RATE, tollEstimate, fuelEstimate, evEstimate, transitFare, grabFare, rm } from './lib/tripcost.js';
import { measure, along, pointHazards, routeHaze, routeStates, areaWarnings, hazardCount } from './lib/route-hazards.js';
import { loadAlerts } from './lib/alerts.js';
import { alertSummary, alertStates, alertTextHtml, isMarine, tidyTitle, fmtUntil, seaNumbers } from './lib/alert-format.js';
import { speak, setVoice, voiceOn, voiceSupported, activePack, getVoicePack, setVoicePack, findVoice, voicesLoaded } from './lib/voice.js';
import { VOICE_PACKS } from './lib/voice-packs.js';
import { PIN_TYPES } from './lib/pin-types.js';
import { listPins, addPin, removePin, votePin, getThread, postComment, reactComment, deleteComment, shareNews, requestWelcome } from './lib/pins.js';
import { TAGS, DISCUSS_TAGS, TAG_BY_ID, MAX_TEXT, cleanName } from './lib/community.js';
import * as auth from './lib/auth.js';
import { applyPlay, PLAY_PITCH } from './lib/play.js';
import { award, getScore, levelOf, LEVEL_PTS, BADGES } from './lib/score.js';
import * as pinsMod from './lib/pins.js';
import { getSaved, setSaved, savedKindAt, SAVED_KINDS } from './lib/saved.js';
import { LOGO_CATS, logoUrl } from './lib/brands.js';
import { fetchWeather, wmo, aqiLabel, AQ_LEVELS, placeName, radarFrames } from './lib/weather.js';
import { HOTLINE_GROUPS } from './lib/hotlines.js';
import * as radio from './lib/radio.js';

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';
const ALERT_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- state
const S = {
  stats: null,
  brands: {},
  saved: getSaved(), saveMode: null,
  tab: 'explore',
  cat: null,
  places: [], placesStatus: 'idle', showAll: false, placesCenter: null,
  selected: null,           // place object shown in detail card
  dest: null,               // { name, lat, lon }
  start: null,              // custom start { name, lat, lon }; null = my location
  ptEdit: null,             // 'start' | 'end' while its search box is open in the Drive tab
  picking: null,            // 'start' | 'end' while waiting for a tap on the map
  routes: [], routeIdx: 0, routeStatus: 'idle', routeOrigin: null,
  mode: loadMode(),         // 'car' | 'moto' | 'bus' | 'train' (Drive tab travel mode)
  leaveAt: '',              // 'HH:MM' Malaysian time for bus and train trips; '' = now
  avoidTolls: (() => { try { return localStorage.getItem('navmap.avoidTolls') === '1'; } catch { return false; } })(),
  vehicle: getVehicle(),    // fuel type and consumption for trip cost estimates
  fuel: null,               // pump prices { ron95, budi95, ron97, diesel, date, live }
  alerts: [], alertMode: 'loading', alertsAt: null, alertFilter: 'all',
  reports: [],
  thread: null,             // { pinId, status: 'loading'|'ok'|'error'|'gone', comments, tag, draft, sending } while a pin's updates are open
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

// ---------------------------------------------------------------- weak signal and offline
// On 2G or with Data Saver on, extras (news, logos, counter) wait longer so the map comes first.
const conn = navigator.connection;
function slowNet() { return !!conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '')); }
// Run extras once the map has loaded (or after 8 s if it is still loading), then when the phone is idle.
function afterMap(fn, delay = 0) {
  const go = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(() => fn(), { timeout: 2000 }), slowNet() ? delay + 4000 : delay);
  Promise.race([mapReady, new Promise((r) => setTimeout(r, 8000))]).then(go);
}

// Which data on screen is a saved copy (source -> ISO time it was fetched).
const SAVED = {};
function noteSaved(src, at) {
  if (at) SAVED[src] = at; else delete SAVED[src];
  renderOffline();
}
function renderOffline() {
  const el = document.querySelector('#offline-pill');
  if (!el) return;
  const offline = navigator.onLine === false;
  const times = Object.values(SAVED).filter(Boolean).sort();
  if (!offline && !times.length) { el.hidden = true; return; }
  const lang = getLang();
  const when = times.length ? ` · ${t('offlineSaved')} ${fmtAgo(times[0], lang)}` : '';
  el.innerHTML = `${icon('wifiOff')}<span><b>${t(offline ? 'offlineTitle' : 'weakTitle')}</b> ${t('offlineBody')}${when}</span>`;
  el.hidden = false;
}
addEventListener('offline', renderOffline);
addEventListener('online', () => { renderOffline(); refreshAlerts(); loadWeather(true); loadPins(); });
setInterval(renderOffline, 60e3); // keep "saved X min ago" current

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
  // Bus and train trips: walking legs dashed, rides in the line's own colour, a dot at each stop you use.
  map.addSource('transit', { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'transit-walk', type: 'line', source: 'transit', filter: ['all', ['==', '$type', 'LineString'], ['==', ['get', 'walk'], true]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4F5B52', 'line-width': 4, 'line-dasharray': [0.1, 1.8] } });
  map.addLayer({ id: 'transit-casing', type: 'line', source: 'transit', filter: ['all', ['==', '$type', 'LineString'], ['!=', ['get', 'walk'], true]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#003503', 'line-width': 10 } });
  map.addLayer({ id: 'transit-ride', type: 'line', source: 'transit', filter: ['all', ['==', '$type', 'LineString'], ['!=', ['get', 'walk'], true]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
  map.addLayer({ id: 'transit-stop', type: 'circle', source: 'transit', filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF', 'circle-stroke-width': 3, 'circle-stroke-color': '#003503' } });
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

function pinEl(cls, iconName, label, logo = '') {
  const b = document.createElement('button');
  b.className = `pin ${cls}${logo ? ' has-logo' : ''}`;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(iconName) + logo;
  return b;
}

// Brand logos (McDonald's, KFC, Petronas…) from brands.json, built weekly from Wikidata.
// The category icon stays underneath, so a logo that fails to load just shows the icon.
// Loaded after the map is up, so it never competes with the first map tiles.
afterMap(() => fetch('/data/poi/brands.json').then((r) => (r.ok ? r.json() : {})).then((b) => {
  S.brands = b || {};
  if (S.places.length) { drawPlaces(); render(); }
}).catch(() => {}), 500);
function brandLogo(p, width = 64) {
  const b = p.brand && LOGO_CATS.includes(p.cat) && S.brands[p.brand];
  return b ? `<img class="brand-logo" src="${esc(logoUrl(b.f, width))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('has-logo');this.remove()">` : '';
}

function drawPlaces() {
  poiMarkers.forEach((m) => m.remove());
  poiMarkers = S.places.slice(0, 80).map((p) => {
    const el = pinEl(S.selected?.id === p.id ? 'sel' : '', p.cat, p.name, brandLogo(p));
    el.addEventListener('click', (e) => { e.stopPropagation(); selectPlace(p); });
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
  });
}

// Home / Work markers
let savedMarkers = [];
function drawSaved() {
  savedMarkers.forEach((m) => m.remove());
  savedMarkers = SAVED_KINDS.filter((k) => S.saved[k]).map((k) => {
    const p = S.saved[k];
    const el = pinEl('saved', k, `${savedLabel(k)}: ${p.name}`);
    el.addEventListener('click', (e) => { e.stopPropagation(); selectPlace(savedPlace(k)); });
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

function drawMe(glide = false) {
  if (!S.me) return;
  if (!meMarker) {
    const el = document.createElement('div');
    el.className = 'me';
    el.setAttribute('aria-label', t('myLocation'));
    meMarker = new maplibregl.Marker({ element: el }).setLngLat(S.me).addTo(map);
  }
  // While navigating, the dot becomes a car arrow pointing the way you are going, gliding between GPS fixes.
  const el = meMarker.getElement();
  const car = Boolean(S.nav) && !isPlay();
  el.classList.toggle('nav-car', car);
  meMarker.setRotationAlignment(S.nav ? 'map' : 'auto');
  meMarker.setPitchAlignment(car ? 'map' : 'auto');
  if (car && !el.querySelector('.car-arrow')) el.innerHTML = '<svg class="car-arrow" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 33 34 20 27 7 34z"/></svg>';
  if (!car && el.querySelector('.car-arrow')) el.innerHTML = '';
  meMarker.setRotation(S.nav ? S.nav.heading || 0 : 0);
  if (glide) glideMarker(meMarker, S.me); else meMarker.setLngLat(S.me);
}

let glideRaf = 0;
function glideMarker(m, to, ms = 900) {
  cancelAnimationFrame(glideRaf);
  const from = m.getLngLat().toArray();
  if (distKm(from, to) > 0.5) { m.setLngLat(to); return; } // a jump (first fix, tunnel): no slide
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    m.setLngLat([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
    if (k < 1) glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

const bearingDeg = (a, b) => {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};
/** Direction of the road ahead of point p on route r. */
function routeBearing(r, p) {
  const i = nearestIdx(r, p);
  let j = i + 1;
  while (j < r.coords.length - 1 && distKm(r.coords[i], r.coords[j]) < 0.03) j++; // ~30 m ahead
  return j >= r.coords.length ? map.getBearing() : bearingDeg(r.coords[i], r.coords[j]);
}
/** Which way the car points: the phone's compass course when moving, else movement since the last fix, else the road. */
function carHeading(pos, prev, r) {
  const c = pos.coords;
  if (Number.isFinite(c.heading) && c.speed > 1.5) return c.heading;
  if (prev && distKm(prev, S.me) > 0.008) return bearingDeg(prev, S.me);
  return S.nav?.heading ?? routeBearing(r, S.me);
}
/** Keep the car in the lower part of the screen, under the direction card, so more road ahead shows. */
function navPadding() {
  const hud = $('#hud')?.offsetHeight || 160;
  return { top: hud + Math.round(innerHeight * 0.28), bottom: 40, left: 40, right: 40 };
}

/** Car or motorcycle: also ask for a route that avoids toll roads, and offer it as a choice. */
async function withNoToll(from, to, signal) {
  const [main, free] = await Promise.all([
    getRoutes(from, to, signal),
    getRoutes(from, to, signal, { noToll: true }).catch(() => []),
  ]);
  if (!main[0]?.tolls?.length) return main; // already toll-free
  const tollFree = free.filter((r) => !r.tolls?.length)[0];
  const same = tollFree && main.find((m) => !m.tolls?.length && Math.abs(m.distance - tollFree.distance) < 50);
  if (same) { same.noToll = true; return main; }
  if (!tollFree) return main;
  tollFree.noToll = true;
  return [...main.slice(0, 2), tollFree];
}

/** Points every ~2 km along Malaysia's tolled expressways, built weekly from OpenStreetMap (scripts/build-tolls.mjs). */
let tollPts = null;
async function loadTollPoints() {
  if (tollPts) return tollPts;
  try { tollPts = (await (await fetch('/data/tolls.json')).json()).points || []; } catch { tollPts = []; }
  return tollPts;
}

/**
 * The fastest route has no tolls: find one that uses a toll expressway anyway, so the driver can choose.
 * OSRM cannot be told to prefer tolls, so we route through points on the expressways nearest the trip
 * (fewest extra kilometres first, a few different roads) and keep the quickest result that really uses one.
 */
async function addTollRoute(routes, from, to, signal) {
  const direct = distKm(from, to);
  if (direct < 3) { S.tollSearch = 'none'; return; }
  S.tollSearch = 'loading';
  try {
    let vias = pickTollVias(await loadTollPoints(), from, to);
    if (!vias.length) {
      // No prebuilt points here yet: ask OpenStreetMap live for expressways (E-numbered or toll=yes) near the trip.
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const radius = Math.round(Math.min(direct / 2 + 5, 40) * 1000);
      const json = await raceOverpass(`[out:json][timeout:15];(way[highway~"^(motorway|trunk)$"][ref~"(^|;)E[0-9]"](around:${radius},${mid[1]},${mid[0]});way[highway~"^(motorway|trunk)$"][toll=yes](around:${radius},${mid[1]},${mid[0]}););out tags center 300;`, { signal, timeoutMs: 12000 });
      vias = pickTollVias(json.elements.filter((e) => e.center && e.tags?.toll !== 'no').map((e) => [e.center.lon, e.center.lat, e.tags?.ref || '']), from, to);
    }
    const tries = await Promise.all(vias.map((c) => getRoutes(from, to, signal, { via: c }).then((r) => r[0]).catch(() => null)));
    const best = bestTollRoute(tries, routes[0]);
    if (signal.aborted || S.routes !== routes) return;
    if (!best) { S.tollSearch = 'none'; } else {
      best.withToll = true;
      scanRoute(best);
      routes.push(best);
      labelRoutes(routes);
      S.tollSearch = 'ok';
      if (!S.avoidTolls && S.useTollsPicked) S.routeIdx = routes.length - 1;
      drawRoutes();
      checkRouteArea([best], signal);
    }
  } catch (e) {
    if (e.name === 'AbortError' || signal.aborted) return;
    S.tollSearch = 'none';
  }
  if (S.tab === 'drive' && !S.ptEdit && !S.nav) render();
}

function tollTag(r) {
  if (!r.tolls?.length) return r.label === 'noToll' ? '' : ` · ${t('tollFree')}`;
  return ` · ${t('tollShort')} ${rm(tollEstimate(r.tolls, S.mode).rm)}`;
}

/** Tolls: allowed or avoided. The choice is remembered and picks the matching route. */
/** Quickest route that does (toll = true) or does not use toll roads, as an index into S.routes. */
function bestIdx(toll) {
  let best = -1;
  S.routes.forEach((x, i) => { if (Boolean(x.tolls?.length) === toll && (best < 0 || x.duration < S.routes[best].duration)) best = i; });
  return best;
}

/** Tolls: two cards side by side, with toll road and without, each with its time and toll. */
function tollBar() {
  const lang = getLang();
  const ti = bestIdx(true), fi = bestIdx(false);
  const tr = S.routes[ti], fr = S.routes[fi];
  const sel = S.routes[S.routeIdx];
  const selToll = Boolean(sel?.tolls?.length);
  const diff = tr && fr ? Math.round((fr.duration - tr.duration) / 60) : 0;
  const tollCard = tr
    ? `<b>${fmtDur(tr.duration, lang)}</b><small>${t('tollShort')} ${rm(tollEstimate(tr.tolls, S.mode).rm)}${diff > 0 ? ` · ${t('tollSaves').replace('{n}', diff)}` : diff < 0 ? ` · ${t('tollSlower').replace('{n}', -diff)}` : ''}</small>`
    : S.tollSearch === 'loading' ? `<small><span class="spinner"></span>${t('tollSearching')}</small>` : `<small>${t('tollNone')}</small>`;
  const freeCard = fr
    ? `<b>${fmtDur(fr.duration, lang)}</b><small>${t('tollFree')} · RM0</small>`
    : `<small>${t('tollNoFree')}</small>`;
  return `<div class="toll-bar" role="group" aria-label="${esc(t('tollTitle'))}">
    <button class="toll-opt" data-action="tolls" data-v="use" aria-pressed="${Boolean(tr) && selToll}"${tr ? '' : ' disabled'}><span>${t('tollUse')}</span>${tollCard}</button>
    <button class="toll-opt" data-action="tolls" data-v="avoid" aria-pressed="${Boolean(fr) && !selToll}"${fr ? '' : ' disabled'}><span>${t('tollAvoid')}</span>${freeCard}</button></div>`;
}
function setAvoidTolls(on) {
  S.avoidTolls = on;
  S.useTollsPicked = !on;
  try { localStorage.setItem('navmap.avoidTolls', on ? '1' : ''); } catch { /* private mode */ }
  const pick = bestIdx(!on);
  if (pick >= 0) S.routeIdx = pick;
  drawRoutes(); render();
}

function drawReports() {
  reportMarkers.forEach((m) => m.remove());
  reportMarkers = S.showAlertLayer ? S.reports.map((r) => {
    const el = document.createElement('button');
    el.className = `report-pin sev-${r.severity}${r.mine ? ' mine' : ''}`;
    el.setAttribute('aria-label', `${L(r, 'title')} · ${pinTrust(r, getLang())}`);
    el.innerHTML = `${icon(r.icon || 'report')}${r.confirms ? `<span class="pin-n">${r.confirms > 9 ? '9+' : r.confirms}</span>` : ''}`;
    if (r.stale != null) el.style.opacity = String(Math.round((1 - 0.55 * r.stale) * 100) / 100); // older pins fade out
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
    .setHTML(`<b>${esc(L(a, 'title'))}</b>${a.place ? `${esc(a.place)}<br>` : ''}${esc(L(a, 'desc'))}<br><small>${esc(a.source)} · ${esc(fmtAgo(a.time, getLang()))}</small>${a.kind === 'report' ? `<small class="pin-trust">${esc(pinTrust(a, getLang()))}</small>${voteBtns(a)}${talkBtn(a)}` : ''}${a.mine ? `<button class="unpin" data-unpin="${esc(a.pinId)}">${icon('close')}${t('unpin')}</button>` : ''}`)
    .addTo(map);
}

// "Confirmed by 3 · last 5 min ago · expires in 40 min" for a community pin.
function fmtLeft(iso, lang) {
  const m = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return lang === 'bm' ? `${h} jam` : `${h} h`;
}
function pinTrust(r, lang) {
  const parts = [];
  if (r.confirms) {
    parts.push(r.confirms === 1 ? t('pinConfirmedBy1') : t('pinConfirmedBy').replace('{n}', r.confirms));
    if (r.lastConfirmedAt) parts.push(t('pinLastSeen').replace('{t}', fmtAgo(r.lastConfirmedAt, lang)));
  } else if (!r.mine) parts.push(t('pinUnconfirmed'));
  if (r.gone) parts.push(t('pinGoneN').replace('{n}', r.gone));
  if (r.expiresAt) parts.push(t('pinLeft').replace('{t}', fmtLeft(r.expiresAt, lang)));
  return parts.join(' · ');
}
// "Still there" / "Gone" buttons for pins other people placed (shared database only).
function voteBtns(r) {
  if (!r.canVote) return '';
  const b = (v, ic, label) => `<button type="button" class="vote ${v}" data-vote="${v}" data-pin="${esc(r.pinId)}" aria-pressed="${r.myVote === v}">${icon(ic)}${t(label)}</button>`;
  return `<div class="votes" role="group" aria-label="${t('pinAsk')}">${b('confirm', 'check', 'pinStill')}${b('gone', 'close', 'pinGone')}</div>`;
}
async function onVote(pinId, v) {
  popup?.remove();
  try {
    const out = await votePin(pinId, v);
    if (out.removed) { S.reports = S.reports.filter((r) => r.pinId !== pinId); toast(t(v === 'gone' ? 'pinHidden' : 'pinVoteFailed')); }
    else { S.reports = S.reports.map((r) => (r.pinId === pinId ? out.alert : r)); toast(t(v === 'confirm' ? 'pinThanks' : 'pinGoneThanks')); }
  } catch (err) {
    toast(t(err.message === 'rate' ? 'pinVoteRate' : 'pinVoteFailed'));
  }
  rescanRoutes();
  drawAlerts(); renderBanner(); render();
}

// Toll icons on the map: one where each route joins a toll road, with the estimated toll for that stretch.
let tollMarkers = [];
function drawTollMarkers() {
  tollMarkers.forEach((m) => m.remove());
  tollMarkers = [];
  if (isTransit()) return;
  S.routes.forEach((r, i) => {
    for (const s of r.tolls || []) {
      if (!s.at) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `toll-pin${i === S.routeIdx ? ' sel' : ''}`;
      el.dataset.route = String(i);
      el.innerHTML = `<b>TOL</b><span>${rm(tollEstimate([s], S.mode).rm)}</span>`;
      el.setAttribute('aria-label', `${t('tollShort')} ${s.name || ''} ${rm(tollEstimate([s], S.mode).rm)}`);
      el.title = `${s.name || t('tollShort')} · ${fmtDist(s.km)}`;
      tollMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(s.at).addTo(map));
    }
  });
}

async function drawRoutes() {
  drawTollMarkers(); // DOM markers need no map style
  await mapReady;
  const sel = S.routes[S.routeIdx];
  // A bus or train trip is drawn leg by leg on its own layers; the plain route line only shows the other choices.
  const legs = sel?.transit ? sel.legs.flatMap((l) => {
    const walk = isWalk(l.mode);
    const line = { type: 'Feature', properties: { walk, color: l.color || (isRail(l.mode) ? '#2D7FF9' : '#E0A100') }, geometry: { type: 'LineString', coordinates: l.coords } };
    return walk ? [line] : [line, ...[l.coords[0], l.coords[l.coords.length - 1]].map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }))];
  }) : [];
  map.getSource('transit')?.setData(fc(legs));
  const feats = S.routes.map((r, i) => ({ type: 'Feature', properties: { idx: i, sel: i === S.routeIdx }, geometry: { type: 'LineString', coordinates: r.coords } }))
    .filter((f) => !(sel?.transit && f.properties.sel));
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
  S.routeErr = null;
  if (!S.fuel) loadFuelPrices().then((f) => { S.fuel = f; if (S.tab === 'drive' && S.routes.length) render(); });
  try {
    const routes = isTransit()
      ? await getTransit({ from, to: [dest.lon, dest.lat], mode: S.mode, time: leaveIso() }, routeAbort.signal)
      : await withNoToll(from, [dest.lon, dest.lat], routeAbort.signal);
    routes.forEach(scanRoute);
    labelRoutes(routes);
    S.routes = routes;
    S.routeIdx = S.avoidTolls && !isTransit() ? Math.max(0, routes.findIndex((x) => x.noToll)) : 0;
    S.routeStatus = 'ok';
    drawRoutes();
    checkRouteArea(routes, routeAbort.signal);
    S.tollSearch = null;
    if (!isTransit() && !routes.some((x) => x.tolls?.length)) addTollRoute(routes, from, [dest.lon, dest.lat], routeAbort.signal);
    fitTo(routes[0].coords.filter((_, i, a) => i % Math.ceil(a.length / 60) === 0).concat([[dest.lon, dest.lat], from]), 16);
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.routeStatus = 'error';
    S.routeErr = e.code || null;
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
document.addEventListener('change', (e) => {
  const veh = { 'veh-fuel': 'fuel', 'veh-car': 'carL', 'veh-moto': 'motoL', 'veh-ev': 'evKwh' }[e.target.id];
  if (veh) { S.vehicle = setVehicle({ [veh]: e.target.value }); render(); return; }
  if (e.target.id !== 'leave-at') return;
  S.leaveAt = e.target.value || '';
  if (S.dest && isTransit()) computeRoute();
});
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'pt-q') return;
  if (e.key === 'Escape') { S.ptEdit = null; render(); }
  if (e.key === 'Enter') { e.preventDefault(); if (ptResults[0]) setPoint(S.ptEdit, toPoint(ptResults[0])); }
});
const toPoint = (r) => ({ id: `search-${r.id}`, name: r.name, lat: r.lat, lon: r.lon });

// ---------------------------------------------------------------- hazards on the route
/** Flood stations, community pins and state weather warnings that touch route r. */
function scanRoute(r) {
  r.m ||= measure(r.coords);
  r.hits = pointHazards(r.m, allAlerts());
  r.areas = areaWarnings(S.alerts, r.states || []);
}

// Prefer a route with fewer hazards if one exists.
function labelRoutes(routes) {
  if (routes[0]?.transit) { routes.forEach((r) => { r.label = 'alt'; }); return; }
  const n0 = hazardCount(routes[0]);
  const safer = routes.findIndex((r) => hazardCount(r) < n0);
  routes.forEach((r, i) => { r.label = i === 0 ? 'fastest' : (i === safer ? 'safest' : r.noToll ? 'noToll' : r.withToll ? 'withToll' : 'alt'); });
}

/** Haze and state weather warnings need network lookups, so they arrive a moment after the route. */
async function checkRouteArea(routes, signal) {
  routes.forEach((r) => { r.areaStatus = 'loading'; });
  await Promise.all(routes.map(async (r) => {
    const [haze, states] = await Promise.all([
      routeHaze(r.m, signal).catch(() => null),
      routeStates(r.m, signal).catch(() => []),
    ]);
    r.haze = haze; r.states = states; r.areaStatus = 'ok';
    scanRoute(r);
  }));
  if (signal?.aborted || S.routes !== routes) return;
  if (!S.nav) labelRoutes(routes);
  if (S.tab === 'drive') render();
  if (S.nav) navAreaWarnings();
}

/** New alerts or pins arrived: refresh what each route passes. */
function rescanRoutes() {
  if (!S.routes.length) return;
  S.routes.forEach(scanRoute);
  if (S.tab === 'drive' && !S.ptEdit) render();
}

const hazIcon = (a) => a.icon || (a.kind === 'flood' ? 'flood' : a.kind === 'weather' ? 'storm' : 'accident');
const sevCls = (s) => (s === 'danger' ? 'danger' : s === 'warning' ? 'warn' : 'info');

function hazardRows(r) {
  const lang = getLang();
  const rows = r.hits.map(({ a, km, off }) => {
    const where = [km < 0.5 ? t('hazAtStart') : t('hazIn').replace('{d}', fmtDist(km)), off > 0.3 ? t('hazOff').replace('{d}', fmtDist(off)) : '']
      .filter(Boolean).join(' · ');
    return { sev: a.severity, html: `<button class="row haz-row" data-alert="${esc(a.id)}"><span class="ic ${sevCls(a.severity)}">${icon(hazIcon(a))}</span><span class="mid"><b>${esc(L(a, 'title'))}</b><small>${esc([where, a.place].filter(Boolean).join(' · '))}</small></span></button>` };
  });
  if (r.haze) {
    const lv = r.haze.level;
    rows.push({ sev: r.haze.aqi > 150 ? 'danger' : 'warning', html: `<div class="row haz-row"><span class="ic ${r.haze.aqi > 150 ? 'danger' : 'warn'}">${icon('haze')}</span><span class="mid"><b>${esc(t('hazHaze').replace('{n}', Math.round(r.haze.aqi)))} · ${esc(lv?.[lang] || lv?.en || '')}</b><small>${esc(`${r.haze.km < 0.5 ? t('hazAtStart') : t('hazAround').replace('{d}', fmtDist(r.haze.km))} · ${t(S.mode === 'moto' ? 'hazHazeTipMoto' : isTransit() ? 'hazHazeTipTransit' : 'hazHazeTip')}`)}</small></span></div>` });
  }
  for (const { a, states } of r.areas || []) {
    rows.push({ sev: a.severity, html: `<button class="row haz-row" data-tab="alerts"><span class="ic ${sevCls(a.severity)}">${icon('storm')}</span><span class="mid"><b>${esc(t('hazArea').replace('{s}', states.join(', ')))}</b><small>${esc(L(a, 'title'))}</small></span></button>` });
  }
  return rows;
}

function routeHazardsView(r) {
  const rows = hazardRows(r);
  const checking = r.areaStatus === 'loading' ? `<p class="muted haz-check"><span class="spinner"></span>${t('hazChecking')}</p>` : '';
  if (!rows.length) return `<p class="muted" style="margin-bottom:10px;color:var(--success)">${t('routeOk')}</p>${checking}`;
  const worst = rows.some((x) => x.sev === 'danger') ? 'danger' : 'warn';
  return `<div class="haz-box ${worst}"><div class="haz-head">${icon('accident')}<b>${t('hazTitle')}</b><span>${rows.length}</span></div>
    <div class="list">${rows.map((x) => x.html).join('')}</div>${checking}</div>`;
}

/** Spoken once when driving starts (or when the lookups finish): haze and state warnings. */
function navAreaWarnings() {
  const r = S.routes[S.routeIdx];
  if (!S.nav || !r) return;
  if (r.haze && !S.nav.alertSaid.has('haze')) {
    S.nav.alertSaid.add('haze');
    say((p) => p.haze(Math.round(r.haze.aqi), S.mode === 'moto'), { queue: true });
  }
  for (const { a, states } of r.areas || []) {
    if (S.nav.alertSaid.has(a.id)) continue;
    S.nav.alertSaid.add(a.id);
    say((p) => p.weather(states.join(', ')), { queue: true });
  }
}

/** The next hazard ahead of the driver: { a, ahead } in km, or null. */
function nextHazard(r) {
  if (!S.me || !r.m || !r.hits?.length) return null;
  const me = along(r.m, S.me).km;
  for (const h of r.hits) {
    const ahead = h.km - me;
    if (ahead > -0.2 - (h.a.radiusKm || 0)) return { a: h.a, ahead: Math.max(0, ahead) };
  }
  return null;
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
  say((p) => `${p.start} ${p.step(r.steps[0])}${p.end || '.'} ${announce(p, r.steps[1], r.steps[0].distance)}`);
  markSaid(1, r.steps[0].distance);
  navAreaWarnings();
  if (navigator.geolocation) {
    S.nav.watchId = navigator.geolocation.watchPosition(onNavPos, () => {}, { enableHighAccuracy: true, maximumAge: 1000 });
  }
  S.nav.follow = true;
  S.nav.heading = routeBearing(r, S.me || r.coords[0]);
  drawMe();
  map.easeTo({ center: S.me || r.coords[0], zoom: 17.5, bearing: S.nav.heading, pitch: isPlay() ? PLAY_PITCH : 55, padding: navPadding(), duration: 900 });
  updateHud();
  const g = award('nav');
  if (isPlay() || g.badges.length) setTimeout(() => celebrate(g), 3400);
}

/** "In 500 metres, turn left onto Jalan Pudu", in the chosen voice pack `p`. */
function announce(p, step, metres) {
  if (!step) return '';
  const text = p.step(step);
  if (metres == null || metres < 150) return text;
  return p.inDist(p.dist(metres), text);
}

/** Speak a line built by `fn(phrases, pack)` in the driver's chosen voice (dialect, Tamil, Chinese, EN or BM). */
function say(fn, opts) {
  const pk = activePack(getLang());
  speak(fn(pk.p, pk), pk, opts);
}
/** Hazard title in the language the voice pack reads (BM text for BM and dialects, English otherwise). */
const sayTitle = (a, pk) => (pk.base === 'bm' && a.title_bm) || a.title || '';

function onNavPos(pos) {
  const r = S.routes[S.routeIdx];
  if (!r || !S.nav || S.nav.rerouting) return;
  const prev = S.me;
  S.me = [pos.coords.longitude, pos.coords.latitude];
  S.nav.heading = carHeading(pos, prev, r);
  drawMe(true);
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
    if (!S.nav.said.has('arrived')) { S.nav.said.add('arrived'); say((p) => p.arrived); }
  } else {
    // closest stage first, so entering a short step speaks once, not twice
    for (const [limit, id] of [...VOICE_STAGES].reverse()) {
      const key = `${S.nav.step}:${id}`;
      if (m > limit) continue;
      if (!S.nav.said.has(key)) {
        VOICE_STAGES.forEach(([l, other]) => { if (l >= limit) S.nav.said.add(`${S.nav.step}:${other}`); });
        say((p) => (id === 'near' ? p.step(step) : announce(p, step, m)));
      }
      break;
    }
  }

  // Hazards ahead on the route: a heads-up at about 3 km and again just before it.
  const me = r.m ? along(r.m, S.me).km : 0;
  for (const { a, km } of r.hits || []) {
    const ahead = km - me;
    const reach = a.radiusKm || 0;
    if (ahead < -0.2 - reach || ahead > 3 + reach) continue;
    const title = L(a, 'title');
    if (ahead > 0.6 + reach) {
      if (S.nav.alertSaid.has(`${a.id}:far`)) continue;
      S.nav.alertSaid.add(`${a.id}:far`);
      say((p, pk) => p.hazFar(sayTitle(a, pk), p.dist(ahead * 1000)));
    } else {
      if (S.nav.alertSaid.has(`${a.id}:near`)) continue;
      S.nav.alertSaid.add(`${a.id}:near`); S.nav.alertSaid.add(`${a.id}:far`);
      say((p, pk) => p.hazNear(sayTitle(a, pk), S.mode === 'moto'));
    }
    toast(`${title}${a.place ? ` · ${a.place}` : ''}`);
  }

  // Follow the car, heading up, zooming out a little at highway speed. A drag on the map pauses this.
  if (S.nav.follow) {
    const kmh = (pos.coords.speed || 0) * 3.6;
    map.easeTo({ center: S.me, bearing: S.nav.heading, zoom: kmh > 80 ? 16 : kmh > 40 ? 16.8 : 17.5, padding: navPadding(), duration: 900 });
  }
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
  say((p) => p.reroute);
  $('#hud-text').textContent = lang === 'bm' ? 'Mengira semula laluan…' : 'Rerouting…';
  try {
    const keepOff = Boolean(S.routes[S.routeIdx]?.noToll);
    const routes = await getRoutes(S.me, [S.dest.lon, S.dest.lat], undefined, { noToll: keepOff }).catch(() => getRoutes(S.me, [S.dest.lon, S.dest.lat]));
    if (!S.nav) return;
    const old = S.routes[S.routeIdx];
    routes.forEach((x) => { x.noToll = keepOff && !x.tolls?.length; });
    routes.forEach((x) => { x.states = old?.states; x.haze = old?.haze; scanRoute(x); x.label = 'fastest'; });
    S.routes = [routes[0]]; S.routeIdx = 0;
    S.nav.step = 1; S.nav.said = new Set(); S.nav.offCount = 0;
    drawRoutes();
    say((p) => announce(p, routes[0].steps[1], routes[0].steps[0].distance));
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
  const hz = nextHazard(r), box = $('#hud-haz');
  box.hidden = !hz || hz.ahead > 10;
  if (!box.hidden) {
    box.className = `hud-haz ${sevCls(hz.a.severity)}`;
    box.innerHTML = `${icon(hazIcon(hz.a))}<span>${esc(L(hz.a, 'title'))}</span><b>${hz.ahead < 0.1 ? t('hazHere') : fmtDist(hz.ahead)}</b>`;
  }
}

// ---------------------------------------------------------------- voice picker (dialects, Tamil, Chinese)
const packName = (x) => x.name[getLang()] || x.name.en;
function voiceChip() {
  if (!voiceSupported()) return '';
  const x = VOICE_PACKS.find((v) => v.id === getVoicePack()) || VOICE_PACKS[0];
  return `<button class="voice-chip" data-action="voice-pick">${icon('sound')}<span>${t('voiceStyle')}: <b>${esc(packName(x))}</b></span></button>`;
}
function renderVoiceDialog() {
  const cur = getVoicePack(), loaded = voicesLoaded();
  const groups = [['std', 'voiceStd'], ['dialect', 'voiceDialects'], ['lang', 'voiceLangs']];
  $('#voice-body').innerHTML = groups.map(([g, label]) => `<h3>${t(label)}</h3>
    <div class="voice-list" role="radiogroup" aria-label="${esc(t(label))}">${VOICE_PACKS.filter((x) => x.group === g).map((x) => {
      const missing = x.needs && loaded && !findVoice(x);
      return `<button class="voice-opt" role="radio" aria-checked="${x.id === cur}" data-pack="${x.id}">
        <span class="mid"><b>${esc(packName(x))}</b><small>${esc(missing ? t('voiceMissing') : x.hint)}</small></span>
        <span class="voice-play" aria-hidden="true">${icon('sound')}</span></button>`;
    }).join('')}</div>`).join('')
    + `<p class="muted sm">${t('voiceNote')}</p>`;
}
const voiceDlg = $('#voice-dlg');
function openVoiceDialog() { renderVoiceDialog(); voiceDlg.showModal(); }
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="voice-pick"]')) { e.preventDefault(); openVoiceDialog(); return; }
  const opt = e.target.closest('#voice-dlg [data-pack]');
  if (!opt) return;
  setVoicePack(opt.dataset.pack);
  renderVoiceDialog();
  say((p) => p.sample, { force: true }); // preview, even while muted
  if (!S.nav) render(); else syncVoiceBtn();
});
$('#voice-close').addEventListener('click', () => voiceDlg.close());
$('#hud-voice-pick').addEventListener('click', openVoiceDialog);
if (voiceSupported()) speechSynthesis.addEventListener?.('voiceschanged', () => { if (voiceDlg.open) renderVoiceDialog(); });

// ---------------------------------------------------------------- free radio
const radioDlg = $('#radio-dlg');
let radioQ = '';
const stIcon = (st) => st.favicon
  ? `<img src="${esc(st.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'st-ph',textContent:'${esc(st.name.slice(0, 1).toUpperCase())}'}))">`
  : `<span class="st-ph">${esc(st.name.slice(0, 1).toUpperCase())}</span>`;
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>';

function renderRadioNow() {
  const { current, status, volume } = radio.radioState();
  const on = status === 'playing' || status === 'loading';
  const sub = status === 'playing' ? t('radioLive') : status === 'loading' ? t('radioConnecting') : status === 'error' ? t('radioError') : current ? t('radioPaused') : t('radioPick');
  $('#radio-now').innerHTML = `<div class="rn-card${on ? ' on' : ''}">
      ${current ? stIcon(current) : `<span class="st-ph">FM</span>`}
      <span class="mid"><b>${esc(current?.name || t('radioTitle'))}</b><small class="${status === 'error' ? 'err' : ''}">${status === 'playing' ? '<span class="rn-dot"></span>' : ''}${esc(sub)}</small></span>
      <button class="rn-play" data-radio="toggle" ${current ? '' : 'disabled'} aria-label="${esc(on ? t('radioStop') : t('radioPlay'))}">${on ? STOP_SVG : PLAY_SVG}</button>
    </div>
    <label class="rn-vol"><span class="sr-only">${t('radioVolume')}</span>${icon('sound')}<input type="range" id="radio-vol" min="5" max="100" value="${Math.round(volume * 100)}"></label>`;
}
function renderRadioList() {
  const { stations, current, status, loaded, listFailed } = radio.radioState();
  const body = $('#radio-body');
  if (!loaded) {
    body.innerHTML = listFailed ? `<p class="muted">${t('radioListFailed')}</p>` : `<p class="muted"><span class="spinner"></span> ${t('radioLoading')}</p>`;
    return;
  }
  const q = radioQ.trim().toLowerCase();
  const match = (st) => !q || `${st.name} ${st.tags.join(' ')} ${st.state}`.toLowerCase().includes(q);
  const row = (st) => {
    const playing = current?.id === st.id && (status === 'playing' || status === 'loading');
    const meta = [st.state, ...st.tags.slice(0, 2)].filter(Boolean).join(' · ');
    return `<li class="st-row${playing ? ' on' : ''}">
      <button class="st-main" data-radio-play="${esc(st.id)}" aria-pressed="${playing}">${stIcon(st)}
        <span class="mid"><b>${esc(st.name)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</span>
        ${playing ? '<span class="eq on" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</button>
      <button class="st-fav" data-radio-fav="${esc(st.id)}" aria-pressed="${radio.isFav(st.id)}" aria-label="${esc(t('radioFav'))}">${STAR_SVG}</button>
    </li>`;
  };
  const list = stations.filter(match);
  const favs = list.filter((x) => radio.isFav(x.id));
  const rtm = list.filter((x) => x.rtm && !radio.isFav(x.id));
  const rest = list.filter((x) => !x.rtm && !radio.isFav(x.id));
  const group = (title, arr) => arr.length ? `<h3>${title}</h3><ul class="st-list">${arr.map(row).join('')}</ul>` : '';
  body.innerHTML = (list.length ? group(t('radioFavs'), favs) + group(t('radioRtm'), rtm) + group(t('radioPopular'), rest) : `<p class="muted">${t('radioNone')}</p>`)
    + `<p class="muted sm">${t('radioNote')}</p>`;
}
function syncRadioBtns() {
  const { current, status } = radio.radioState();
  const on = status === 'playing' || status === 'loading';
  for (const b of [$('#radio-btn'), $('#hud-radio')]) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('#radio-btn').setAttribute('aria-label', on && current ? `${t('radioTitle')}: ${current.name}` : t('radioTitle'));
  $('#hud-radio').setAttribute('aria-label', on ? t('radioStop') : t('radioPlay'));
}
function openRadio() {
  radioQ = ''; $('#radio-q').value = '';
  renderRadioNow(); renderRadioList();
  radioDlg.showModal();
  radio.loadStations();
}
radio.onRadioChange(() => {
  syncRadioBtns();
  if (radioDlg.open) { renderRadioNow(); renderRadioList(); }
  if (radio.radioState().status === 'error') toast(t('radioError'));
});
$('#radio-btn').addEventListener('click', openRadio);
$('#radio-close').addEventListener('click', () => radioDlg.close());
radioDlg.addEventListener('click', (e) => { if (e.target === radioDlg) radioDlg.close(); });
$('#hud-radio').addEventListener('click', () => { if (radio.radioState().current) radio.toggle(); else openRadio(); });
$('#radio-q').addEventListener('input', (e) => { radioQ = e.target.value; renderRadioList(); });
radioDlg.addEventListener('input', (e) => { if (e.target.id === 'radio-vol') radio.setVolume(e.target.value / 100); });
radioDlg.addEventListener('click', (e) => {
  if (e.target.closest('[data-radio="toggle"]')) { radio.toggle(); return; }
  const fav = e.target.closest('[data-radio-fav]');
  if (fav) { radio.toggleFav(fav.dataset.radioFav); return; }
  const pl = e.target.closest('[data-radio-play]');
  if (pl) {
    const st = radio.radioState().stations.find((x) => x.id === pl.dataset.radioPlay);
    const { current, status } = radio.radioState();
    if (st && current?.id === st.id && (status === 'playing' || status === 'loading')) radio.stop(); else radio.play(st);
  }
});
syncRadioBtns();

function syncVoiceBtn() {
  const b = $('#hud-voice');
  b.hidden = !voiceSupported();
  b.setAttribute('aria-pressed', String(voiceOn()));
  b.setAttribute('aria-label', voiceOn() ? t('voiceOff') : t('voiceOn'));
  b.innerHTML = icon(voiceOn() ? 'sound' : 'mute');
  $('#hud-voice-pick').hidden = !voiceSupported();
}

function stopNav() {
  if (S.nav?.watchId != null) navigator.geolocation.clearWatch(S.nav.watchId);
  S.nav = null;
  if (voiceSupported()) speechSynthesis.cancel();
  document.body.classList.remove('navigating');
  $('#hud').hidden = true;
  recentreBtn().hidden = true;
  drawMe();
  map.easeTo({ pitch: isPlay() ? PLAY_PITCH : 0, bearing: 0, duration: 600 });
}

/** Shown when the driver drags the map during navigation; tap to follow the car again. */
function recentreBtn() {
  let b = $('#recentre');
  if (!b) {
    b = document.createElement('button');
    b.id = 'recentre'; b.className = 'recentre'; b.dataset.action = 'recentre'; b.hidden = true;
    b.innerHTML = `${icon('nav')}<span>${t('recentre')}</span>`;
    $('#app').appendChild(b);
  }
  return b;
}
function recentre() {
  if (!S.nav) return;
  S.nav.follow = true;
  recentreBtn().hidden = true;
  map.easeTo({ center: S.me || map.getCenter(), bearing: S.nav.heading || 0, zoom: 17.5, pitch: isPlay() ? PLAY_PITCH : 55, padding: navPadding(), duration: 700 });
}

// ---------------------------------------------------------------- alerts
async function refreshAlerts() {
  const d = await loadAlerts();
  S.alerts = d.alerts; S.alertMode = d.mode; S.alertsAt = d.fetchedAt;
  noteSaved('alerts', d.saved ? d.fetchedAt || d.saved : null);
  rescanRoutes();
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
  const wasHidden = b.hidden;
  b.hidden = !n || S.tab === 'alerts';
  // only one banner at a time: the news headline steps aside while an alert is shown
  if (b.hidden !== wasHidden) renderNewsBar();
  if (b.hidden) { syncLayout(); return; }
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
  const ae = document.activeElement;
  const keep = ae?.id === 'cm-text' ? [ae.selectionStart, ae.selectionEnd] : null; // a refresh must not kick someone out of typing
  body.innerHTML = S.tab === 'drive' ? viewDrive() : S.tab === 'alerts' ? viewAlerts() : S.tab === 'weather' ? viewWeather() : S.tab === 'news' ? viewNews() : (S.selected ? viewPlace() : viewExplore());
  body.insertAdjacentHTML('beforeend', `${statsLine()}<p class="copyright">${t('copyright')}<br><a href="/terms.html">${t('terms')}</a> · <a href="/privacy.html">${t('privacy')}</a> · <button class="linkish" data-action="subscribe">${t('subLink')}</button></p>`);
  syncLayout();
  if (S.tab === 'drive' && S.ptEdit) $('#pt-q')?.focus({ preventScroll: true });
  if (keep && $('#cm-text')) { const el = $('#cm-text'); el.focus({ preventScroll: true }); el.setSelectionRange(...keep); }
}

function placeRow(p) {
  return `<li><button class="row${S.selected?.id === p.id ? ' sel' : ''}" data-place="${esc(p.id)}">
    <span class="ic">${icon(p.cat)}${brandLogo(p)}</span>
    <span class="mid"><b>${esc(p.name)}</b><small>${esc(p.meta || CATEGORIES[p.cat][getLang()])}</small></span>
    <span class="end"><b>${fmtDist(p.distKm)}</b>${p.hours === '24/7' ? '<small>24h</small>' : ''}</span>
  </button></li>`;
}

// ---------------------------------------------------------------- saved places (Home, Work)
const savedLabel = (k) => t(k === 'home' ? 'savedHome' : 'savedWork');
const tk = (key, k) => t(key).replace('{k}', savedLabel(k));
const savedPlace = (k) => {
  const p = S.saved[k];
  return { id: `saved-${k}`, cat: k, name: p.name || savedLabel(k), lat: p.lat, lon: p.lon, meta: savedLabel(k), distKm: distKm(S.me || center(), [p.lon, p.lat]) };
};
function savedBar() {
  const cards = SAVED_KINDS.map((k) => {
    const p = S.saved[k];
    if (!p) return `<div class="saved-card empty"><button class="saved-go" data-action="saved-set" data-kind="${k}"><span class="ic">${icon(k)}</span><span class="mid"><b>${tk(k === 'home' ? 'setHome' : 'setWork', k)}</b></span></button></div>`;
    const d = S.me ? fmtDist(distKm(S.me, [p.lon, p.lat])) : '';
    return `<div class="saved-card"><button class="saved-go" data-action="saved-go" data-kind="${k}" aria-label="${t('directions')}: ${esc(savedLabel(k))}"><span class="ic">${icon(k)}</span><span class="mid"><b>${esc(savedLabel(k))}</b><small>${esc([d, p.name].filter(Boolean).join(' · '))}</small></span></button><button class="saved-edit" data-action="saved-set" data-kind="${k}" aria-label="${t('saveChange')} ${esc(savedLabel(k))}">${icon('edit')}</button></div>`;
  }).join('');
  const k = S.saveMode;
  const panel = k ? `<div class="save-panel" role="group" aria-label="${esc(tk('saveSetTitle', k))}">
      <b>${esc(tk('saveSetTitle', k))}</b>
      <button class="btn-ghost" data-action="saved-loc" data-kind="${k}">${icon('locate')}${t('saveUseLoc')}</button>
      <button class="btn-ghost" data-action="saved-search" data-kind="${k}">${icon('search')}${t('saveSearch')}</button>
      <div class="save-panel-foot">${S.saved[k] ? `<button class="link danger" data-action="saved-remove" data-kind="${k}">${t('saveRemove')}</button>` : '<span></span>'}<button class="link" data-action="saved-cancel">${t('cancel')}</button></div>
      <small class="muted">${t('savedNote')}</small>
    </div>` : '';
  return `<div class="saved-bar">${cards}</div>${panel}`;
}
function saveButtons(p) {
  const at = savedKindAt(S.saved, p.lat, p.lon);
  return `<div class="save-row">${SAVED_KINDS.map((k) => (at === k
    ? `<span class="tag ok">${icon(k)}${tk(k === 'home' ? 'savedAsHome' : 'savedAsWork', k)}</span>`
    : `<button class="btn-ghost sm${S.saveMode === k ? ' pulse' : ''}" data-action="save-place" data-kind="${k}">${icon(k)}${tk(k === 'home' ? 'saveAsHome' : 'saveAsWork', k)}</button>`)).join('')}</div>`;
}

function viewExplore() {
  if (!S.cat) {
    return `${savedBar()}<div class="sh-head"><h2>${t('pickCat')}</h2></div><p class="muted">${t('pickCatHint')}</p>${quickGrid()}<div class="sub-card"><span class="sub-ic">${icon('mail')}</span><span class="mid"><b>${t('subTitle')}</b><small>${t('subCard')}</small></span><button class="btn sm" data-action="subscribe">${t('subBtn')}</button></div>`;
  }
  const c = CATEGORIES[S.cat];
  const head = `<div class="sh-head"><h2>${esc(c[getLang()])} ${t('nearby').toLowerCase()}</h2>${S.places.length > 3 ? `<button class="link" data-action="toggle-all">${S.showAll ? t('showLess') : `${t('seeAll')} (${S.places.length})`}</button>` : ''}</div>`;
  if (S.placesStatus === 'loading') return `${head}<div class="empty-state"><span class="spinner"></span>${t('loading')}</div>`;
  if (S.placesStatus === 'error') return `${head}<div class="empty-state">${icon('search')}${t('failed')}<button class="btn-ghost" data-action="retry">${t('retry')}</button>${gmapsBtn(S.cat)}</div>`;
  if (S.placesStatus === 'empty') return `${head}<div class="empty-state">${icon('search')}${t('none')}<button class="btn-ghost" data-action="retry">${t('searchArea')}</button>${gmapsBtn(S.cat)}</div>`;
  const list = S.showAll ? S.places : S.places.slice(0, 3);
  const first = S.places[0];
  return `${head}${S.cat === 'shelter' ? shelterNote() : ''}<ul class="list">${list.map(placeRow).join('')}</ul>
    <div class="btns"><button class="btn" data-action="go" data-place="${esc(first.id)}">${icon('nav')}${t('directions')}: ${esc(first.name)}</button></div>
    <p class="gmaps-row">${t('gmapsMore')} ${gmapsBtn(S.cat)}</p>`;
}

// "Search on Google Maps" hand-off: opens Google Maps (app or web) searching this category near the
// area being viewed. Uses the official Maps URLs, so no API key, no cost, and no Google data on our map.
const GMAPS_Q = {
  ev: 'EV charging station', fuel: 'petrol station', food: 'fast food', toilet: 'public toilet',
  surau: 'surau masjid', hospital: 'hospital klinik', pharmacy: 'farmasi pharmacy', workshop: 'car workshop bengkel kereta',
  police: 'balai polis', fire: 'balai bomba', shelter: 'pusat pemindahan banjir',
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

// Shelters from OpenStreetMap are permanent places; which relief centres are open in a flood is
// announced by JKM, so point people to the official list too.
const shelterNote = () => `<p class="note-card">${icon('shelter')}<span>${t('shelterNote')} <a href="https://infobencanajkm.jkm.gov.my/" target="_blank" rel="noopener">InfoBencana JKM</a></span></p>`;

function viewPlace() {
  const p = S.selected;
  const near = allAlerts().filter((a) => a.lat != null && distKm([p.lon, p.lat], [a.lon, a.lat]) < (a.radiusKm || 1) + 0.5);
  return `<div class="sh-head"><button class="link" data-action="back">${t('nearby')}</button><button class="link" data-action="back" aria-label="${t('close')}">${t('close')}</button></div>
  <div class="place">
    <h2>${brandLogo(p, 96) ? `<span class="place-logo">${brandLogo(p, 96)}</span>` : ''}${esc(p.name)}</h2>
    <p class="meta">${[CATEGORIES[p.cat]?.[getLang()], `${fmtDist(p.distKm)} ${t('away')}`].filter(Boolean).map(esc).join(' · ')}</p>
    ${p.meta ? `<p class="meta">${esc(p.meta)}</p>` : ''}
    ${p.address && p.address !== p.meta ? `<p class="meta">${esc(p.address)}</p>` : ''}
    ${saveButtons(p)}
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
        ${SAVED_KINDS.filter((k) => S.saved[k]).map((k) => `<li><button type="button" class="row" data-action="pt-saved" data-kind="${k}"><span class="ic">${icon(k)}</span><span class="mid"><b>${esc(savedLabel(k))}</b><small>${esc(S.saved[k].name || '')}</small></span></button></li>`).join('')}
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
  const pts0 = `<div class="route-pts">${ptRow('start')}${ptRow('end')}${S.dest && !S.ptEdit ? `<button class="pt-swap" data-action="pt-swap" aria-label="${t('swap')}" title="${t('swap')}">${icon('swap')}</button>` : ''}</div>`;
  if (!S.dest) {
    return `${S.ptEdit ? '' : savedBar()}<div class="sh-head"><h2>${t('noDest')}</h2></div>${pts0}${S.ptEdit ? '' : `${modeBar()}<p class="muted">${t('noDestHint')}</p>${quickGrid()}`}`;
  }
  if (S.ptEdit) return pts0;
  const pts = `${pts0}${modeBar()}${isTransit() ? leaveBar() : ''}`;
  if (S.routeStatus === 'loading') return `${pts}<div class="empty-state"><span class="spinner"></span>${t(isTransit() ? 'transitLoading' : 'routing')}</div>`;
  if (S.routeStatus === 'error') {
    if (isTransit()) {
      return `${pts}<div class="empty-state">${icon(S.mode)}${t(S.routeErr === 'none' ? (S.mode === 'bus' ? 'transitNoneBus' : 'transitNoneTrain') : 'transitFailed')}
        <button class="btn-ghost" data-action="reroute">${t('retry')}</button></div>
        <p class="gmaps-row"><a class="btn-ghost gmaps" href="${esc(gmapsTransit(S.start || meCoords(), S.dest))}" target="_blank" rel="noopener">${icon('search')}${t('gmapsTransit')}</a></p>${ridesView()}`;
    }
    return `${pts}<div class="empty-state">${icon('nav')}${t('routeFailed')}<button class="btn-ghost" data-action="reroute">${t('retry')}</button></div>`;
  }
  const r = S.routes[S.routeIdx];
  if (!r) return pts;
  if (r.transit) return `${pts}${viewTransit(r)}`;
  const alts = S.routes.length > 1 ? `<div class="alts" role="group">${S.routes.map((x, i) =>
    `<button class="alt" data-route="${i}" aria-pressed="${i === S.routeIdx}"><b>${fmtDur(x.duration, lang)}</b>${t(x.label)} · ${fmtDist(x.distance / 1000)}${hazardCount(x) ? ` · ⚠ ${hazardCount(x)}` : ''}<span class="alt-toll${x.tolls?.length ? '' : ' free'}">${tollTag(x)}</span></button>`).join('')}</div>` : '';
  const warn = routeHazardsView(r);
  const steps = r.steps.map((s) => `<li class="row"><span class="ic info">${maneuverIcon(s)}</span><span class="mid"><b style="font-size:15px;font-weight:500;white-space:normal">${esc(stepText(s, lang))}</b></span><span class="end"><small style="color:var(--text-subtle)">${s.distance ? fmtDist(s.distance / 1000) : ''}</small></span></li>`).join('');
  // Live turn-by-turn follows GPS, so it needs the route to begin where the user is.
  const go = S.start
    ? `<p class="muted pt-note">${t('previewOnly')}</p><button class="btn-ghost" data-action="pt-reset-start">${icon('nav')}${t('navFromMe')}</button>`
    : `<button class="btn" data-action="start-nav">${icon('nav')}${t('start')}</button>${voiceChip()}`;
  return `${pts}
    <div class="summary"><b>${fmtDur(r.duration, lang)}</b><span>${fmtDist(r.distance / 1000)}${r.via ? ` · ${t('via')} ${esc(r.via)}` : ''}</span></div>
    ${tollBar()}${alts}${warn}
    ${go}
    ${costView(r)}
    ${compareView(r.distance / 1000, r.duration / 60)}
    ${ridesView()}
    <div class="sh-head" style="margin-top:16px"><h2 style="font-size:16px">${t('steps')}</h2></div>
    <ol class="list steps">${steps}</ol>`;
}

// ---------------------------------------------------------------- travel modes
const MODES = ['car', 'moto', 'bus', 'train'];
function loadMode() {
  try { const m = localStorage.getItem('navmap.mode'); return ['car', 'moto', 'bus', 'train'].includes(m) ? m : 'car'; } catch { return 'car'; }
}
function setMode(m) {
  if (!MODES.includes(m) || S.nav) return;
  S.mode = m;
  try { localStorage.setItem('navmap.mode', m); } catch { /* private mode */ }
  if (S.dest) computeRoute(); else render();
}
const isTransit = () => S.mode === 'bus' || S.mode === 'train';
const meCoords = () => (S.me ? { lat: S.me[1], lon: S.me[0] } : null);

function modeBar() {
  return `<div class="modes" role="group" aria-label="${esc(t('modeTitle'))}">${MODES.map((m) =>
    `<button class="mode" data-action="mode" data-mode="${m}" aria-pressed="${S.mode === m}">${icon(m)}<span>${t(`mode_${m}`)}</span></button>`).join('')}</div>`;
}

/** Bus and train: leave now, or at a time the user picks (Malaysian time). */
function leaveBar() {
  return `<div class="leave"><label for="leave-at">${icon('clock')}${t('leaveAt')}</label>
    <input id="leave-at" type="time" value="${esc(S.leaveAt)}" aria-describedby="leave-now">
    ${S.leaveAt ? `<button class="btn-ghost" data-action="leave-now" id="leave-now">${t('leaveNow')}</button>` : `<span class="muted" id="leave-now">${t('leaveNowOn')}</span>`}</div>`;
}

function leaveIso() {
  if (!/^\d{2}:\d{2}$/.test(S.leaveAt)) return '';
  const day = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  let at = new Date(`${day}T${S.leaveAt}:00+08:00`);
  if (at < Date.now() - 10 * 60e3) at = new Date(at.getTime() + 864e5); // a time already past means tomorrow
  return at.toISOString();
}

const lineBadge = (l) => {
  const bg = l.color || (isRail(l.mode) ? '#2D7FF9' : '#E0A100');
  return `<span class="line-badge" style="--bg:${esc(bg)};--fg:${esc(l.textColor || '#FFFFFF')}">${icon(isRail(l.mode) ? 'train' : 'bus')}${esc(l.line || (isRail(l.mode) ? t('mode_train') : t('mode_bus')))}</span>`;
};

function lateTag(actual, planned) {
  const d = delayMin(actual, planned);
  if (!d) return '';
  return ` <em class="late${d < 0 ? ' early' : ''}">${(d > 0 ? t('transitLate') : t('transitEarly')).replace('{n}', Math.abs(d))}</em>`;
}

function viewTransit(r) {
  const lang = getLang();
  const rides = r.legs.filter((l) => !isWalk(l.mode));
  const alts = S.routes.length > 1 ? `<div class="alts" role="group">${S.routes.map((x, i) =>
    `<button class="alt" data-route="${i}" aria-pressed="${i === S.routeIdx}"><b>${clock(x.start, lang)} → ${clock(x.end, lang)}</b>${fmtDur(x.duration, lang)} · ${x.legs.filter((l) => !isWalk(l.mode)).map((l) => esc(l.line || '')).filter(Boolean).join(' › ')}${hazardCount(x) ? ` · ⚠ ${hazardCount(x)}` : ''}</button>`).join('')}</div>` : '';
  const first = rides[0];
  const sub = [
    first ? t('transitDepart').replace('{t}', clock(first.start, lang)).replace('{s}', first.from.name) : '',
    r.transfers ? t(r.transfers === 1 ? 'transfer1' : 'transferN').replace('{n}', r.transfers) : t('transfer0'),
    r.walkSec > 60 ? t('walkMin').replace('{n}', Math.round(r.walkSec / 60)) : '',
    t('fareAbout').replace('{rm}', rm(transitFare(r.distance / 1000, S.mode))),
  ].filter(Boolean).map(esc).join(' · ');
  const last = r.legs.length - 1;
  const legs = r.legs.map((l, i) => {
    if (isWalk(l.mode)) {
      const to = i === last ? t('transitToDest') : l.to.name;
      const mins = Math.max(1, Math.round((l.duration || 0) / 60));
      return `<li class="leg walk"><span class="ic">${icon('walk')}</span><span class="mid"><b>${esc(t('walkTo').replace('{n}', mins).replace('{s}', to))}</b>
        <small>${esc([l.distance ? fmtDist(l.distance / 1000) : '', clock(l.start, lang)].filter(Boolean).join(' · '))}</small></span></li>`;
    }
    const toward = l.headsign ? ` ${t('towards')} ${esc(l.headsign)}` : '';
    const stops = t(l.stops + 1 === 1 ? 'stop1' : 'stopN').replace('{n}', l.stops + 1);
    return `<li class="leg ride" style="--line:${esc(l.color || (isRail(l.mode) ? '#2D7FF9' : '#E0A100'))}"><span class="ic">${icon(isRail(l.mode) ? 'train' : 'bus')}</span><span class="mid">
      <b><time>${clock(l.start, lang)}</time>${lateTag(l.start, l.startPlan)} ${esc(l.from.name)}${l.from.track ? ` · ${esc(t('platform'))} ${esc(l.from.track)}` : ''}</b>
      <small>${lineBadge(l)}${toward}${l.lineName && l.lineName !== l.line ? ` · ${esc(l.lineName)}` : ''}</small>
      <small>${esc(stops)} · ${fmtDur(l.duration, lang)}${l.agency ? ` · ${esc(l.agency)}` : ''}${l.live ? ` · <span class="live">${t('transitLive')}</span>` : ''}</small>
      <b class="alight"><time>${clock(l.end, lang)}</time> ${esc(t('getOff'))} ${esc(l.to.name)}</b></span></li>`;
  }).join('');
  return `<div class="summary"><b>${clock(r.start, lang)} → ${clock(r.end, lang)}</b><span>${fmtDur(r.duration, lang)}</span></div>
    <p class="muted transit-sub">${sub}</p>
    ${alts}${routeHazardsView(r)}
    <ol class="list legs">${legs}</ol>
    ${compareView(r.distance / 1000, null)}
    ${ridesView()}
    <p class="source">${t('transitSource')}</p>`;
}

// ---------------------------------------------------------------- trip cost (estimates)
const FUELS = ['budi95', 'ron95', 'ron97', 'diesel'];
const fuelPrices = () => S.fuel || { ...FUEL_DEFAULT, live: false };

/** Car or motorcycle: tolls, fuel (litres and RM) and what an EV would cost for the same trip. */
function costView(r) {
  const km = r.distance / 1000, v = S.vehicle, moto = S.mode === 'moto', prices = fuelPrices();
  const toll = tollEstimate(r.tolls, S.mode);
  const fuel = fuelEstimate(km, S.mode, v, prices);
  const ev = evEstimate(km, v);
  const total = fuel.rm + toll.rm;
  const tollRow = moto
    ? `<li><span>${t('costToll')}</span><b>RM0</b><small>${esc(t(toll.count ? 'costTollMoto' : 'costTollNone'))}</small></li>`
    : `<li><span>${t('costToll')}</span><b>${toll.count ? rm(toll.rm) : 'RM0'}</b><small>${esc(toll.count ? t('costTollKm').replace('{d}', fmtDist(toll.km)) : t('costTollNone'))}</small></li>`;
  const save = total - (ev.home + (moto ? 0 : toll.rm));
  const evRow = moto ? '' : `<li class="ev"><span>${icon('ev')}${t('costEv')}</span><b>${rm(ev.home + toll.rm)}</b>
    <small>${esc(t('costEvDetail').replace('{kwh}', ev.kwh.toFixed(1)).replace('{home}', rm(ev.home)).replace('{pub}', rm(ev.public)))}</small>
    ${save > 0.05 ? `<em class="save">${esc(t('costEvSave').replace('{rm}', rm(save)))}${fuel.rm - ev.public > 0.05 ? esc(t('costEvSavePub').replace('{pub}', rm(fuel.rm - ev.public))) : ''}</em>` : ''}</li>`;
  const priceNote = prices.live && prices.date ? t('costPriceLive').replace('{date}', prices.date) : t('costPriceDefault');
  return `<div class="cost card-box"><div class="cost-head"><h2>${t('costTitle')}</h2><span class="est">${t('estimate')}</span></div>
    <ul class="cost-rows">
      <li><span>${icon('fuel')}${t('costFuel')}</span><b>${rm(fuel.rm)}</b><small>${esc(t('costFuelDetail').replace('{l}', fuel.litres.toFixed(1)).replace('{fuel}', t(`fuel_${fuel.fuel}`)).replace('{p}', fuel.price.toFixed(2)))}</small></li>
      ${tollRow}
      <li class="total"><span>${t('costTotal')}</span><b>${rm(total)}</b></li>
      ${evRow}
    </ul>
    <details class="veh"><summary>${icon('edit')}${t('vehTitle')}</summary>
      <label>${t('vehFuel')}<select id="veh-fuel">${FUELS.map((f) => `<option value="${f}"${v.fuel === f ? ' selected' : ''}>${t(`fuel_${f}`)} · RM${(fuelPrices()[f] ?? FUEL_DEFAULT[f]).toFixed(2)}</option>`).join('')}</select></label>
      <label>${t(moto ? 'vehMoto' : 'vehCar')}<input id="${moto ? 'veh-moto' : 'veh-car'}" type="number" inputmode="decimal" min="1" max="40" step="0.1" value="${moto ? v.motoL : v.carL}"></label>
      ${moto ? '' : `<label>${t('vehEv')}<input id="veh-ev" type="number" inputmode="decimal" min="5" max="40" step="0.5" value="${v.evKwh}"></label>`}
    </details>
    <p class="source">${esc(priceNote)} ${esc(t('costNote').replace('{home}', EV_RATE.home.toFixed(2)).replace('{pub}', EV_RATE.public.toFixed(2)))}</p></div>`;
}

/** The same trip by every way of travelling, cheapest first. min = driving minutes when known. */
function compareView(km, min) {
  const v = S.vehicle, prices = fuelPrices();
  const r = S.routes[S.routeIdx];
  const tollCar = r && !r.transit ? tollEstimate(r.tolls, 'car').rm : 0;
  const drive = min ?? (km / 30) * 60;
  const g = grabFare(km, drive);
  const rows = [
    { m: 'car', rm: fuelEstimate(km, 'car', v, prices).rm + tollCar },
    { m: 'moto', rm: fuelEstimate(km, 'moto', v, prices).rm },
    { m: 'ev', rm: evEstimate(km, v).home + tollCar, label: t('costEvShort') },
    { m: 'bus', rm: transitFare(km, 'bus') },
    { m: 'train', rm: transitFare(km, 'train') },
    { m: 'ride', rm: g.low, hi: g.high, label: t('costGrab') },
  ].sort((a, b) => a.rm - b.rm);
  const cheapest = rows[0].rm;
  return `<div class="compare card-box"><div class="cost-head"><h2>${t('cmpTitle')}</h2><span class="est">${t('estimate')}</span></div>
    <ul class="cmp-rows">${rows.map((x) => `<li${x.m === S.mode ? ' class="cur"' : ''}><span>${icon(x.m === 'ev' ? 'ev' : x.m)}${esc(x.label || t(`mode_${x.m}`))}</span>
      <b>${x.hi ? `${rm(x.rm)}–${rm(x.hi)}` : rm(x.rm)}</b>${x.rm === cheapest ? `<em>${t('cmpCheapest')}</em>` : ''}</li>`).join('')}</ul>
    <p class="source">${esc(t('cmpNote'))}</p></div>`;
}

/** Grab, AirAsia Ride and inDrive buttons. Grab gets pickup and drop-off; the others get the destination on the clipboard. */
function ridesView() {
  if (!S.dest) return '';
  return `<div class="rides"><div class="sh-head"><h2 style="font-size:16px">${t('ridesTitle')}</h2></div>
    <div class="ride-btns">${RIDE_APPS.map((a) => `<button class="ride-btn" data-action="ride" data-app="${a.id}" style="--brand:${a.color};--brand-fg:${a.fg || '#FFFFFF'}">${icon('ride')}<span>${esc(a.name)}</span></button>`).join('')}</div>
    <p class="muted ride-note">${t('ridesNote')}</p></div>`;
}

function bookRide(id) {
  const app = RIDE_APPS.find((a) => a.id === id);
  if (!app || !S.dest) return;
  const from = S.start ? { lat: S.start.lat, lon: S.start.lon, name: S.start.name } : meCoords();
  const to = { lat: S.dest.lat, lon: S.dest.lon, name: S.dest.name };
  if (!app.fills && to.name) {
    navigator.clipboard?.writeText(to.name).then(() => toast(t('rideCopied').replace('{s}', to.name)), () => {});
  }
  openRide(app, { from, to });
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
    noteSaved('weather', wx.saved);
  } catch { if (!S.wx) S.wxStatus = 'error'; }
  renderWxFab();
  renderAqFab();
  aqEarlyWarning();
  if (S.tab === 'weather') render();
}

function renderWxFab() {
  const b = $('#wx-btn');
  if (!S.wx) { b.hidden = true; syncConds(); return; }
  const w = wmo(S.wx.now.code, S.wx.now.isDay);
  b.hidden = false;
  b.innerHTML = `${icon(w.icon)}<b>${Math.round(S.wx.now.temp)}°</b>`;
  b.setAttribute('aria-label', `${Math.round(S.wx.now.temp)}° ${getLang() === 'bm' ? w.bm : w.en}. ${t('tabWeather')}`);
  syncConds();
}
// The weather + air card hides itself when neither reading is available.
function syncConds() { $('#conds').hidden = $('#wx-btn').hidden && $('#aq-btn').hidden; }

// Air pollution index chip on the map: number in the level colour, "!" when the next 24 h look unhealthy.
const AQ_ALERT = 100; // above this (US AQI) the air is unhealthy for at least sensitive groups
function aqState(w = S.wx) {
  if (!w || w.aqi == null) return null;
  const peak = w.air?.peak;
  return { now: w.aqi, bad: w.aqi > AQ_ALERT, soon: w.aqi <= AQ_ALERT && peak && peak.aqi > AQ_ALERT ? peak : null };
}

function renderAqFab() {
  const b = $('#aq-btn'), st = aqState();
  if (!st) { b.hidden = true; syncConds(); return; }
  const aq = aqiLabel(st.now), lang = getLang();
  b.hidden = false;
  b.style.setProperty('--lvl', aq.color);
  b.classList.toggle('alarm', st.bad);
  b.innerHTML = `${icon('mask')}<b>${Math.round(st.now)}</b>${st.soon ? '<i class="aq-soon" aria-hidden="true">!</i>' : ''}`;
  b.setAttribute('aria-label', `${t('aqFab')} ${Math.round(st.now)}, ${lang === 'bm' ? aq.bm : aq.en}${st.soon ? `. ${t('aqSoon')}` : ''}`);
  b.title = `${t('aqFab')}: ${lang === 'bm' ? aq.bm : aq.en}`;
  syncConds();
}

// Early signal: one toast per day and level when the air is (or is about to be) unhealthy.
function aqEarlyWarning() {
  const st = aqState();
  if (!st || (!st.bad && !st.soon)) return;
  const lang = getLang();
  const n = Math.round(st.bad ? st.now : st.soon.aqi);
  const key = `navmap.aqWarned`, stamp = `${new Date().toDateString()}|${aqiLabel(n).level}|${st.bad ? 'now' : 'soon'}`;
  try { if (localStorage.getItem(key) === stamp) return; localStorage.setItem(key, stamp); } catch { /* private mode: warn anyway */ }
  const time = st.soon ? new Date(`${st.soon.time}:00+08:00`).toLocaleTimeString(lang === 'bm' ? 'ms-MY' : 'en-MY', { weekday: 'short', hour: 'numeric' }) : '';
  toast((st.bad ? t('aqToastNow') : t('aqToastSoon')).replace('{n}', n).replace('{time}', time));
}

function aqAdvice(w) {
  const st = aqState(w);
  if (!st || (!st.bad && !st.soon)) return '';
  const items = ['aqAdvMask', 'aqAdvLimit', 'aqAdvSensitive', 'aqAdvMeds', 'aqAdvPharm'].map((k) => `<li>${esc(t(k))}</li>`).join('');
  return `<div class="aq-adv ${st.bad ? '' : 'soon'}">
      <b>${icon('mask')}${t(st.bad ? 'aqAdvH' : 'aqAdvSoonH')}</b>
      <ul>${items}</ul>
      <button class="btn-ghost aq-pharm" data-action="aq-pharmacy">${icon('pharmacy')}${t('aqPharmBtn')}</button>
      <div class="aq-emerg">
        <p>${icon('phone')}<span>${esc(t('aqAdvEmerg'))}</span></p>
        <div class="aq-calls">
          <a class="btn-danger" href="tel:999">${icon('phone')}${t('aqCall')} 999</a>
          <a class="btn-ghost" href="tel:112">${icon('phone')}${t('aqCall')} 112</a>
        </div>
        <small>${t('aqCallNote')}</small>
      </div>
      <small>${t('aqAdvNote')}</small>
    </div>`;
}

function viewWeather() {
  const lang = getLang();
  const nearPins = S.reports
    .filter((r) => distKm(origin(), [r.lon, r.lat]) < 25)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const pinRows = nearPins.length ? `<ul class="list">${nearPins.slice(0, 30).map((r) => `<li><div class="row">
      <button class="pinrow" data-alert="${esc(r.id)}"><span class="ic ${r.severity === 'danger' ? 'danger' : r.severity === 'warning' ? 'warn' : 'info'}">${icon(r.icon)}</span>
      <span class="mid"><b>${esc(L(r, 'title'))}</b><small>${fmtDist(distKm(origin(), [r.lon, r.lat]))} · ${esc(fmtAgo(r.time, lang))} · ${esc(L(r, 'desc'))}</small><small class="pin-trust">${esc(pinTrust(r, lang))}</small></span></button>
      ${r.mine ? `<button class="btn-ghost sm" data-unpin="${esc(r.pinId)}">${t('unpin')}</button>` : ''}
    </div>${voteBtns(r)}</li>`).join('')}</ul>` : `<p class="muted">${t('noPins')}</p>`;
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
    ${aqAdvice(w)}
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
  if (S.tab === 'weather') render();
}

// ---------------------------------------------------------------- community pins
async function loadPins() {
  try { S.reports = await listPins(); } catch { /* keep old */ }
  rescanRoutes();
  drawAlerts(); renderBanner();
  if (S.tab === 'weather' || S.tab === 'alerts') render();
}

async function unpin(pinId) {
  popup?.remove();
  const ok = await removePin(pinId).catch(() => false);
  if (ok) { S.reports = S.reports.filter((r) => r.pinId !== pinId); rescanRoutes(); toast(t('unpinned')); }
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
  if (S.thread) return viewThread(lang, ref);
  if (S.alertMode === 'loading' && S.alertFilter !== 'report') return `${head}<div class="empty-state"><span class="spinner"></span></div>`;
  if (S.alertFilter === 'report') return `${head}${filters}${viewCommunity(lang, ref)}<p class="source">${t('sourceNote')}</p>`;
  const sample = S.alertMode === 'sample' ? `<div class="note">${icon('accident')}<span>${t('sample')}</span></div>` : '';
  const rows = list.length ? `<ul class="alist">${list.slice(0, 150).map((a) => alertCard(a, ref, lang)).join('')}</ul>` : `<div class="empty-state">${icon('weather')}${t('noAlerts')}</div>`;
  return `${head}${sample}${filters}${rows}<p class="source">${t('sourceNote')}</p>`;
}

// One alert as a card: severity + time, short title, one-line summary, state chips, valid-until,
// and the full official text folded behind "Show details".
function alertCard(a, ref, lang) {
  const d = a.lat != null ? distKm(ref, [a.lon, a.lat]) : null;
  const ic = a.kind === 'report' ? (a.icon || 'report') : a.kind;
  const sev = a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info';
  const sevLabel = t(a.severity === 'danger' ? 'sevDanger' : a.severity === 'warning' ? 'sevWarning' : 'sevInfo');
  const desc = L(a, 'desc') || '';
  const long = a.kind === 'weather' || desc.length > 140;
  const summary = long ? [alertSummary(desc), a.kind === 'weather' ? seaNumbers(desc, lang) : ''].filter(Boolean).join(' ') : [a.place, desc].filter(Boolean).join(' · ');
  const states = a.kind === 'weather' ? alertStates(desc) : [];
  const marine = a.kind === 'weather' && isMarine(desc);
  const MAXC = 4;
  const chips = [
    ...(marine ? [`<span class="tag sea">${icon('wind')}${t('seaAreas')}</span>`] : []),
    ...states.slice(0, MAXC).map((s) => `<span class="tag">${esc(s)}</span>`),
    ...(states.length > MAXC ? [`<span class="tag more">+${states.length - MAXC}</span>`] : []),
  ].join('');
  const until = a.validTo ? fmtUntil(a.validTo, lang) : '';
  const instr = L(a, 'instruction');
  const top = `<span class="acard-top"><span class="sev ${sev}">${sevLabel}</span><span class="ago">${esc(fmtAgo(a.time, lang))}</span></span>`;
  const main = `<span class="ic ${sev}">${icon(ic)}</span>
      <span class="mid">${top}<b>${esc(tidyTitle(L(a, 'title')))}</b>${summary ? `<span class="sum">${esc(summary)}</span>` : ''}</span>
      ${d != null ? `<span class="end"><b>${fmtDist(d)}</b></span>` : ''}`;
  const headEl = a.lat != null
    ? `<button class="acard-head" data-alert="${esc(a.id)}" aria-label="${t('showOnMap')}: ${esc(L(a, 'title'))}">${main}</button>`
    : `<div class="acard-head">${main}</div>`;
  const trust = a.kind === 'report' ? `<div class="acard-meta"><small class="pin-trust">${esc(pinTrust(a, lang))}</small>${voteBtns(a)}${talkBtn(a)}</div>` : '';
  const meta = (chips || until) ? `<div class="acard-meta">${chips ? `<div class="tags">${chips}</div>` : ''}${until ? `<span class="until">${icon('clock')}${t('until')} ${esc(until)}</span>` : ''}</div>` : '';
  const details = long ? `<details class="acard-more"><summary><span class="open">${t('showDetails')}</span><span class="shut">${t('hideDetails')}</span></summary>
      <div class="atext">${alertTextHtml(desc, esc)}${instr ? `<p class="instr">${esc(instr)}</p>` : ''}</div></details>` : '';
  return `<li class="acard ${sev}">${headEl}${meta}${trust}${details}<small class="asrc">${esc(a.source)}</small></li>`;
}

// ---------------------------------------------------------------- community conversation
// Every community pin has a short thread of updates: one-tap status tags ("Getting worse",
// "Road closed", "All clear") and a line of text. The Community filter in Alerts is a live feed
// ordered by the latest activity. Nicknames are anonymous; see src/lib/community.js and api/pins.js.
const canTalk = (a) => (a.kind === 'topic' || a.kind === 'report') && !!pinsMod.shared && !String(a.pinId).startsWith('l');
const findItem = (id) => S.reports.find((r) => r.pinId === id) || pinsMod.topics.find((x) => x.pinId === id);
function talkBtn(a) {
  if (!canTalk(a) || S.thread) return '';
  const n = a.comments || 0;
  return `<button type="button" class="talk" data-action="thread" data-pin="${esc(a.pinId)}">${icon('chat')}${n ? esc(updatesLabel(n)) : t('commJoin')}</button>`;
}
const updatesLabel = (n) => (n === 1 ? t('commUpdate1') : t('commUpdates').replace('{n}', n));
const tagLabel = (id) => { const x = TAG_BY_ID[id]; return x ? (getLang() === 'bm' ? x.bm : x.en) : ''; };
const tagChip = (id) => (TAG_BY_ID[id] ? `<span class="ctag ${TAG_BY_ID[id].tone}">${esc(tagLabel(id))}</span>` : '');
const handleHue = (h) => [...String(h)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (h) => `<span class="av" style="--h:${handleHue(h)}" aria-hidden="true">${esc(String(h || '?')[0])}</span>`;
const pinTitle = (a) => (a.type === 'ask' && a.note ? `“${a.note}”` : L(a, 'title'));

function viewCommunity(lang, ref) {
  const list = [...S.reports.filter((a) => a.kind === 'report'), ...pinsMod.topics]
    .sort((x, y) => new Date(y.lastActivityAt || y.time) - new Date(x.lastActivityAt || x.time));
  const live = pinsMod.shared ? `<span class="live-dot">${t('commLive')}</span>` : `<span class="live-dot off">${t('deviceOnly')}</span>`;
  const top = `<div class="comm-top"><div><h3>${t('commTitle')}</h3><p class="muted">${t('commLead')}</p></div>${live}</div>
    ${accountLine()}
    <div class="comm-cta"><button class="btn" data-action="comm-post">${icon('pin')}${t('commPost')}</button><button class="btn-ghost" data-action="comm-ask">${icon('chat')}${t('commAsk')}</button></div>`;
  if (!list.length) return `${top}<div class="empty-state">${icon('users')}${t('commEmpty')}</div>`;
  return `${top}<ul class="alist">${list.slice(0, 100).map((a) => commCard(a, ref, lang)).join('')}</ul>`;
}

function accountLine() {
  const u = auth.user();
  if (u) return `<div class="acct">${icon('user')}<span>${t('postingAs').replace('{n}', `<b>${esc(auth.displayName(u) || t('commMember'))}</b>`)} ${pinsMod.me?.admin ? `<span class="cm-badge admin">${t('commAdmin')}</span>` : `<span class="cm-badge mem">${t('commMember')}</span>`}</span><button class="link" data-action="account">${t('accountLink')}</button></div>`;
  return `<div class="acct">${icon('user')}<span>${t('postingAnon')}</span>${auth.available() ? `<button class="link" data-action="join">${t('signInLink')}</button>` : ''}</div>`;
}

function topicCard(a, lang) {
  const last = a.last;
  return `<li class="acard ccard info topic">
    <button class="acard-head" data-action="thread" data-pin="${esc(a.pinId)}">
      <span class="ic info">${icon('news')}</span>
      <span class="mid"><span class="acard-top"><span class="ago">${esc(a.source)} · ${t('discussStarted').replace('{t}', esc(fmtAgo(a.time, lang)))}</span></span>
        <b>${esc(a.title)}</b>
        ${last ? `<span class="last">${avatar(last.handle)}<span><b>${esc(last.handle)}</b> ${tagChip(last.tag)} ${esc(last.text || '')}<small> · ${esc(fmtAgo(last.at, lang))}</small></span></span>` : `<span class="last none">${t('commNone')}</span>`}</span>
    </button>
    <div class="acard-meta"><small class="pin-trust">${t('discussTitle')}</small><button type="button" class="talk" data-action="thread" data-pin="${esc(a.pinId)}">${icon('chat')}${a.comments ? esc(updatesLabel(a.comments)) : t('commJoin')}</button></div>
  </li>`;
}

function commCard(a, ref, lang) {
  if (a.kind === 'topic') return topicCard(a, lang);
  const sev = a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info';
  const d = a.lat != null ? distKm(ref, [a.lon, a.lat]) : null;
  const last = a.last;
  const lastLine = last
    ? `<span class="last">${avatar(last.handle)}<span><b>${esc(last.handle)}</b> ${tagChip(last.tag)} ${esc(last.text || '')}<small> · ${esc(fmtAgo(last.at, lang))}</small></span></span>`
    : `<span class="last none">${t('commNone')}</span>`;
  const sub = a.type === 'ask' ? L(a, 'title') : (a.note ? a.note : '');
  return `<li class="acard ccard ${sev}">
    <button class="acard-head" data-action="thread" data-pin="${esc(a.pinId)}">
      <span class="ic ${sev}">${icon(a.icon || 'report')}</span>
      <span class="mid"><span class="acard-top"><span class="ago">${t('commPinnedBy').replace('{t}', esc(fmtAgo(a.time, lang)))}</span>${d != null ? `<span class="ago"><b>${fmtDist(d)}</b></span>` : ''}</span>
        <b>${esc(pinTitle(a))}</b>${sub ? `<span class="sum">${esc(sub)}</span>` : ''}${lastLine}</span>
    </button>
    <div class="acard-meta"><small class="pin-trust">${esc(pinTrust(a, lang))}</small>${canTalk(a) ? `<button type="button" class="talk" data-action="thread" data-pin="${esc(a.pinId)}">${icon('chat')}${a.comments ? esc(updatesLabel(a.comments)) : t('commJoin')}</button>` : ''}</div>
  </li>`;
}

function viewThread(lang, ref) {
  const th = S.thread;
  const a = findItem(th.pinId) || th.alert;
  const isTopic = a?.kind === 'topic';
  const back = `<div class="th-head"><button class="link back" data-action="thread-back">${icon('back')}${t('commBack')}</button><span class="live-dot">${t('commLive')}</span></div>`;
  if (!a || th.status === 'gone') return `${back}<div class="empty-state">${icon('clock')}${t('commGone')}</div>`;
  const card = isTopic
    ? `<ul class="alist"><li class="acard info topic"><div class="acard-head"><span class="ic info">${icon('news')}</span><span class="mid"><span class="acard-top"><span class="ago">${esc(a.source)} · ${esc(fmtAgo(a.time, lang))}</span></span><b>${esc(a.title)}</b>
        <a class="read-link" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${icon('share')}${t('discussRead')}</a></span></div></li></ul>`
    : `<ul class="alist">${alertCard({ ...a, title: pinTitle(a), title_bm: pinTitle(a), ...(a.note && a.type !== 'ask' ? { desc: a.note, desc_bm: a.note } : {}) }, ref, lang)}</ul>`;
  const tags = (isTopic ? DISCUSS_TAGS : TAGS).map((x) => `<button type="button" class="ctag-btn ${x.tone}" data-action="cm-tag" data-tag="${x.id}" aria-pressed="${th.tag === x.id}">${esc(lang === 'bm' ? x.bm : x.en)}</button>`).join('');
  const len = (th.draft || '').length;
  const composer = `<form id="cm-form" class="composer" autocomplete="off">
      <span class="cm-label">${t('commTagHint')}</span>
      <div class="cm-tags" role="group" aria-label="${t('commTagHint')}">${tags}</div>
      <textarea id="cm-text" rows="2" maxlength="${MAX_TEXT}" placeholder="${esc(t(isTopic ? 'discussPh' : 'commPlaceholder'))}" aria-label="${esc(t(isTopic ? 'discussPh' : 'commPlaceholder'))}">${esc(th.draft || '')}</textarea>
      <div class="cm-row"><small class="cm-rules">${auth.user() ? t('commRulesMember').replace('{n}', esc(auth.displayName() || t('commMember'))) : t('commRules')}</small><span class="cm-count" id="cm-count">${len}/${MAX_TEXT}</span>
      <button class="btn sm" type="submit"${th.sending ? ' disabled' : ''}>${th.sending ? '<span class="spinner"></span>' : icon('nav')}${t('commSend')}</button></div>
    </form>`;
  const adminBar = pinsMod.me?.admin ? `<div class="admin-bar">${icon('shield')}<span>${t('adminTools')}</span><button type="button" class="btn-ghost sm" data-action="admin-remove">${t(isTopic ? 'adminRemoveTopic' : 'adminRemovePin')}</button></div>` : '';
  return `${back}${card}${adminBar}${accountLine()}${composer}<div id="thread-list">${threadList(lang)}</div>`;
}

function threadList(lang) {
  const th = S.thread;
  if (th.status === 'loading' && !th.comments) return `<div class="empty-state"><span class="spinner"></span>${t('commLoading')}</div>`;
  if (th.status === 'error' && !th.comments) return `<div class="empty-state">${t('commNeedsShared')}<button class="btn-ghost" data-action="thread-retry">${t('retry')}</button></div>`;
  const list = [...(th.comments || [])].reverse(); // newest first: the latest news matters most
  if (!list.length) return `<p class="muted cm-none">${t('commNone')}</p>`;
  return `<h3 class="cm-h">${esc(updatesLabel(list.length))}</h3><ul class="clist">${list.map((c) => `<li class="cm">
      ${avatar(c.handle)}
      <div class="cm-body">
        <div class="cm-top"><b>${esc(c.handle)}</b>${c.admin ? `<span class="cm-badge admin">${t('commAdmin')}</span>` : c.member ? `<span class="cm-badge mem">${t('commMember')}</span>` : ''}${c.byPinner ? `<span class="cm-badge">${t('commPinner')}</span>` : ''}${c.mine ? `<span class="cm-badge you">${t('commYou')}</span>` : ''}<small>${esc(fmtAgo(c.at, lang))}</small></div>
        ${c.tag ? tagChip(c.tag) : ''}${c.text ? `<p>${esc(c.text)}</p>` : ''}
        <div class="cm-acts">
          ${c.mine ? (c.helpful ? `<span class="cm-help-n">${icon('heart')}${c.helpful}</span>` : '')
            : `<button type="button" data-action="cm-helpful" data-cid="${esc(c.id)}" aria-pressed="${!!c.helpedByMe}">${icon('heart')}${t('commHelpful')}${c.helpful ? ` ${c.helpful}` : ''}</button>`}
          ${c.mine ? `<button type="button" data-action="cm-del" data-cid="${esc(c.id)}">${t('commDelete')}</button>`
            : `<button type="button" class="quiet" data-action="cm-flag" data-cid="${esc(c.id)}">${t('commReport')}</button>${pinsMod.me?.admin ? `<button type="button" class="admin" data-action="cm-del" data-cid="${esc(c.id)}">${t('adminRemove')}</button>` : ''}`}
        </div>
      </div></li>`).join('')}</ul>`;
}

function openThread(pinId) {
  popup?.remove();
  const a = findItem(pinId);
  S.thread = { pinId, status: 'loading', comments: null, tag: null, draft: '', alert: a };
  if (S.tab !== 'alerts') { openSheet(); setTab('alerts'); } else render();
  if (sheetState !== 'full') setSheet('full');
  $('#sheet-body').scrollTop = 0;
  if (a?.lat != null) map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 14), padding: mapPadding() });
  loadThread();
}

async function loadThread() {
  const th = S.thread;
  if (!th) return;
  try {
    const out = await getThread(th.pinId);
    if (S.thread !== th) return;
    th.comments = out.comments; th.status = 'ok'; th.alert = out.alert;
    if (out.alert.kind !== 'topic') S.reports = S.reports.map((r) => (r.pinId === th.pinId ? out.alert : r));
  } catch (err) {
    if (S.thread !== th) return;
    th.status = err.message === 'gone' ? 'gone' : 'error';
    if (th.status === 'gone') { S.reports = S.reports.filter((r) => r.pinId !== th.pinId); drawAlerts(); }
  }
  if (S.tab === 'alerts') {
    // only the list changes on a refresh, so someone typing is not disturbed
    const box = $('#thread-list');
    if (box && th.status !== 'gone') box.innerHTML = threadList(getLang()); else render();
  }
}
setInterval(() => { if (S.thread && S.tab === 'alerts' && document.visibilityState === 'visible') loadThread(); }, 15e3);

async function sendComment() {
  const th = S.thread;
  if (!th || th.sending) return;
  const text = ($('#cm-text')?.value || '').trim();
  if (!text && !th.tag) { toast(t('commEmptyErr')); $('#cm-text')?.focus(); return; }
  th.sending = true; th.draft = text; render();
  try {
    const out = await postComment(th.pinId, { text, tag: th.tag });
    if (out.removed) {
      S.reports = S.reports.filter((r) => r.pinId !== th.pinId);
      S.thread = null; toast(t('commCleared'));
      drawAlerts(); renderBanner(); rescanRoutes(); render();
      return;
    }
    th.draft = ''; th.tag = null;
    if (out.alert && out.alert.kind !== 'topic') S.reports = S.reports.map((r) => (r.pinId === th.pinId ? out.alert : r));
    if (out.comment) th.comments = [...(th.comments || []), out.comment];
    toast(t('commPosted'));
    drawAlerts();
  } catch (err) {
    const m = { rate: 'commRate', slow: 'commSlow', link: 'commLink', phone: 'commPhone', long: 'commLong', empty: 'commEmptyErr', gone: 'commGone' }[err.message];
    toast(t(m || 'commFailed'));
    if (err.message === 'gone') th.status = 'gone';
  }
  th.sending = false;
  if (S.thread === th) render();
}

async function onCommentAction(act, cid) {
  const th = S.thread;
  if (!th) return;
  const c = (th.comments || []).find((x) => x.id === cid);
  try {
    if (act === 'cm-helpful') {
      const d = await reactComment(th.pinId, cid, 'helpful');
      if (d.comment && c) Object.assign(c, { helpful: d.comment.helpful, helpedByMe: d.comment.helpedByMe });
    } else if (act === 'cm-flag') {
      if (!confirm(t('commReportQ'))) return;
      const d = await reactComment(th.pinId, cid, 'flag');
      if (d.hidden) th.comments = th.comments.filter((x) => x.id !== cid);
      toast(t('commReported'));
    } else if (act === 'cm-del') {
      await deleteComment(th.pinId, cid);
      th.comments = th.comments.filter((x) => x.id !== cid);
      toast(t('commDeleted'));
    }
  } catch (err) {
    toast(t(err.message === 'rate' ? 'commRate' : 'commFailed'));
  }
  const box = $('#thread-list');
  if (box) box.innerHTML = threadList(getLang());
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'cm-form') return;
  e.preventDefault();
  sendComment();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'cm-text' || !S.thread) return;
  S.thread.draft = e.target.value;
  const n = $('#cm-count');
  if (n) n.textContent = `${e.target.value.length}/${MAX_TEXT}`;
});
document.addEventListener('keydown', (e) => {
  // Enter posts, Shift+Enter adds a new line
  if (e.target.id === 'cm-text' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComment(); }
});


// ---------------------------------------------------------------- community membership
// Before someone first enters Community we ask once: register (Google or email) or stay anonymous.
// Members post with their display name and a Member badge; see src/lib/auth.js (Supabase Auth).
let newsShown = [];
let joinNext = null;                 // what to do after the join screen (open Community, a thread, ...)
const joinDlg = $('#join-dlg');

async function gate(next) {
  auth.init();
  if (auth.choice() || auth.user()) { next(); return; }
  await auth.init();
  if (!auth.available()) { auth.setChoice('anon'); next(); return; } // nothing to sign in with yet
  joinNext = next;
  openJoin('start');
}
function finishJoin(kind) {
  auth.setChoice(kind);
  if (joinDlg.open) joinDlg.close();
  const n = joinNext; joinNext = null;
  if (n) n(); else render();
}
joinDlg.addEventListener('close', () => { joinNext = null; });

async function openJoin(mode, note = '') {
  await auth.init();
  $('#join-body').innerHTML = joinView(mode, note);
  if (!joinDlg.open) joinDlg.showModal();
  $('#join-body input')?.focus();
}

function joinView(mode, note) {
  const close = `<button type="button" class="icon-btn join-x" data-join="close" aria-label="${t('close')}">${icon('close')}</button>`;
  const backBtn = `<button type="button" class="btn-ghost" data-join="start">${t('authBack')}</button>`;
  const msg = note ? `<p class="join-msg">${esc(note)}</p>` : '';
  const field = (id, type, label, extra = '') => `<label class="join-field"><span>${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
  if (mode === 'start') {
    if (!auth.available()) return `${close}<h2 id="join-title">${t('joinTitle')}</h2><p class="muted">${t('joinOff')}</p><button class="btn" data-join="anon">${t('joinAnon')}</button>`;
    return `${close}<h2 id="join-title">${t('joinTitle')}</h2><p class="muted">${t('joinLead')}</p>${msg}
      <div class="join-btns">
        <button type="button" class="btn google" data-join="google"><span class="g">G</span>${t('joinGoogle')}</button>
        <button type="button" class="btn-ghost" data-join="register">${icon('mail')}${t('joinEmail')}</button>
        <button type="button" class="link" data-join="signin">${t('joinSignIn')}</button>
      </div>
      <div class="join-or"><span>${t('authOr')}</span></div>
      <button type="button" class="btn-ghost anon" data-join="anon">${icon('users')}${t('joinAnon')}</button>
      <p class="join-note">${t('joinAnonNote')}</p>`;
  }
  if (mode === 'register') return `${close}<h2 id="join-title">${t('joinEmail')}</h2>${msg}
    <form class="join-form" data-form="register">
      ${field('j-name', 'text', t('authName'), 'maxlength="24" autocomplete="nickname" required')}<small class="join-hint">${t('authNameHint')}</small>
      ${field('j-email', 'email', t('authEmail'), 'autocomplete="email" required')}
      ${field('j-pw', 'password', t('authPassword'), 'minlength="8" autocomplete="new-password" required')}
      <p class="join-note">${t('authConsent')}</p>
      <div class="join-row">${backBtn}<button class="btn" type="submit">${t('authRegister')}</button></div>
    </form>`;
  if (mode === 'signin') return `${close}<h2 id="join-title">${t('authSignIn')}</h2>${msg}
    <form class="join-form" data-form="signin">
      ${field('j-email', 'email', t('authEmail'), 'autocomplete="email" required')}
      ${field('j-pw', 'password', t('authPassword'), 'autocomplete="current-password" required')}
      <button type="button" class="link" data-join="forgot">${t('authForgot')}</button>
      <div class="join-row">${backBtn}<button class="btn" type="submit">${t('authSignIn')}</button></div>
    </form>`;
  if (mode === 'forgot') return `${close}<h2 id="join-title">${t('authForgot')}</h2><p class="muted">${t('authForgotLead')}</p>${msg}
    <form class="join-form" data-form="forgot">
      ${field('j-email', 'email', t('authEmail'), 'autocomplete="email" required')}
      <div class="join-row"><button type="button" class="btn-ghost" data-join="signin">${t('authBack')}</button><button class="btn" type="submit">${t('authSendLink')}</button></div>
    </form>`;
  if (mode === 'newpw') return `${close}<h2 id="join-title">${t('authNewPw')}</h2>${msg}
    <form class="join-form" data-form="newpw">
      ${field('j-pw', 'password', t('authPassword'), 'minlength="8" autocomplete="new-password" required')}
      <div class="join-row"><button class="btn" type="submit">${t('authNewPwBtn')}</button></div>
    </form>`;
  if (mode === 'account') {
    const u = auth.user();
    if (!u) return joinView('start', note);
    return `${close}<h2 id="join-title">${t('authAccount')}</h2><p class="muted">${esc(u.email || '')}</p>${msg}
    <form class="join-form" data-form="rename">
      ${field('j-name', 'text', t('authName'), `maxlength="24" value="${esc(auth.displayName(u))}" required`)}<small class="join-hint">${t('authNameHint')}</small>
      <div class="join-row"><button type="button" class="btn-ghost" data-join="signout">${t('authSignOut')}</button><button class="btn" type="submit">${t('authSave')}</button></div>
    </form>`;
  }
  // 'sent' | 'confirm': a message and OK
  return `${close}<h2 id="join-title">${t('joinTitle')}</h2><p class="join-msg ok">${esc(note)}</p><button class="btn" data-join="close">OK</button>`;
}

const authErr = (e) => t('authFailed').replace('{e}', e?.message || '');
$('#join-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-join]');
  if (!b) return;
  const j = b.dataset.join;
  if (j === 'close') { joinDlg.close(); return; }
  if (j === 'anon') { finishJoin('anon'); return; }
  if (j === 'google') {
    auth.setChoice('member'); // we come back to the page after Google
    try { await auth.google(); } catch (err) { auth.setChoice(''); openJoin('start', authErr(err)); }
    return;
  }
  if (j === 'signout') { await auth.signOut(); joinDlg.close(); toast(t('authSignedOut')); loadPins(); render(); return; }
  openJoin(j);
});
$('#join-body').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.dataset.form;
  const v = (id) => ($(`#${id}`)?.value || '').trim();
  const btn = e.target.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f === 'register') {
      const name = cleanName(v('j-name'));
      if (!name) { openJoin('register', t('authBadName')); return; }
      if (v('j-pw').length < 8) { openJoin('register', t('authPwShort')); return; }
      const out = await auth.register(v('j-email'), $('#j-pw').value, name);
      if (out === 'signed-in') { toast(t('authSignedIn').replace('{n}', name)); finishJoin('member'); loadPins(); }
      else {
        // they can read and post anonymously until they confirm the email
        auth.setChoice('member');
        const n = joinNext; joinNext = null;
        if (n) n();
        openJoin('confirm', t('authConfirm'));
      }
    } else if (f === 'signin') {
      await auth.signIn(v('j-email'), $('#j-pw').value);
      toast(t('authSignedIn').replace('{n}', auth.displayName() || t('commMember')));
      finishJoin('member'); loadPins();
    } else if (f === 'forgot') {
      await auth.forgot(v('j-email'));
      openJoin('sent', t('authLinkSent'));
    } else if (f === 'newpw') {
      if ($('#j-pw').value.length < 8) { openJoin('newpw', t('authPwShort')); return; }
      await auth.newPassword($('#j-pw').value);
      joinDlg.close(); toast(t('authPwSaved'));
    } else if (f === 'rename') {
      const name = cleanName(v('j-name'));
      if (!name) { openJoin('account', t('authBadName')); return; }
      await auth.rename(name);
      joinDlg.close(); toast(t('authSaved')); render();
    }
  } catch (err) {
    openJoin(f === 'rename' ? 'account' : f, authErr(err));
  } finally { if (btn) btn.disabled = false; }
});
auth.onChange((u, evt) => {
  if (evt === 'PASSWORD_RECOVERY') { openJoin('newpw'); return; }
  if ((evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION') && u && /[?&#](code|access_token)=/.test(location.href)) {
    // back from Google or an email link: tidy the address bar and welcome them
    history.replaceState(null, '', location.pathname);
    auth.setChoice('member');
    toast(t('authSignedIn').replace('{n}', auth.displayName(u) || t('commMember')));
  }
  if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT' || (evt === 'INITIAL_SESSION' && u)) loadPins();
  if (u?.email_confirmed_at && (evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION')) requestWelcome(u.id); // once per member
  if (S.tab === 'alerts' || S.tab === 'news') render();
});

async function adminRemove(id) {
  if (!confirm(t('adminRemoveQ'))) return;
  const ok = await removePin(id).catch(() => false);
  if (!ok) { toast(t('commFailed')); return; }
  S.reports = S.reports.filter((r) => r.pinId !== id);
  S.thread = null;
  toast(t('adminRemoved'));
  await loadPins();
  drawAlerts(); renderBanner(); render();
}

async function discussNews(n) {
  try {
    const tp = await shareNews(n);
    openThread(tp.pinId);
  } catch (err) {
    toast(t(err.message === 'rate' ? 'commRate' : 'discussFailed'));
  }
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
afterMap(() => loadNews(), 1500);

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
afterMap(loadStats, 1000);
setInterval(() => { if (!document.hidden) loadStats(); }, 10 * 60e3);

// Headline ticker in the banner slot when no alert is shown: rotates the most relevant fresh stories, tap to read.
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
  const show = items.length && S.tab !== 'news' && !newsBarHidden() && $('#banner').hidden;
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
  newsShown = list;
  const rows = list.length ? `<ul class="news-list">${list.map((n, i) => `<li><a class="news-row" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
      <span class="mid">
        <span class="news-tag t-${esc(n.topic)}">${icon(NEWS_ICON[n.topic] || 'leaf')}${t(`topic_${n.topic}`)}${n.region === 'my' ? ' · Malaysia' : ''}</span>
        <b>${esc(n.title)}</b>
        ${n.summary ? `<small class="sum">${esc(n.summary)}</small>` : ''}
        <small>${esc(n.source)}${n.time ? ` · ${esc(fmtAgo(n.time, lang))}` : ''}</small>
      </span>
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    </a>${pinsMod.shared ? `<button type="button" class="discuss" data-action="discuss" data-i="${i}">${icon('chat')}${t('discuss')}</button>` : ''}</li>`).join('')}</ul>` : `<div class="empty-state">${icon('leaf')}${t('newsNone')}</div>`;
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

async function savedAction(act, k) {
  if (act === 'saved-go' && S.saved[k]) { const p = savedPlace(k); routeTo({ id: p.id, name: S.saved[k].name ? `${savedLabel(k)} · ${S.saved[k].name}` : savedLabel(k), lat: p.lat, lon: p.lon }); return; }
  if (act === 'saved-set') { S.saveMode = S.saveMode === k ? null : k; render(); return; }
  if (act === 'saved-cancel') { S.saveMode = null; render(); return; }
  if (act === 'saved-remove') { S.saved = setSaved(k, null); S.saveMode = null; drawSaved(); render(); toast(tk('removedToast', k)); return; }
  if (act === 'saved-search') { toast(tk('saveSearchHint', k)); q.focus(); return; }
  if (act === 'saved-loc') {
    const me = S.me || await locate({ fly: false });
    if (!me) { toast(t('saveNoLoc')); return; }
    const area = await placeName(me[1], me[0]).catch(() => '');
    S.saved = setSaved(k, { name: area ? `${t('myLocation')}, ${area}` : `${t('myLocation')} (${me[1].toFixed(4)}, ${me[0].toFixed(4)})`, lat: me[1], lon: me[0] });
    S.saveMode = null; drawSaved(); render(); toast(tk('savedToast', k));
    return;
  }
  if (act === 'save-place' && S.selected) {
    const p = S.selected;
    S.saved = setSaved(k, { name: p.name, lat: p.lat, lon: p.lon });
    S.saveMode = null; drawSaved(); render(); toast(tk('savedToast', k));
  }
}
mapReady.then(drawSaved);

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const up = e.target.closest('[data-unpin]');
  if (up) { e.stopPropagation(); unpin(up.dataset.unpin); return; }
  const vb = e.target.closest('[data-vote]');
  if (vb) { e.stopPropagation(); if (vb.getAttribute('aria-pressed') !== 'true') onVote(vb.dataset.pin, vb.dataset.vote); return; }
  const el = e.target.closest('[data-news-region],[data-news-topic],[data-cat],[data-place],[data-action],[data-route],[data-filter],[data-alert],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) { setTab(el.dataset.tab); return; }
  if (el.dataset.cat) { loadPlaces(S.cat === el.dataset.cat && S.tab === 'explore' ? null : el.dataset.cat); return; }
  if (el.dataset.newsRegion) { S.newsRegion = el.dataset.newsRegion; render(); return; }
  if (el.dataset.newsTopic) { S.newsTopic = el.dataset.newsTopic; render(); return; }
  if (el.dataset.filter) {
    const f = el.dataset.filter;
    const go = () => { S.alertFilter = f; S.thread = null; render(); };
    if (f === 'report') gate(go); else go();
    return;
  }
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
  if (act && act.startsWith('save')) { savedAction(act, el.dataset.kind); return; }
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
  if (act === 'pt-saved' && S.saved[el.dataset.kind]) { const k = el.dataset.kind, v = S.saved[k]; setPoint(S.ptEdit, { id: `saved-${k}`, name: v.name ? `${savedLabel(k)} · ${v.name}` : savedLabel(k), lat: v.lat, lon: v.lon }); }
  if (act === 'pt-result') { const r = ptResults[Number(el.dataset.i)]; if (r) setPoint(S.ptEdit, toPoint(r)); }
  if (act === 'pt-swap') swapPoints();
  if (act === 'pt-reset-start') { S.start = null; computeRoute(); }
  if (act === 'start-nav') startNav();
  if (act === 'mode') setMode(el.dataset.mode);
  if (act === 'tolls') setAvoidTolls(el.dataset.v === 'avoid');
  if (act === 'recentre') recentre();
  if (act === 'ride') bookRide(el.dataset.app);
  if (act === 'leave-now') { S.leaveAt = ''; if (S.dest) computeRoute(); }
  if (act === 'pin-weather') openPinDialog();
  if (act === 'thread') { const id = el.dataset.pin; gate(() => openThread(id)); return; }
  if (act === 'discuss') { const n = newsShown[Number(el.dataset.i)]; if (n) gate(() => discussNews(n)); return; }
  if (act === 'join') { openJoin('start'); return; }
  if (act === 'admin-remove' && S.thread) { adminRemove(S.thread.pinId); return; }
  if (act === 'account') { openJoin('account'); return; }
  if (act === 'thread-back') { S.thread = null; S.alertFilter = 'report'; render(); return; }
  if (act === 'thread-retry' && S.thread) { S.thread.status = 'loading'; render(); loadThread(); }
  if (act === 'cm-tag' && S.thread) {
    S.thread.tag = S.thread.tag === el.dataset.tag ? null : el.dataset.tag;
    S.thread.draft = $('#cm-text')?.value ?? S.thread.draft;
    document.querySelectorAll('.ctag-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tag === S.thread.tag)));
    return;
  }
  if (act === 'cm-helpful' || act === 'cm-flag' || act === 'cm-del') { onCommentAction(act, el.dataset.cid); return; }
  if (act === 'comm-post') openPinDialog();
  if (act === 'comm-ask') openPinDialog('ask');
  if (act === 'radar') toggleRadar();
  if (act === 'wx-retry') loadWeather(true);
  if (act === 'news-retry') loadNews(true);
  if (act === 'subscribe') openSubscribe();
  if (act === 'aq-pharmacy') loadPlaces('pharmacy');
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

map.on('dragstart', (e) => {
  if (S.nav && e.originalEvent) { S.nav.follow = false; recentreBtn().hidden = false; return; }
  if (isMobile() && !S.nav) setSheet('peek');
});
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
  if (voiceOn() && S.nav) say((p) => p.step(S.routes[S.routeIdx].steps[S.nav.step]));
});
$('#lang-btn').addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'bm' : 'en');
  $('#lang-btn').textContent = getLang() === 'en' ? 'BM' : 'EN';
  renderChips(); renderBanner(); render(); renderReportGrid(); renderWxFab(); renderAqFab(); renderScore();
  if (S.nav) updateHud();
});
// ---------------------------------------------------------------- map layers menu
// Base map: the OpenFreeMap street map, or the Play view. (Satellite was removed on
// 1 Nov 2026 at the owner's request; a saved "satellite" choice falls back to the map.)
const BASEMAPS = ['map', 'play'];
const getBasemap = () => { try { const v = localStorage.getItem('navmap.basemap'); return BASEMAPS.includes(v) ? v : 'map'; } catch { return 'map'; } };
const isPlay = () => document.documentElement.dataset.basemap === 'play';
async function setBasemap(kind) {
  if (!BASEMAPS.includes(kind)) kind = 'map';
  try { localStorage.setItem('navmap.basemap', kind); } catch { /* private mode */ }
  document.querySelectorAll('[data-basemap]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.basemap === kind)));
  const wasPlay = isPlay();
  document.documentElement.dataset.basemap = kind;
  renderScore();
  await mapReady;
  const play = kind === 'play';
  if (!play) applyPlay(map, false);
  if (play) {
    applyPlay(map, true);
    if (!S.nav) map.easeTo({ pitch: PLAY_PITCH, zoom: Math.max(map.getZoom(), 16), duration: 900 });
    const r = award('explore');
    if (r.badges.length) celebrate(r);
  } else if (wasPlay && !S.nav) map.easeTo({ pitch: 0, duration: 600 });
}
try { if (localStorage.getItem('navmap.basemap') === 'satellite') localStorage.setItem('navmap.basemap', 'map'); } catch { /* private mode */ }
if (getBasemap() !== 'map') setBasemap(getBasemap());

// ---------------------------------------------------------------- Play view: points and badges
function renderScore() {
  const chip = $('#score-chip');
  if (!chip) return;
  chip.hidden = !isPlay();
  const s = getScore();
  chip.innerHTML = `<span class="sc-lvl">${esc(t('playLevel'))} ${levelOf(s.pts)}</span><span class="sc-pts">⭐ ${s.pts}</span>`;
  chip.setAttribute('aria-label', `${t('playLevel')} ${levelOf(s.pts)}, ${s.pts} ${t('playPoints')}`);
}
function celebrate({ gained, badges }) {
  renderScore();
  const bm = getLang() === 'bm';
  const parts = [];
  if (gained) parts.push(`+${gained} ${t('playPoints')}`);
  for (const b of badges) parts.push(`${b.icon} ${t('playBadge')}: ${bm ? b.bm : b.en}`);
  if (parts.length) toast(parts.join(' · '));
  if (gained && isPlay()) {
    const chip = $('#score-chip');
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
  }
}
function renderScoreDialog() {
  const s = getScore();
  const bm = getLang() === 'bm';
  const lvl = levelOf(s.pts);
  const into = s.pts % LEVEL_PTS;
  $('#score-body').innerHTML = `
    <p class="sc-big"><b>${esc(t('playLevel'))} ${lvl}</b> · ⭐ ${s.pts} ${esc(t('playPoints'))}</p>
    <div class="sc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${LEVEL_PTS}" aria-valuenow="${into}"><span style="width:${(into / LEVEL_PTS) * 100}%"></span></div>
    <p class="muted">${esc(t('playNext').replace('{n}', LEVEL_PTS - into))}</p>
    <ul class="sc-badges">${BADGES.map((b) => {
      const got = s.badges.includes(b.id);
      return `<li class="${got ? 'got' : ''}"><span class="sc-ic" aria-hidden="true">${got ? b.icon : '🔒'}</span><span><b>${esc(bm ? b.bm : b.en)}</b><small>${esc(bm ? b.bmHint : b.enHint)}</small></span></li>`;
    }).join('')}</ul>
    <p class="muted sc-how">${esc(t('playHow'))}</p>`;
}
$('#score-chip').addEventListener('click', () => { renderScoreDialog(); $('#score-dlg').showModal(); });
$('#score-close').addEventListener('click', () => $('#score-dlg').close());

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
    `<button type="button" data-report="${r.id}" class="sev-${r.sev}${r.id === 'ask' ? ' ask' : ''}">${icon(r.icon)}${esc(r.id === 'ask' ? t('commAsk') : getLang() === 'bm' ? r.bm : r.en)}</button>`).join('');
}
function openPinDialog(focus) {
  renderReportGrid();
  const note = $('#report-note');
  note.value = ''; note.placeholder = t(focus === 'ask' ? 'commPlaceholder' : 'reportNotePh');
  dlg.showModal();
  if (focus === 'ask') note.focus();
}
$('#report-btn').addEventListener('click', () => openPinDialog());
$('#report-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // Enter must not close the dialog
$('#report-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-report]');
  if (!b) return;
  // pin where the person is if they're looking near themselves, otherwise at the map centre
  const c = S.me && distKm(S.me, center()) < 1 ? S.me : center();
  const note = $('#report-note').value.trim();
  if (b.dataset.report === 'ask' && !note) { toast(t('askNeedsNote')); $('#report-note').focus(); return; }
  dlg.close();
  try {
    const r = await addPin(b.dataset.report, c[1], c[0], note);
    S.reports = [...S.reports.filter((x) => x.id !== r.id), r];
    rescanRoutes();
    drawAlerts(); renderBanner(); render();
    toast(r.merged ? t('pinMerged') : pinsMod.shared ? t('pinnedShared') : t('pinnedLocal'));
    if (r.type === 'ask' && canTalk(r)) openThread(r.pinId);
    const g = award('pin');
    if (isPlay() || g.badges.length) setTimeout(() => celebrate(g), 2400);
  } catch (err) {
    const m = { rate: 'pinRate', link: 'commLink', phone: 'commPhone', long: 'commLong', empty: 'askNeedsNote' }[err.message];
    toast(t(m || 'pinFailed'));
  }
});
$('#wx-btn').addEventListener('click', () => { openSheet(); setTab('weather'); });
$('#aq-btn').addEventListener('click', () => {
  openSheet(); setTab('weather');
  setTimeout(() => $('#poll')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320);
});

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
    <section class="sos-group"><h3>${icon('pin')}${t('sosNearest')}</h3>
      <div class="sos-near">${['hospital', 'police', 'fire', 'shelter'].map((c) => `<button class="btn-ghost" data-sos-cat="${c}">${icon(c)}${esc(CATEGORIES[c].short[lang])}</button>`).join('')}</div>
    </section>
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
  const near = e.target.closest('[data-sos-cat]');
  if (near) { sosDlg.close(); openSheet(); loadPlaces(near.dataset.sosCat); }
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
loadPins();
setInterval(() => { if (document.visibilityState === 'visible') loadPins(); }, (slowNet() ? 90 : 30) * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadPins(); loadWeather(); } });
setTimeout(() => loadWeather(), 1200);

// deep link: ?cat=ev
const urlCat = new URLSearchParams(location.search).get('cat');
if (urlCat && CATEGORIES[urlCat]) mapReady.then(() => loadPlaces(urlCat));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
