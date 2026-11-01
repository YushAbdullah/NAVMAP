// Saved places (Home, Work). Kept only on this device, in localStorage; never sent to our server.
const KEY = 'navmap.saved';
export const SAVED_KINDS = ['home', 'work'];

export function getSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = {};
    for (const k of SAVED_KINDS) {
      const p = v[k];
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) out[k] = { name: String(p.name || '').slice(0, 120), lat: p.lat, lon: p.lon };
    }
    return out;
  } catch { return {}; }
}

export function setSaved(kind, place) {
  if (!SAVED_KINDS.includes(kind)) return getSaved();
  const all = getSaved();
  if (place) all[kind] = { name: String(place.name || '').slice(0, 120), lat: +(+place.lat).toFixed(6), lon: +(+place.lon).toFixed(6) };
  else delete all[kind];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: lost on close */ }
  return all;
}

/** Which saved kind (if any) sits within ~30 m of this point. */
export function savedKindAt(saved, lat, lon) {
  return SAVED_KINDS.find((k) => saved[k] && Math.abs(saved[k].lat - lat) < 0.0003 && Math.abs(saved[k].lon - lon) < 0.0003) || null;
}
