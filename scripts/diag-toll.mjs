// Temporary diagnostic: what OSRM and Overpass say about tolls for KL -> Shah Alam Stadium.
const from = [101.6869, 3.1390], to = [101.5440, 3.0806];
const OSRM = 'https://router.project-osrm.org';
const route = async (q) => (await (await fetch(`${OSRM}/route/v1/driving/${q}?overview=false&steps=true&alternatives=true`)).json());
const show = (j, tag) => {
  console.log(`== ${tag}: code=${j.code} msg=${j.message || ''}`);
  for (const r of j.routes || []) {
    const steps = r.legs.flatMap((l) => l.steps);
    const classes = new Set(steps.flatMap((s) => (s.intersections || []).flatMap((i) => i.classes || [])));
    const tollKm = steps.filter((s) => (s.intersections || []).some((i) => i.classes?.includes('toll'))).reduce((a, s) => a + s.distance / 1000, 0);
    const refs = [...new Set(steps.map((s) => `${s.ref || ''}|${s.name}`).filter((x) => x !== '|'))];
    console.log(`  ${Math.round(r.duration / 60)} min ${Math.round(r.distance / 1000)} km classes=${[...classes]} tollKm=${tollKm.toFixed(1)}`);
    console.log(`  roads: ${refs.slice(0, 25).join(' ; ')}`);
  }
};
show(await route(`${from.join(',')};${to.join(',')}`), 'normal');
show(await (await fetch(`${OSRM}/route/v1/driving/${from.join(',')};${to.join(',')}?overview=false&steps=true&exclude=toll`)).json(), 'exclude=toll');
const ov = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:25];way[toll=yes][highway~"^(motorway|trunk)$"](around:12000,3.11,101.615);out tags center 400;` }) });
const oj = await ov.json().catch(() => ({ elements: [] }));
console.log(`== overpass toll ways: ${oj.elements?.length} remark=${oj.remark || ''}`);
const names = {}; for (const e of oj.elements || []) { const k = `${e.tags.ref || ''} ${e.tags.name || ''}`; names[k] = (names[k] || 0) + 1; }
console.log(Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 30));
const ov2 = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:25];way[highway=motorway](around:12000,3.11,101.615);out tags 400;` }) });
const oj2 = await ov2.json().catch(() => ({ elements: [] }));
const t2 = {}; for (const e of oj2.elements || []) { const k = `${e.tags.ref || ''} ${e.tags.name || ''} toll=${e.tags.toll || '-'}`; t2[k] = (t2[k] || 0) + 1; }
console.log('== motorways near trip:', Object.entries(t2).sort((a, b) => b[1] - a[1]).slice(0, 40));
// try a via point on NKVE near Subang / Kota Damansara
for (const via of [[101.585, 3.135], [101.62, 3.12], [101.56, 3.06]]) show(await route(`${from.join(',')};${via.join(',')};${to.join(',')}`), `via ${via}`);
