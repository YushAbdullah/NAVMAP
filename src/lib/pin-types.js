// Community pin types (shared by the app and the /api/pins server).
// hours = how long a pin stays before it expires automatically.
export const PIN_TYPES = [
  { id: 'rain', en: 'Raining', bm: 'Hujan', sev: 'info', hours: 2, icon: 'rain' },
  { id: 'heavy_rain', en: 'Heavy rain', bm: 'Hujan lebat', sev: 'warning', hours: 2, icon: 'heavyrain' },
  { id: 'storm', en: 'Thunderstorm', bm: 'Ribut petir', sev: 'warning', hours: 2, icon: 'storm' },
  { id: 'flood', en: 'Flood', bm: 'Banjir', sev: 'danger', hours: 8, icon: 'flood' },
  { id: 'wind', en: 'Strong wind', bm: 'Angin kencang', sev: 'warning', hours: 2, icon: 'wind' },
  { id: 'haze', en: 'Haze', bm: 'Jerebu', sev: 'warning', hours: 6, icon: 'haze' },
  { id: 'landslide', en: 'Landslide', bm: 'Tanah runtuh', sev: 'danger', hours: 12, icon: 'landslide' },
  { id: 'tree', en: 'Fallen tree', bm: 'Pokok tumbang', sev: 'warning', hours: 6, icon: 'tree' },
  { id: 'hot', en: 'Very hot', bm: 'Sangat panas', sev: 'info', hours: 3, icon: 'sun' },
  { id: 'clear', en: 'Clear now', bm: 'Cerah sekarang', sev: 'info', hours: 2, icon: 'partly' },
  { id: 'accident', en: 'Accident', bm: 'Kemalangan', sev: 'danger', hours: 2, icon: 'accident' },
  { id: 'jam', en: 'Heavy traffic', bm: 'Kesesakan', sev: 'warning', hours: 1, icon: 'jam' },
];
export const PIN_BY_ID = Object.fromEntries(PIN_TYPES.map((p) => [p.id, p]));
