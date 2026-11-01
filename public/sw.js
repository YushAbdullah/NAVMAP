// NAVMAP service worker: keeps the app shell available offline so the
// installed app (and the Google Play version) still opens without signal.
// Map tiles, routes, alerts and /api/* always go to the network (they must be fresh).
const CACHE = 'navmap-shell-v4';
const SHELL = [
  '/', '/offline.html', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png',
];

// Precache the shell plus the hashed JS/CSS that the current index.html points to,
// so the app works offline right after the first visit.
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  try {
    const html = await (await fetch('/', { cache: 'no-cache' })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    if (assets.length) await c.addAll([...new Set(assets)]);
  } catch { /* offline during install: the shell is enough */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Hashed build files never change: serve from cache first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Everything else: network first, fall back to cache, then to the offline page.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (hit) return hit;
        if (req.mode === 'navigate') return (await caches.match('/')) || caches.match('/offline.html');
        return Response.error();
      })
  );
});
