// Community pin types (shared by the app and the /api/pins server).
// hours    = how long a new pin stays before it expires automatically.
// maxHours = the longest a pin can live when other people keep confirming it ("Still there").
//            Each confirmation pushes the expiry to now + hours, never past createdAt + maxHours.
// needsNote = the pin is a question, so it must come with a short note.
// Short-lived things (traffic, rain) expire fast; slow ones (flood, landslide, haze) last longer.
export const PIN_TYPES = [
  { id: 'rain', en: 'Raining', bm: 'Hujan', sev: 'info', hours: 1.5, maxHours: 3, icon: 'rain' },
  { id: 'heavy_rain', en: 'Heavy rain', bm: 'Hujan lebat', sev: 'warning', hours: 2, maxHours: 4, icon: 'heavyrain' },
  { id: 'storm', en: 'Thunderstorm', bm: 'Ribut petir', sev: 'warning', hours: 2, maxHours: 4, icon: 'storm' },
  { id: 'flood', en: 'Flood', bm: 'Banjir', sev: 'danger', hours: 8, maxHours: 48, icon: 'flood' },
  { id: 'wind', en: 'Strong wind', bm: 'Angin kencang', sev: 'warning', hours: 2, maxHours: 4, icon: 'wind' },
  { id: 'haze', en: 'Haze', bm: 'Jerebu', sev: 'warning', hours: 6, maxHours: 24, icon: 'haze' },
  { id: 'landslide', en: 'Landslide', bm: 'Tanah runtuh', sev: 'danger', hours: 12, maxHours: 72, icon: 'landslide' },
  { id: 'tree', en: 'Fallen tree', bm: 'Pokok tumbang', sev: 'warning', hours: 4, maxHours: 12, icon: 'tree' },
  { id: 'hot', en: 'Very hot', bm: 'Sangat panas', sev: 'info', hours: 3, maxHours: 6, icon: 'sun' },
  { id: 'clear', en: 'Clear now', bm: 'Cerah sekarang', sev: 'info', hours: 1, maxHours: 2, icon: 'partly' },
  { id: 'accident', en: 'Accident', bm: 'Kemalangan', sev: 'danger', hours: 1, maxHours: 3, icon: 'accident' },
  { id: 'jam', en: 'Heavy traffic', bm: 'Kesesakan', sev: 'warning', hours: 0.75, maxHours: 2, icon: 'jam' },
  { id: 'ask', en: 'Question', bm: 'Soalan', sev: 'info', hours: 2, maxHours: 6, icon: 'chat', needsNote: true },
];
export const PIN_BY_ID = Object.fromEntries(PIN_TYPES.map((p) => [p.id, p]));
