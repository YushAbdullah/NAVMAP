// Ride-hailing hand-off: open Grab, AirAsia MOVE or inDrive with the trip filled in where the app allows it,
// and fall back to the app's store page when it is not installed.
//
// Grab is the only one with a public booking deep link that takes pickup and drop-off.
// AirAsia MOVE and inDrive open on their home screen; the destination is copied first so it can be pasted.

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = () => /Android/i.test(navigator.userAgent);

export const RIDE_APPS = [
  {
    id: 'grab', name: 'Grab', color: '#00B14F', fills: true,
    pkg: 'com.grabtaxi.passenger',
    ios: 'https://apps.apple.com/my/app/grab-taxi-ride-food-delivery/id647268330',
    web: 'https://www.grab.com/my/transport/',
    link({ from, to }) {
      const q = new URLSearchParams({ screenType: 'BOOKING' });
      if (from) {
        q.set('pickUpLatitude', from.lat); q.set('pickUpLongitude', from.lon);
        if (from.name) q.set('pickUpAddress', from.name);
      }
      q.set('dropOffLatitude', to.lat); q.set('dropOffLongitude', to.lon);
      if (to.name) q.set('dropOffAddress', to.name);
      return { scheme: 'grab', path: `open?${q}` };
    },
  },
  {
    id: 'airasia', name: 'AirAsia Ride', color: '#E5202E', fills: false,
    pkg: 'com.airasia.mobile',
    ios: 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=airasia%20move',
    web: 'https://www.airasia.com/ride/en/gb',
    link: () => ({ scheme: 'airasia', path: '' }),
  },
  {
    id: 'indrive', name: 'inDrive', color: '#C1F11D', fg: '#141414', fills: false,
    pkg: 'sinet.startup.inDriver',
    ios: 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=inDrive',
    web: 'https://indrive.com/en/home/',
    link: () => ({ scheme: 'indriver', path: '' }),
  },
];

const play = (pkg) => `https://play.google.com/store/apps/details?id=${pkg}`;

/** The URL to open for this phone. Android gets an intent link, which falls back to Google Play by itself. */
export function rideHref(app, trip) {
  const { scheme, path } = app.link(trip);
  if (android()) {
    const fb = encodeURIComponent(play(app.pkg));
    return `intent://${path}#Intent;${path ? `scheme=${scheme};` : ''}package=${app.pkg};S.browser_fallback_url=${fb};end`;
  }
  if (ios()) return `${scheme}://${path}`;
  return app.web;
}

/** Open the app. On iPhone, if the page is still showing after a moment, the app is missing: go to the App Store. */
export function openRide(app, trip) {
  const href = rideHref(app, trip);
  // Only Grab has a known iPhone link; for the others the App Store page shows "Open" when the app is installed.
  if (ios() && !app.fills) { window.location.href = app.ios; return; }
  if (ios()) {
    let left = false;
    const away = () => { left = true; };
    document.addEventListener('visibilitychange', away, { once: true });
    window.addEventListener('pagehide', away, { once: true });
    setTimeout(() => {
      document.removeEventListener('visibilitychange', away);
      if (!left && !document.hidden) window.location.href = app.ios;
    }, 1600);
    window.location.href = href;
    return;
  }
  if (android()) { window.location.href = href; return; }
  window.open(href, '_blank', 'noopener');
}

/** Google Maps public transport directions, as a last resort when no timetable trip is found. */
export function gmapsTransit(from, to) {
  const q = new URLSearchParams({ api: '1', destination: `${to.lat},${to.lon}`, travelmode: 'transit' });
  if (from) q.set('origin', `${from.lat},${from.lon}`);
  return `https://www.google.com/maps/dir/?${q}`;
}
