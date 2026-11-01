// Turns long MetMalaysia warning text into something you can read at a glance:
// a short summary line, the affected states as chips, and tidied full text for "Show details".

const STATES = [
  ['Perlis', /\bperlis\b/i], ['Kedah', /\bkedah\b/i], ['Penang', /\b(pulau pinang|penang)\b/i],
  ['Perak', /\bperak\b/i], ['Selangor', /\bselangor\b/i], ['Kuala Lumpur', /\bkuala lumpur\b/i],
  ['Putrajaya', /\bputrajaya\b/i], ['N. Sembilan', /\bnegeri sembilan\b/i], ['Melaka', /\b(melaka|malacca)\b(?!\s+(utara|selatan|tengah)|\s+strait)/i],
  ['Johor', /\bjohor\b/i], ['Pahang', /\bpahang\b/i], ['Terengganu', /\bterengganu\b/i],
  ['Kelantan', /\bkelantan\b/i], ['Sabah', /\bsabah\b/i], ['Sarawak', /\bsarawak\b/i], ['Labuan', /\blabuan\b/i],
];
const MARINE = /\b(perairan|waters|perkapalan|shipping|laut bergelora|rough seas)\b/i;

/** States named in the text, in the order they first appear. */
export function alertStates(text = '') {
  return STATES
    .map(([name, re]) => ({ name, at: text.search(re) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((s) => s.name);
}

export const isMarine = (text = '') => MARINE.test(text);


/** One short sentence: what is happening, without the place list. */
export function alertSummary(text = '', max = 110) {
  let s = String(text).replace(/\s+/g, ' ').trim();
  // drop a leading "SEKSYEN A: UNTUK PERAIRAN ... 1) AMARAN RIBUT PETIR" style prefix
  s = s.replace(/^(?:(?:SEKSYEN|SECTION)\s+[A-Z]\s*:.*?)?\d\)\s*(?:[A-Z][A-Z ]+?\s+(?=[A-Z][a-z]))?/, '');
  // cut before the place list: "... dijangka di negeri Kelantan" / "... expected over Kelantan"
  const cut = s.search(/\s(di|over|in|at|for)\s+(negeri|kawasan|perairan|the states?|the waters?|waters|[A-Z])/);
  if (cut > 20) s = s.slice(0, cut);
  else {
    const dot = s.indexOf('. ');
    if (dot > 20) s = s.slice(0, dot);
  }
  s = s.replace(/[,;:\s]+$/, '');
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return s && !/[.…]$/.test(s) ? `${s}.` : s;
}

/** "AMARAN RIBUT PETIR" -> "Amaran ribut petir"; mixed-case titles stay as they are. */
export function tidyTitle(s = '') {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

/**
 * Full text as escaped HTML: section headers on their own line, numbered warnings as
 * paragraphs, and "•"-separated areas as a list.
 */
export function alertTextHtml(text = '', esc) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/\s*(?=(?:SEKSYEN|SECTION)\s+[A-Z]\s*:)|\s+(?=\d\)\s)/).filter(Boolean);
  return parts.map((p) => {
    const sec = p.match(/^((?:SEKSYEN|SECTION)\s+[A-Z]\s*:.*?)(?=\s*\d\)|$)/);
    if (sec) {
      const rest = p.slice(sec[1].length).trim();
      return `<h4>${esc(sec[1].trim())}</h4>${rest ? para(rest, esc) : ''}`;
    }
    return para(p, esc);
  }).join('');
}

const PLACES_AT = /\s(?:di negeri|di kawasan perairan|di kawasan|di|over the states? of|over|in)\s+(?=[A-Z])/;
const UNTIL_AT = /\s(?=(?:sehingga|until)\s)/i;
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

function para(p, esc) {
  const num = p.match(/^(\d\))\s*([A-Z][A-Z &]+?)\s+(?=[A-Z][a-z])/);
  let head = '';
  if (num) { head = `<b>${esc(tidyTitle(num[2]))}</b> `; p = p.slice(num[0].length); }
  const bits = p.split(/\s*•\s*/);
  if (bits.length < 3) return `<p>${head}${esc(p)}</p>`;
  // "... dijangka di negeri Kelantan (...)" -> lead "... dijangka di negeri:" + first area
  let lead = bits[0];
  const m = lead.match(PLACES_AT);
  if (m && m.index > 10) { bits[0] = lead.slice(m.index + m[0].length); lead = `${lead.slice(0, m.index + m[0].length).trim()}:`; }
  else bits.shift();
  // "Sabah Timur sehingga 9:00 Malam; ... Keadaan ini ..." -> area + its own closing paragraph
  let tail = '';
  const last = bits[bits.length - 1];
  const u = last.search(UNTIL_AT);
  if (u > 0) { bits[bits.length - 1] = last.slice(0, u); tail = `<p>${esc(cap(last.slice(u + 1)))}</p>`; }
  return `<p>${head}${esc(lead)}</p><ul>${bits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>${tail}`;
}

/** "until 1:00 am, Mon 2 Nov" in the user's language, Malaysia time. */
export function fmtUntil(iso, lang = 'en') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const loc = lang === 'bm' ? 'ms-MY' : 'en-MY';
  const tz = 'Asia/Kuala_Lumpur';
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const day = d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  return `${time}, ${day}`;
}

/** "Winds up to 50 km/h, waves up to 3.5 m" when the text gives them, else ''. */
export function seaNumbers(text = '', lang = 'en') {
  const wind = text.match(/(\d{2,3})\s*(?:kmsj|km\/j|km\/h|kmj|kph)/i)?.[1];
  const wave = text.match(/(\d+(?:[.,]\d+)?)\s*(?:meter|metre|m)\b/i)?.[1]?.replace(',', '.');
  const bm = lang === 'bm';
  const parts = [];
  if (wind) parts.push(bm ? `angin hingga ${wind} km/j` : `winds up to ${wind} km/h`);
  if (wave) parts.push(bm ? `ombak hingga ${wave} m` : `waves up to ${wave} m`);
  if (!parts.length) return '';
  const s = parts.join(', ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
