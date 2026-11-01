// NAVMAP service worker: makes the app open fast on weak signal and keep working offline.
//
// What is cached, and how:
//  - App files (HTML, JS, CSS, icons): precached at install. Built files have a hash in their
//    name, so they are served straight from the cache. The page itself is network first.
//  - Map style, tiles and fonts from OpenFreeMap: only the tiles you have actually viewed are
//    kept (no bulk download), capped in number and age, so we stay a light user of a free service.
//  - Latest alerts, news, community pins, weather and air quality: always fetched fresh first.
//    If the network is slow or down, the last saved copy is used and marked with the
//    `x-navmap-saved` header so the app can say how old it is.
//  - Not cached: Esri satellite imagery (its terms do not allow offline storage without a
//    licence), rain radar (only useful live), search, routing and Overpass queries.
//
// The build (vite.config.js) replaces the PRECACHE line below with the real file list and a
// version, which also makes browsers pick up a new worker on every deploy.
const PRECACHE = { version: 'dev', files: [] };

const SHELL = `navmap-shell-${PRECACHE.version}`;
const DATA = 'navmap-data-v1';   // places grid (static, rebuilt weekly)
const LIVE = 'navmap-live-v1';   // alerts, news, pins, weather
const TILES = 'navmap-tiles-v1'; // OpenFreeMap map tiles, glyphs, sprites, style
const FONTS = 'navmap-fonts-v1'; // Google Fonts (Outfit)
const KEEP = [SHELL, DATA, LIVE, TILES, FONTS];

const LIMITS = { [TILES]: 1500, [DATA]: 400, [FONTS]: 30, [LIVE]: 40 };
const TILE_MAX_AGE = 14 * 24 * 3600e3;
const NET_TIMEOUT = { page: 3500, live: 6000, style: 5000 };

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(['/', ...PRECACHE.files]))
      .catch(() => {}) // a failed precache must not block the worker; pages still get cached as used
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('navmap-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (req.mode === 'navigate') return e.respondWith(page(req));
    const p = url.pathname;
    if (p.startsWith('/assets/')) return e.respondWith(cacheFirst(req, SHELL));
    if (p.startsWith('/data/')) return e.respondWith(staleWhileRevalidate(req, DATA, e));
    if (p === '/api/alerts' || p === '/api/news' || p === '/api/pins') return e.respondWith(networkFirst(req, LIVE, NET_TIMEOUT.live));
    if (p.startsWith('/api/') || p.startsWith('/_vercel/')) return; // stats, subscribe, places, analytics: always live
    return e.respondWith(staleWhileRevalidate(req, SHELL, e)); // icons, manifest, legal pages
  }

  switch (url.hostname) {
    case 'tiles.openfreemap.org':
      // Tiles, glyphs and sprites live under versioned paths and never change in place.
      // The style and TileJSON (which point at the current version) are checked on the network first.
      if (/\.(pbf|mvt|png|webp|json)$/.test(url.pathname) && !url.pathname.startsWith('/styles/') && url.pathname.split('/').length > 3) {
        return e.respondWith(cacheFirst(req, TILES, TILE_MAX_AGE, e));
      }
      return e.respondWith(networkFirst(req, TILES, NET_TIMEOUT.style));
    case 'fonts.googleapis.com':
      return e.respondWith(staleWhileRevalidate(req, FONTS, e));
    case 'fonts.gstatic.com':
      return e.respondWith(cacheFirst(req, FONTS));
    case 'api.open-meteo.com':
    case 'air-quality-api.open-meteo.com':
      // Keyed by location, with "the last one" as a fallback so you still see recent weather offline.
      return e.respondWith(networkFirst(req, LIVE, NET_TIMEOUT.live, `https://${url.hostname}/__latest`));
    case 'photon.komoot.io':
      if (url.pathname === '/reverse') return e.respondWith(networkFirst(req, LIVE, NET_TIMEOUT.live, 'https://photon.komoot.io/__latest-reverse'));
      return;
    default:
      return; // satellite, radar, routing, search, Overpass, logos: straight to the network
  }
});

// ---------------------------------------------------------------- strategies

async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), NET_TIMEOUT.page);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    // Slow or no network: open the saved app. If the network answers later it is still stored above.
    return (await cache.match('/')) || (await caches.match(req)) || offlineText();
  }
}

async function cacheFirst(req, name, maxAge = 0, e) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit && (!maxAge || age(hit) < maxAge)) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') {
      const put = cache.put(req, stamp(res.clone())).then(() => trim(name));
      e?.waitUntil(put);
    }
    return res;
  } catch (err) {
    if (hit) return hit; // too old, but better than a blank map when offline
    throw err;
  }
}

async function staleWhileRevalidate(req, name, e) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (res.ok && res.type !== 'opaque') return cache.put(req, stamp(res.clone())).then(() => trim(name)).then(() => res);
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

async function networkFirst(req, name, timeout, latestKey) {
  const cache = await caches.open(name);
  const net = fetch(req);
  // Keep saving the answer even if we stop waiting for it.
  const saved = net.then(async (res) => {
    if (!res.ok || res.type === 'opaque') return res;
    const s = stamp(res.clone());
    await cache.put(req, s.clone());
    if (latestKey) await cache.put(latestKey, s);
    trim(name);
    return res;
  });
  try {
    return await withTimeout(saved, timeout);
  } catch {
    const hit = (await cache.match(req)) || (latestKey && (await cache.match(latestKey)));
    if (hit) return markSaved(hit);
    return saved; // nothing saved yet: keep waiting for the network (or fail like normal)
  }
}

// ---------------------------------------------------------------- helpers

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

// Remember when a response was stored, so old tiles can be refreshed and the app can show "saved X ago".
function stamp(res) {
  const h = new Headers(res.headers);
  h.set('x-sw-at', String(Date.now()));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const age = (res) => Date.now() - Number(res.headers.get('x-sw-at') || 0);

function markSaved(res) {
  const h = new Headers(res.headers);
  h.set('x-navmap-saved', new Date(Number(res.headers.get('x-sw-at') || Date.now())).toISOString());
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Keep each cache under its limit by dropping the oldest entries (keys come back in insertion order).
const trimming = {};
function trim(name) {
  const max = LIMITS[name];
  if (!max || trimming[name]) return trimming[name];
  trimming[name] = caches.open(name).then(async (c) => {
    const keys = await c.keys();
    const extra = keys.length - max;
    if (extra > 0) await Promise.all(keys.slice(0, extra + Math.ceil(max * 0.1)).map((k) => c.delete(k)));
  }).finally(() => { trimming[name] = null; });
  return trimming[name];
}

function offlineText() {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NAVMAP offline</title><body style="font:16px system-ui;padding:24px"><h1>You are offline</h1><p>NAVMAP needs the internet once to save itself on this phone. Please reconnect and try again.</p><p>In an emergency call 999.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
