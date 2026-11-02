// Spoken navigation using the browser's built-in speech (Web Speech API). No cost, works offline.
import { packById, STD } from './voice-packs.js';
import { duck } from './radio.js';

const KEY = 'navmap.voice';
const PACK_KEY = 'navmap.voicePack';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

let enabled = get(KEY) !== 'off';
let packId = get(PACK_KEY) || 'auto';

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const voiceOn = () => enabled && voiceSupported();
export function setVoice(on) {
  enabled = on;
  put(KEY, on ? 'on' : 'off');
  if (!on && voiceSupported()) speechSynthesis.cancel();
}

export const getVoicePack = () => packId;
export function setVoicePack(id) { packId = packById(id).id; put(PACK_KEY, packId); }

const norm = (s) => String(s || '').replace('_', '-').toLowerCase();
/** The best installed voice for a pack, or null. */
export function findVoice(pack) {
  if (!voiceSupported() || !pack.tts) return null;
  const voices = speechSynthesis.getVoices();
  for (const w of pack.tts) {
    const v = voices.find((x) => norm(x.lang) === norm(w)) || voices.find((x) => norm(x.lang).startsWith(norm(w)));
    if (v) return v;
  }
  return null;
}
/** True once the voice list has loaded (some browsers fill it in a moment later). */
export const voicesLoaded = () => voiceSupported() && speechSynthesis.getVoices().length > 0;

/**
 * The pack that will actually speak, given the app language. Tamil and Chinese need their own voice;
 * when it isn't installed we fall back to the app language so the driver never hears garbled speech.
 */
export function activePack(appLang) {
  const std = STD[appLang === 'bm' ? 'bm' : 'en'];
  const p = packById(packId);
  if (p.id === 'auto') return std;
  if (p.needs && voicesLoaded() && !findVoice(p)) return std;
  return p;
}

/** Speak now, interrupting anything older (or after it, with `queue`). Call once from a tap first so iOS allows audio. */
export function speak(text, pack, { queue = false, force = false } = {}) {
  if ((!voiceOn() && !force) || !voiceSupported() || !text) return;
  if (!queue) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = findVoice(pack);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = pack.tts?.[0] || 'en-MY';
  u.rate = 1;
  // Turn the radio down while directions are spoken, back up once the voice is quiet.
  u.onstart = () => duck(true);
  u.onend = u.onerror = () => setTimeout(() => { if (!speechSynthesis.speaking) duck(false); }, 400);
  duck(true);
  speechSynthesis.speak(u);
}

if (voiceSupported()) speechSynthesis.getVoices(); // warm the voice list
