// Free radio: plays Malaysian stations' own public streams with one <audio> element.
// Keeps playing in the background while you drive, and turns down while the voice gives directions.
import { fetchStations } from './radio-core.js';

const FAV_KEY = 'navmap.radioFavs';
const LAST_KEY = 'navmap.radioLast';
const VOL_KEY = 'navmap.radioVol';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const readJson = (k, d) => { try { return JSON.parse(get(k)) ?? d; } catch { return d; } };

const audio = typeof Audio !== 'undefined' ? new Audio() : null;
if (audio) { audio.preload = 'none'; audio.setAttribute('playsinline', ''); }

let stations = [];
let loading = null;
let listFailed = false;
let current = readJson(LAST_KEY, null);     // last station, so the Play button works straight away
let status = 'idle';                        // idle | loading | playing | error
let volume = Math.min(1, Math.max(0.05, Number(get(VOL_KEY)) || 0.8));
let ducked = false;
let favs = new Set(readJson(FAV_KEY, []));
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onRadioChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const radioState = () => ({ stations, current, status, volume, loaded: !!stations.length, listFailed });
export const isFav = (id) => favs.has(id);
export function toggleFav(id) {
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  put(FAV_KEY, JSON.stringify([...favs]));
  emit();
}

/** Station list: from /api/radio (cached at the edge), or straight from Radio Browser if that fails. */
export function loadStations() {
  if (stations.length) return Promise.resolve(stations);
  if (loading) return loading;
  listFailed = false;
  loading = (async () => {
    try {
      const r = await fetch('/api/radio');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.stations?.length) throw new Error('empty');
      stations = j.stations;
    } catch {
      stations = await fetchStations(fetch).catch(() => []);
    }
    loading = null;
    listFailed = !stations.length;
    emit();
    return stations;
  })();
  return loading;
}

function applyVolume() { if (audio) audio.volume = ducked ? Math.min(volume, 0.18) : volume; }
export function setVolume(v) {
  volume = Math.min(1, Math.max(0.05, Number(v) || 0.8));
  put(VOL_KEY, String(volume));
  applyVolume();
}
/** Turn the radio down while the voice speaks (phones that ignore volume, like iPhone, mix it themselves). */
export function duck(on) {
  if (ducked === on) return;
  ducked = on;
  applyVolume();
}

/** Play a station (must be called from a tap the first time, so the phone allows sound). */
export function play(st) {
  if (!audio || !st) return;
  current = { id: st.id, name: st.name, url: st.url, favicon: st.favicon || '' };
  put(LAST_KEY, JSON.stringify(current));
  status = 'loading';
  emit();
  audio.src = st.url;
  applyVolume();
  audio.play().catch(() => { status = 'error'; emit(); });
  setMediaSession();
}
export function stop() {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load(); // drop the connection so it stops using data
  status = 'idle';
  emit();
}
export const toggle = () => (status === 'playing' || status === 'loading' ? stop() : current && play(current));

if (audio) {
  audio.addEventListener('playing', () => { status = 'playing'; emit(); });
  audio.addEventListener('waiting', () => { if (status === 'playing') { status = 'loading'; emit(); } });
  audio.addEventListener('error', () => { if (audio.getAttribute('src')) { status = 'error'; emit(); } });
}

// Lock screen and car Bluetooth controls.
function setMediaSession() {
  const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
  if (!ms || !current) return;
  try {
    ms.metadata = new MediaMetadata({ title: current.name, artist: 'NAVMAP Radio', artwork: current.favicon ? [{ src: current.favicon, sizes: '96x96' }] : [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] });
    ms.setActionHandler('play', () => play(current));
    ms.setActionHandler('pause', stop);
    ms.setActionHandler('stop', stop);
  } catch { /* older browsers */ }
}
