// Shared by api/radio.js and the browser fallback: read Malaysian stations from Radio Browser and tidy them.
const MIRRORS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const QUERY = '/json/stations/search?countrycode=MY&hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=300';

// RTM (Radio Televisyen Malaysia) public stations, so they can be grouped together.
const RTM_RE = /\b(rtm|nasional fm|radio klasik|klasik fm|traxx|minnal|ai fm|asyik|radio malaysia|(selangor|kl|perak|kedah|perlis|langkawi|penang|pahang|terengganu|kelantan|melaka|negeri|johor|sabah|sarawak|labuan|sandakan|tawau|miri|sibu|bintulu|limbang|wai|iban|bidayuh|keningau|sabah v)\s*fm)\b/i;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const key = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Turn raw Radio Browser rows into a short, de-duplicated list (most listened first). */
export function tidyStations(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const url = clean(r.url_resolved || r.url);
    const name = clean(r.name).replace(/^[-_.\s]+/, '');
    if (!name || !/^https:\/\//i.test(url) || r.lastcheckok === 0) continue;
    const k = key(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const home = clean(r.homepage);
    const favicon = /^https:\/\//i.test(r.favicon || '') ? clean(r.favicon) : '';
    out.push({
      id: r.stationuuid,
      name: name.slice(0, 60),
      url,
      favicon,
      home: /^https?:\/\//i.test(home) ? home : '',
      tags: clean(r.tags).split(',').map(clean).filter(Boolean).slice(0, 3),
      state: clean(r.state),
      lang: clean(r.language),
      kbps: Number(r.bitrate) || 0,
      rtm: /rtm\.gov\.my|rtmklik/i.test(home) || RTM_RE.test(name),
    });
    if (out.length >= 150) break;
  }
  return out;
}

/** Race the Radio Browser mirrors; the first good answer wins. */
export async function fetchStations(fetchFn = fetch, { timeout = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const rows = await Promise.any(MIRRORS.map(async (m) => {
      const r = await fetchFn(m + QUERY, { signal: ctl.signal, headers: { 'User-Agent': 'NAVMAP/1.0 (navmap.vercel.app)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) throw new Error('empty');
      return j;
    }));
    return tidyStations(rows);
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}
