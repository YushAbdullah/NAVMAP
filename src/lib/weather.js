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

export function aqiLabel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 50) return { en: 'Good', bm: 'Baik', level: 'good' };
  if (aqi <= 100) return { en: 'Moderate', bm: 'Sederhana', level: 'mod' };
  if (aqi <= 150) return { en: 'Unhealthy for sensitive groups', bm: 'Tidak sihat (sensitif)', level: 'bad' };
  if (aqi <= 200) return { en: 'Unhealthy', bm: 'Tidak sihat', level: 'bad' };
  return { en: 'Very unhealthy', bm: 'Sangat tidak sihat', level: 'bad' };
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
  const aq = new URLSearchParams({ latitude: la, longitude: lo, timezone: 'Asia/Kuala_Lumpur', current: 'us_aqi,pm2_5' });
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
