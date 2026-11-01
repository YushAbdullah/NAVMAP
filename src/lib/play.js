// "Play" map style: a bright, blocky, toy-like look for the base map.
// Chunky stepped 3D buildings in candy colours, grass-green land, bold roads and water,
// and a tilted camera. Everything changed here is remembered and put back on exit.

const saved = new Map(); // `${layerId}|${kind}|${prop}` -> original value

function setP(map, id, prop, value) {
  const key = `${id}|p|${prop}`;
  if (!saved.has(key)) saved.set(key, map.getPaintProperty(id, prop));
  map.setPaintProperty(id, prop, value);
}
function setL(map, id, prop, value) {
  const key = `${id}|l|${prop}`;
  if (!saved.has(key)) saved.set(key, map.getLayoutProperty(id, prop));
  map.setLayoutProperty(id, prop, value);
}

const TOYS = ['#FF5A5F', '#FFB627', '#3DA5FF', '#8A6CFF', '#2EC4B6', '#FF7EB6'];

// Stepped heights: real heights rounded up to whole 6 m "blocks", at least two blocks.
const BLOCK = 6;
const height = ['*', BLOCK, ['max', 2, ['ceil', ['/', ['coalesce', ['get', 'render_height'], ['get', 'height'], 9], BLOCK]]]];
const base = ['*', BLOCK, ['floor', ['/', ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0], BLOCK]]];
// Colour picked from the building's id (or its size when there is none), so neighbours differ
// but each building keeps the same colour as you pan.
const seed = ['coalesce', ['id'], ['+', ['coalesce', ['get', 'render_height'], 9], ['*', 3, ['coalesce', ['get', 'render_min_height'], 0]]]];
const colour = ['match', ['%', ['round', ['abs', ['to-number', seed, 0]]], TOYS.length],
  0, TOYS[0], 1, TOYS[1], 2, TOYS[2], 3, TOYS[3], 4, TOYS[4], TOYS[5]];

export const PLAY_PITCH = 55;

export function applyPlay(map, on) {
  if (!on) {
    if (map.getLayer('play-buildings')) map.removeLayer('play-buildings');
    for (const [key, v] of saved) {
      const [id, kind, prop] = key.split('|');
      if (!map.getLayer(id)) continue;
      try { kind === 'p' ? map.setPaintProperty(id, prop, v) : map.setLayoutProperty(id, prop, v); } catch { /* ignore */ }
    }
    saved.clear();
    return;
  }
  const layers = map.getStyle().layers;
  let buildingSource = null;
  for (const l of layers) {
    const id = l.id.toLowerCase();
    if (l.source === 'alerts' || l.source === 'routes' || /^(sat|radar-|alert-|route-)/.test(l.id)) continue;
    try {
      if (l.type === 'background') setP(map, l.id, 'background-color', '#8EDB6E');
      else if (l.type === 'fill' && id.includes('water')) setP(map, l.id, 'fill-color', '#36A9F4');
      else if (l.type === 'fill' && /park|wood|forest|grass|landcover|green/.test(id)) setP(map, l.id, 'fill-color', '#5FC453');
      else if (l.type === 'fill' && /landuse|residential/.test(id)) setP(map, l.id, 'fill-color', '#A9E58F');
      else if ((l.type === 'fill' || l.type === 'fill-extrusion') && l['source-layer'] === 'building') {
        buildingSource ||= l.source;
        setL(map, l.id, 'visibility', 'none');
      } else if (l.type === 'line' && id.includes('water')) setP(map, l.id, 'line-color', '#36A9F4');
      else if (l.type === 'line' && /highway|road|street|motorway|trunk|primary|secondary|tertiary|minor|service|path|bridge|tunnel/.test(id)) {
        if (/rail/.test(id)) continue;
        if (id.includes('casing')) setP(map, l.id, 'line-color', '#2B3A4F');
        else if (/motorway|trunk|primary|major/.test(id)) setP(map, l.id, 'line-color', '#FFD23F');
        else setP(map, l.id, 'line-color', '#FFFFFF');
      } else if (l.type === 'symbol') {
        setP(map, l.id, 'text-color', '#1E2A3A');
        setP(map, l.id, 'text-halo-color', '#FFFFFF');
        setP(map, l.id, 'text-halo-width', 2);
      }
    } catch { /* layer without that property */ }
  }
  if (!buildingSource) {
    buildingSource = Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
  }
  if (buildingSource && !map.getLayer('play-buildings')) {
    const below = layers.find((l) => l.type === 'symbol' || /^(radar-|alert-|route-)/.test(l.id))?.id;
    map.addLayer({
      id: 'play-buildings', type: 'fill-extrusion', source: buildingSource, minzoom: 13,
      ...(map.getSource(buildingSource)?.type === 'vector' ? { 'source-layer': 'building' } : {}),
      paint: {
        'fill-extrusion-color': colour,
        'fill-extrusion-height': height,
        'fill-extrusion-base': base,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    }, below);
  }
}
