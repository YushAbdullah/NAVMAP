// Free radio: live Malaysian radio stations to listen to while driving or browsing.
//
// The station list comes from Radio Browser (radio-browser.info), a free, open, community-run
// directory of public internet radio streams. NAVMAP does not host or re-broadcast any audio:
// your phone plays each station's own public stream directly. Only HTTPS streams are listed,
// because a secure page cannot play plain-HTTP audio.
//
// Playback keeps going while you use the rest of the app, shows on the lock screen and car
// display (Media Session), and gets quieter while navigation voice guidance is speaking.

const HOSTS = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
const LAST_KEY = 'navmap.radio';
const LIST_KEY = 'navmap.radioList';
const LIST_TTL = 12 * 3600e3;
const DUCK = 0.25;

let audio = null;
let current = null;  // station being played
let status = 'idle'; // idle | loading | playing | paused | error
let host = HOSTS[0];
const subs = new Set();

const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const notify = () => subs.forEach((fn) => fn());

export const onRadioChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const radioState = () => ({ station: current, status, last: get(LAST_KEY) });

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function shape(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const url = s.url_resolved || s.url || '';
    if (!url.startsWith('https://') || s.lastcheckok === 0) continue;
    const name = clean(s.name);
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: s.stationuuid, name, url,
      logo: (s.favicon || '').startsWith('https://') ? s.favicon : '',
      tags: clean(s.tags).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3),
      lang: clean(s.language), state: clean(s.state), clicks: s.clickcount || 0,
    });
  }
  return out;
}

async function fetchFrom(h, signal) {
  const q = new URLSearchParams({ countrycode: 'MY', hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true', limit: '200' });
  const res = await fetch(`${h}/json/stations/search?${q}`, { signal });
  if (!res.ok) throw new Error(`radio ${res.status}`);
  return res.json();
}

/** Malaysian stations, most listened first. Cached on the phone for 12 hours. */
export async function loadStations({ force = false, signal } = {}) {
  const cached = get(LIST_KEY);
  if (!force && cached?.at > Date.now() - LIST_TTL && cached.list?.length) return cached.list;
  let lastErr;
  for (const h of HOSTS) {
    try {
      const list = shape(await fetchFrom(h, signal));
      if (!list.length) throw new Error('empty');
      host = h;
      put(LIST_KEY, { at: Date.now(), list });
      return list;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  if (cached?.list?.length) return cached.list; // old list beats no list
  throw lastErr || new Error('radio');
}

function setStatus(s) { status = s; notify(); syncSession(); }

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('playing', () => setStatus('playing'));
  audio.addEventListener('waiting', () => { if (status !== 'paused') setStatus('loading'); });
  audio.addEventListener('pause', () => { if (status !== 'idle' && status !== 'error') setStatus('paused'); });
  audio.addEventListener('error', () => { if (current) setStatus('error'); });
  // Navigation voice guidance: lower the radio while it speaks.
  document.addEventListener('navmap-voice', (e) => { if (audio) audio.volume = e.detail ? DUCK : 1; });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => resume());
      ms.setActionHandler('pause', () => pause());
      ms.setActionHandler('stop', () => stop());
    } catch { /* not supported */ }
  }
  return audio;
}

function syncSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (!current || status === 'idle') { ms.metadata = null; ms.playbackState = 'none'; return; }
  try {
    ms.metadata = new MediaMetadata({
      title: current.name, artist: 'NAVMAP Radio', album: current.state || 'Malaysia',
      artwork: [current.logo ? { src: current.logo } : { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch { /* old browsers */ }
  ms.playbackState = status === 'paused' ? 'paused' : 'playing';
}

/** Start a station. Must be called from a tap (browsers block audio otherwise). */
export function play(station) {
  const a = ensureAudio();
  current = station;
  put(LAST_KEY, station);
  a.src = station.url;
  setStatus('loading');
  a.play().catch((err) => { if (err?.name !== 'AbortError') setStatus('error'); });
  // Tell the directory someone listened (keeps its popularity ranking honest). Fire and forget.
  if (station.id) fetch(`${host}/json/url/${encodeURIComponent(station.id)}`).catch(() => {});
}

export function pause() { if (audio && current) { audio.pause(); setStatus('paused'); } }

export function resume() {
  // A live stream that sat paused is stale, so it is reloaded: you hear "now", not minutes ago.
  const s = current || get(LAST_KEY);
  if (s) play(s);
}

export function stop() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  current = null;
  setStatus('idle');
}

export const isOn = () => status === 'playing' || status === 'loading';
