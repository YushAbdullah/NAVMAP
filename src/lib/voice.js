// Spoken navigation using the browser's built-in speech (Web Speech API). No cost, works offline.
const KEY = 'navmap.voice';
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const voiceOn = () => enabled && voiceSupported();
export function setVoice(on) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on && voiceSupported()) speechSynthesis.cancel();
}

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const want = lang === 'bm' ? ['ms-MY', 'ms', 'id-ID', 'id'] : ['en-MY', 'en-SG', 'en-GB', 'en-US', 'en'];
  for (const w of want) {
    const v = voices.find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(w.toLowerCase()));
    if (v) return v;
  }
  return null;
}

/** Speak now, interrupting anything older. Call once from a tap first so iOS allows audio. */
export function speak(text, lang = 'en') {
  if (!voiceOn() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(lang);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === 'bm' ? 'ms-MY' : 'en-MY';
  u.rate = 1;
  speechSynthesis.speak(u);
}

/** Spoken distance, e.g. "500 metres" / "1.5 kilometres" (BM: meter / kilometer). */
export function spokenDist(m, lang) {
  const bm = lang === 'bm';
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    return `${km % 1 === 0 ? km.toFixed(0) : km} ${bm ? 'kilometer' : km === 1 ? 'kilometre' : 'kilometres'}`;
  }
  const r = m >= 300 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50;
  return `${Math.max(50, r)} ${bm ? 'meter' : 'metres'}`;
}

if (voiceSupported()) speechSynthesis.getVoices(); // warm the voice list
