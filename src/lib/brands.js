// Brand logos for chain places (fast food, fuel, pharmacies). OpenStreetMap tags chains with brand:wikidata;
// the weekly data build looks up each brand's logo on Wikidata (Wikimedia Commons file names)
// and writes public/data/poi/brands.json as { Q-id: { n: name, f: file } }.
export const LOGO_CATS = ['food', 'fuel', 'pharmacy'];

/** Commons thumbnail for a file name, at a small width. */
export const logoUrl = (file, width = 64) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`;

/** Look up logos on Wikidata, 50 ids per request. Prefers "small logo" (P8972), then "logo image" (P154). */
export async function fetchBrandLogos(ids, fetchImpl = fetch) {
  const out = {};
  const list = [...new Set(ids)].filter((q) => /^Q\d+$/.test(q));
  for (let i = 0; i < list.length; i += 50) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Clabels&languages=en%7Cms&ids=${list.slice(i, i + 50).join('%7C')}`;
    const r = await fetchImpl(url, { headers: { 'user-agent': 'NAVMAP data build (https://github.com/YushAbdullah/NAVMAP)' } });
    if (!r.ok) throw new Error(`wikidata ${r.status}`);
    const j = await r.json();
    for (const [id, e] of Object.entries(j.entities || {})) {
      const claim = (p) => e.claims?.[p]?.find((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue?.value)?.mainsnak.datavalue.value;
      const file = claim('P8972') || claim('P154');
      if (typeof file === 'string' && /\.(svg|png|jpe?g|webp)$/i.test(file)) {
        out[id] = { n: e.labels?.en?.value || e.labels?.ms?.value || '', f: file };
      }
    }
  }
  return out;
}
