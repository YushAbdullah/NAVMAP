// Community hazard reports. For now they are stored on this device only.
// Next step: move to a shared backend (e.g. Supabase) with moderation.
const KEY = 'navmap.reports.v1';
const TTL = 3 * 3600 * 1000; // reports expire after 3 hours

export const REPORT_TYPES = [
  { id: 'flood', en: 'Flooded road', bm: 'Jalan banjir', sev: 'danger' },
  { id: 'accident', en: 'Accident', bm: 'Kemalangan', sev: 'danger' },
  { id: 'landslide', en: 'Landslide', bm: 'Tanah runtuh', sev: 'danger' },
  { id: 'tree', en: 'Fallen tree', bm: 'Pokok tumbang', sev: 'warning' },
  { id: 'jam', en: 'Heavy traffic', bm: 'Kesesakan', sev: 'warning' },
  { id: 'haze', en: 'Thick haze', bm: 'Jerebu tebal', sev: 'warning' },
];

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function listReports() {
  const now = Date.now();
  const list = read().filter((r) => now - new Date(r.time).getTime() < TTL);
  write(list);
  return list;
}

export function addReport(typeId, lat, lon) {
  const t = REPORT_TYPES.find((x) => x.id === typeId);
  const r = {
    id: `r-${Date.now()}`, kind: 'report', type: typeId, severity: t.sev,
    title: t.en, title_bm: t.bm, place: '', desc: 'Reported by you', desc_bm: 'Dilaporkan oleh anda',
    lat, lon, radiusKm: 0.5, time: new Date().toISOString(), source: 'Your report',
  };
  write([...read(), r]);
  return r;
}
