// Outline icons (24px grid, stroke-based). Returns inline SVG strings.
const P = {
  ev: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  fuel: '<path d="M3 22V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v18M3 22h11M3 10h11M14 8h2a2 2 0 0 1 2 2v7a2 2 0 0 0 4 0V8l-3-3"/>',
  food: '<path d="M4 10a8 5 0 0 1 16 0zM3 14h18M5 18h14a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3z"/>',
  toilet: '<circle cx="7" cy="4" r="1.6"/><circle cx="17" cy="4" r="1.6"/><path d="M5 8h4l1 7H8v6M7 15v6M15 8h4l2 8h-3v5M16 16v5"/>',
  surau: '<path d="M12 2v3M5 21V11a7 7 0 0 1 14 0v10M3 21h18M10 21v-4a2 2 0 0 1 4 0v4"/>',
  hospital: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  flood: '<path d="M2 16c2 0 2-1.5 4-1.5S8 16 10 16s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M12 3v8"/><path d="M9 8l3 3 3-3"/>',
  weather: '<path d="M7 17a5 5 0 1 1 1-9.9A6 6 0 0 1 19 9a4 4 0 0 1-1 8z"/><path d="m12 13-2 4h4l-2 4"/>',
  quake: '<path d="M2 12h4l2-6 3 12 3-9 2 5 2-2h4"/>',
  haze: '<path d="M3 8h13a3 3 0 1 0-3-3M3 12h17a3 3 0 1 1-3 3M3 16h9"/>',
  report: '<path d="M4 21V4h12l-1.5 4L16 12H4"/>',
  accident: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  landslide: '<path d="M3 20h18L14 6l-3 5-2-2z"/><circle cx="17" cy="16" r="1"/><circle cx="13" cy="17" r="1"/>',
  tree: '<path d="M12 22v-6M8 16h8l-4-6 3 0-3-6-3 6h3z"/>',
  jam: '<rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 9l2-4h8l2 4M7 17v2M17 17v2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  nav: '<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  straight: '<path d="M12 20V4M6 10l6-6 6 6"/>',
  left: '<path d="M18 20v-7a3 3 0 0 0-3-3H5M10 5 5 10l5 5"/>',
  right: '<path d="M6 20v-7a3 3 0 0 1 3-3h10M14 5l5 5-5 5"/>',
  uturn: '<path d="M9 20V9a5 5 0 0 1 10 0v4M5 16l4 4 4-4"/>',
  roundabout: '<circle cx="12" cy="10" r="4"/><path d="M12 14v7M16 10h4M17 5l3 0 0 3"/>',
  arrive: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};
export const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[name] || P.pin}</svg>`;

export function maneuverIcon(s) {
  if (s.type === 'arrive') return icon('arrive');
  if (s.type === 'roundabout' || s.type === 'rotary') return icon('roundabout');
  if (s.modifier === 'uturn') return icon('uturn');
  if (s.modifier.includes('left')) return icon('left');
  if (s.modifier.includes('right')) return icon('right');
  return icon('straight');
}
