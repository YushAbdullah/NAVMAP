// Live weather from Open-Meteo (free, no key): current conditions, hourly, 7-day and air quality.
const cache = new Map();

// WMO weather codes -> icon + label
export function wmo(code, isDay = 1) {
  const c = Number(code);
  const T = (icon, en, bm, sky) => ({ icon, en, bm, sky });
  if (c === 0) return isDay ? T('sun', 'Clear', 'Cerah', 'clear') : T('moon', 'Clear', 'Cerah', 'night');
  if (c === 1 || c === 2) return isDay ? T('partly', 'Partly cloudy', 'Sebahagian berawan', 'clear') : T('partlynight', 'Partly cloudy', 'Sebahagian berawan', 'night');
  if (c === 3) return T('cloud', 'Cloudy', 'Berawan', 'cloud');
  if (c === 45 || c === 48) return T('fog', 'Fog / haze', 'Kabus / jerebu', 'cloud');
  if (c >= 51 && c <= 57) return T('drizzle', 'Drizzle', 'Gerimis', 'rain');
  if (c === 61 || c === 80) return T('rain', 'Light rain', 'Hujan renyai', 'rain');
  if (c === 63 || c === 81) return T('rain', 'Rain', 'Hujan', 'rain');
  if (c === 65 || c === 82 || c === 66 || c === 67) return T('heavyrain', 'Heavy rain', 'Hujan lebat', 'storm');
  if (c >= 95) return T('storm', 'Thunderstorm', 'Ribut petir', 'storm');
  if (c >= 71 && c <= 86) return T('cloud', 'Wintry', 'Sejuk', 'cloud');
  return T('cloud', 'Cloudy', 'Berawan', 'cloud');
}

// Pollution index levels, from cleanest to worst (US AQI scale: 0 to 500).
export const AQ_LEVELS = [
  { max: 50, level: 'good', color: '#2E9E4F', en: 'Good', bm: 'Baik',
    adv: { en: 'Air is clean. Enjoy outdoor activities.', bm: 'Udara bersih. Sesuai untuk aktiviti luar.' } },
  { max: 100, level: 'mod', color: '#C9A100', en: 'Moderate', bm: 'Sederhana',
    adv: { en: 'Acceptable. Very sensitive people should limit long outdoor effort.', bm: 'Boleh diterima. Individu sangat sensitif hadkan aktiviti luar yang lama.' } },
  { max: 150, level: 'usg', color: '#E07A00', en: 'Unhealthy for sensitive groups', bm: 'Tidak sihat (kumpulan sensitif)',
    adv: { en: 'Children, elderly and people with asthma or heart problems should reduce time outside.', bm: 'Kanak-kanak, warga emas dan pesakit asma atau jantung kurangkan masa di luar.' } },
  { max: 200, level: 'bad', color: '#C42A36', en: 'Unhealthy', bm: 'Tidak sihat',
    adv: { en: 'Everyone should reduce outdoor activity. Wear a mask outside.', bm: 'Semua orang kurangkan aktiviti luar. Pakai pelitup muka di luar.' } },
  { max: 300, level: 'vbad', color: '#7B2D8E', en: 'Very unhealthy', bm: 'Sangat tidak sihat',
    adv: { en: 'Stay indoors, close windows, use an N95 mask if you must go out.', bm: 'Duduk di dalam rumah, tutup tingkap, pakai pelitup N95 jika perlu keluar.' } },
  { max: Infinity, level: 'haz', color: '#6B1020', en: 'Hazardous (worst)', bm: 'Berbahaya (paling teruk)',
    adv: { en: 'Health emergency. Avoid all outdoor activity.', bm: 'Kecemasan kesihatan. Elakkan semua aktiviti luar.' } },
];

export function aqiLabel(aqi) {
  if (aqi == null) return null;
  return AQ_LEVELS.find((l) => aqi <= l.max);
}

export async function fetchWeather(lat, lon) {
  const la = Math.round(lat * 20) / 20, lo = Math.round(lon * 20) / 20; // ~5 km grid
  const key = `${la},${lo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
  const fc = new URLSearchParams({
    latitude: la, longitude: lo, timezone: 'Asia/Kuala_Lumpur', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
  });
  const aq = new URLSearchParams({ latitude: la, longitude: lo, timezone: 'Asia/Kuala_Lumpur', current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide', hourly: 'us_aqi', forecast_days: '2' });
  const p = Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${fc}`).then((r) => { if (!r.ok) throw new Error('weather'); return r.json(); }),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${aq}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([f, a]) => {
    const now = Date.now();
    const hours = f.hourly.time.map((t, i) => ({
      time: t, temp: f.hourly.temperature_2m[i], pop: f.hourly.precipitation_probability?.[i], code: f.hourly.weather_code[i], isDay: f.hourly.is_day?.[i] ?? 1,
    })).filter((h) => new Date(`${h.time}:00+08:00`).getTime() > now - 3600e3).slice(0, 24);
    const days = f.daily.time.map((d, i) => ({
      date: d, code: f.daily.weather_code[i], max: f.daily.temperature_2m_max[i], min: f.daily.temperature_2m_min[i],
      pop: f.daily.precipitation_probability_max?.[i], uv: f.daily.uv_index_max?.[i],
      sunrise: f.daily.sunrise?.[i], sunset: f.daily.sunset?.[i],
    }));
    const c = f.current;
    return {
      at: new Date().toISOString(), lat: la, lon: lo,
      now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, rain: c.precipitation, wind: c.wind_speed_10m, code: c.weather_code, isDay: c.is_day },
      hours, days,
      aqi: a?.current?.us_aqi ?? null, pm25: a?.current?.pm2_5 ?? null,
      air: a?.current ? {
        pm25: a.current.pm2_5, pm10: a.current.pm10, o3: a.current.ozone, no2: a.current.nitrogen_dioxide,
        so2: a.current.sulphur_dioxide, co: a.current.carbon_monoxide,
        // worst index expected over the next 24 hours
        peak: (() => {
          const ts = a.hourly?.time || [], v = a.hourly?.us_aqi || [];
          let best = null;
          ts.forEach((t, i) => {
            const ms = new Date(`${t}:00+08:00`).getTime();
            if (ms > now && ms < now + 24 * 3600e3 && v[i] != null && (!best || v[i] > best.aqi)) best = { aqi: v[i], time: t };
          });
          return best;
        })(),
      } : null,
    };
  });
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** Area name for the weather card (Photon reverse geocoding). */
const placeCache = new Map();
export async function placeName(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const j = await r.json();
    const p = j.features?.[0]?.properties || {};
    const name = p.district || p.city || p.county || p.name || p.state || '';
    const out = [name, p.state && p.state !== name ? p.state : ''].filter(Boolean).join(', ');
    placeCache.set(key, out);
    return out;
  } catch { return ''; }
}

/** RainViewer radar frames (past ~2 h + short nowcast). */
export async function radarFrames() {
  const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!r.ok) throw new Error('radar');
  const j = await r.json();
  const frames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])];
  return frames.map((f) => ({ time: f.time, url: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` }));
}
