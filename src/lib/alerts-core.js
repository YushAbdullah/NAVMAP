// Shared alert logic: used by the browser and by the /api/alerts serverless function.
// Sources: Malaysia open data realtime API (https://developer.data.gov.my/realtime-api)
//  - Flood warning (JPS / publicinfobanjir water level stations)
//  - Weather warning (MetMalaysia)
//  - Earthquake warning (MetMalaysia)

export const GOV_API = 'https://api.data.gov.my';

export const SOURCE_URLS = {
  flood: `${GOV_API}/flood-warning?filter=ON@water_level_status&limit=3000`,
  weather: `${GOV_API}/weather/warning?limit=50`,
  quake: `${GOV_API}/weather/warning/earthquake?sort=-utcdatetime&limit=30`,
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) && n !== -9999 ? n : null;
};
const titleCase = (s = '') => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Malaysian timestamps without zone are local time (UTC+8).
const myTime = (s) => {
  if (!s) return null;
  const iso = String(s).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function normalizeFlood(rows) {
  if (!Array.isArray(rows)) return [];
  const sev = { DANGER: 'danger', WARNING: 'danger', ALERT: 'warning' };
  return rows
    .filter((r) => sev[String(r.water_level_indicator || '').toUpperCase()])
    .map((r) => {
      const ind = String(r.water_level_indicator).toUpperCase();
      const lat = num(r.latitude), lon = num(r.longitude);
      const lvl = num(r.water_level_current);
      const trend = String(r.water_level_trend || '').toUpperCase();
      const place = [titleCase(r.district), titleCase(r.state)].filter(Boolean).join(', ');
      const labels = {
        DANGER: ['Flood danger level', 'Paras bahaya banjir'],
        WARNING: ['Flood warning level', 'Paras amaran banjir'],
        ALERT: ['Flood alert level', 'Paras waspada banjir'],
      }[ind];
      const lvlTxt = lvl != null ? `${lvl.toFixed(2)} m` : '';
      const trendEn = trend === 'RISING' ? ' · rising' : trend === 'FALLING' ? ' · falling' : '';
      const trendBm = trend === 'RISING' ? ' · meningkat' : trend === 'FALLING' ? ' · menurun' : '';
      return {
        id: `flood-${r.station_id}`,
        kind: 'flood',
        severity: sev[ind],
        level: ind,
        title: labels[0], title_bm: labels[1],
        place: `${r.station_name || 'Station'}${place ? `, ${place}` : ''}`,
        desc: `River level ${lvlTxt}${trendEn}`.trim(),
        desc_bm: `Paras sungai ${lvlTxt}${trendBm}`.trim(),
        state: titleCase(r.state),
        lat, lon,
        radiusKm: ind === 'ALERT' ? 1.5 : 3,
        time: myTime(r.water_level_update_datetime),
        source: 'JPS · data.gov.my',
      };
    })
    .filter((a) => a.lat != null && a.lon != null);
}

export function normalizeWeather(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => {
      const to = myTime(r.valid_to);
      return !to || new Date(to).getTime() > now;
    })
    .map((r, i) => {
      const wi = r.warning_issue || {};
      const heading = r.heading_en || wi.title_en || 'Weather warning';
      const h = heading.toLowerCase();
      const danger = /danger|bahaya|third|ketiga|severe|buruk/.test(h);
      return {
        id: `wx-${myTime(wi.issued) || i}-${i}`,
        kind: 'weather',
        severity: danger ? 'danger' : 'warning',
        title: heading,
        title_bm: r.heading_bm || wi.title_bm || heading,
        place: '',
        desc: r.text_en || '',
        desc_bm: r.text_bm || r.text_en || '',
        instruction: r.instruction_en || '',
        instruction_bm: r.instruction_bm || '',
        lat: null, lon: null,
        time: myTime(wi.issued || r.valid_from),
        validTo: myTime(r.valid_to),
        source: 'MetMalaysia · data.gov.my',
      };
    });
}

export function normalizeQuake(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const weekMs = 7 * 24 * 3600 * 1000;
  return rows
    .filter((r) => r.visible !== false)
    .map((r) => {
      const mag = num(r.magdefault);
      const time = r.utcdatetime ? new Date(`${r.utcdatetime}Z`).toISOString() : myTime(r.localdatetime);
      return {
        id: `eq-${r.utcdatetime}-${r.lat}-${r.lon}`,
        kind: 'quake',
        severity: mag != null && mag >= 6 ? 'danger' : mag != null && mag >= 4.5 ? 'warning' : 'info',
        title: `Earthquake M${mag ?? '?'}`,
        title_bm: `Gempa bumi M${mag ?? '?'}`,
        place: r.location_original || r.location || '',
        desc: [r.n_distancemas, r.depth != null ? `depth ${r.depth} km` : ''].filter(Boolean).join(' · '),
        desc_bm: [r.nbm_distancemas, r.depth != null ? `kedalaman ${r.depth} km` : ''].filter(Boolean).join(' · '),
        lat: num(r.lat), lon: num(r.lon),
        radiusKm: mag ? Math.min(60, mag * 8) : 20,
        mag,
        time,
        source: 'MetMalaysia · data.gov.my',
      };
    })
    .filter((a) => a.time && now - new Date(a.time).getTime() < weekMs);
}

const sevRank = { danger: 0, warning: 1, info: 2 };
export function sortAlerts(list) {
  return [...list].sort((a, b) =>
    (sevRank[a.severity] - sevRank[b.severity]) ||
    (new Date(b.time || 0) - new Date(a.time || 0)));
}

/** Fetch all three feeds and return { alerts, errors, fetchedAt }. */
export async function fetchGovAlerts(fetchImpl = fetch) {
  const get = async (url) => {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  };
  const [flood, weather, quake] = await Promise.allSettled([
    get(SOURCE_URLS.flood), get(SOURCE_URLS.weather), get(SOURCE_URLS.quake),
  ]);
  const errors = [];
  const pick = (r, name, fn) => {
    if (r.status === 'fulfilled') return fn(r.value);
    errors.push(name);
    return [];
  };
  const alerts = sortAlerts([
    ...pick(flood, 'flood', normalizeFlood),
    ...pick(weather, 'weather', normalizeWeather),
    ...pick(quake, 'quake', normalizeQuake),
  ]);
  return { alerts, errors, fetchedAt: new Date().toISOString(), live: errors.length < 3 };
}
