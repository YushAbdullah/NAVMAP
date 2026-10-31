// Clearly-labelled SAMPLE alerts, shown only when the live feeds cannot be reached.
export function sampleAlerts() {
  const now = Date.now();
  const t = (min) => new Date(now - min * 60000).toISOString();
  return [
    { id: 's-flood-1', kind: 'flood', severity: 'danger', level: 'DANGER', title: 'Flood danger level', title_bm: 'Paras bahaya banjir',
      place: 'Sg. Klang di Jambatan Sulaiman, Kuala Lumpur', desc: 'River level 4.10 m · rising', desc_bm: 'Paras sungai 4.10 m · meningkat',
      lat: 3.1415, lon: 101.6955, radiusKm: 3, time: t(12), source: 'Sample data' },
    { id: 's-flood-2', kind: 'flood', severity: 'warning', level: 'ALERT', title: 'Flood alert level', title_bm: 'Paras waspada banjir',
      place: 'Sg. Gombak di Jalan Tun Razak, Kuala Lumpur', desc: 'River level 2.35 m · rising', desc_bm: 'Paras sungai 2.35 m · meningkat',
      lat: 3.1726, lon: 101.6990, radiusKm: 1.5, time: t(25), source: 'Sample data' },
    { id: 's-wx-1', kind: 'weather', severity: 'warning', title: 'Thunderstorm warning', title_bm: 'Amaran ribut petir',
      place: '', desc: 'Thunderstorms, heavy rain and strong winds expected over Selangor and Kuala Lumpur until 7:00 pm.',
      desc_bm: 'Ribut petir, hujan lebat dan angin kencang dijangka di Selangor dan Kuala Lumpur sehingga 7:00 petang.',
      lat: null, lon: null, time: t(40), source: 'Sample data' },
    { id: 's-eq-1', kind: 'quake', severity: 'info', title: 'Earthquake M4.6', title_bm: 'Gempa bumi M4.6',
      place: 'Northern Sumatra, Indonesia', desc: '412km W Pulau Pinang · depth 10 km', desc_bm: '412km B Pulau Pinang · kedalaman 10 km',
      lat: 4.2, lon: 96.5, radiusKm: 37, mag: 4.6, time: t(300), source: 'Sample data' },
  ];
}
