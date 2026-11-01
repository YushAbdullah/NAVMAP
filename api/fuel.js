// Vercel serverless function: GET /api/fuel
// Latest Malaysian pump prices (RM per litre) from the weekly data.gov.my fuel price dataset.
// Prices change on Wednesdays, so a 6-hour edge cache is plenty.
const URL = 'https://api.data.gov.my/data-catalogue?id=fuelprice&sort=-date&limit=6';

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export default async function handler(req, res) {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`data.gov.my ${r.status}`);
    const rows = await r.json();
    const row = (Array.isArray(rows) ? rows : rows.data || []).find((x) => !x.series_type || x.series_type === 'level');
    if (!row) throw new Error('no price row');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({
      date: row.date || '',
      ron95: num(row.ron95),
      budi95: num(row.ron95_budi95 ?? row.ron95_subsidised ?? row.budi95),
      ron97: num(row.ron97),
      diesel: num(row.diesel),
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err?.message || err) });
  }
}
