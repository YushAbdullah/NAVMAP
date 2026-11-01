// Light gamification, kept on this device only: points and badges for helping others.
const KEY = 'navmap.score';

export const BADGES = [
  { id: 'explorer', icon: '🧭', en: 'Explorer', bm: 'Penjelajah', enHint: 'Opened Play view', bmHint: 'Buka paparan Main' },
  { id: 'firstPin', icon: '📍', en: 'First pin', bm: 'Pin pertama', enHint: 'Pinned your first hazard', bmHint: 'Pin bahaya pertama anda' },
  { id: 'watcher', icon: '👀', en: 'Road watcher', bm: 'Pemerhati jalan', enHint: 'Pinned 5 hazards', bmHint: 'Pin 5 bahaya' },
  { id: 'hero', icon: '🦸', en: 'Hazard hero', bm: 'Wira bahaya', enHint: 'Pinned 20 hazards', bmHint: 'Pin 20 bahaya' },
  { id: 'traveller', icon: '🚗', en: 'Traveller', bm: 'Pengembara', enHint: 'Started a navigation', bmHint: 'Mula navigasi' },
];

export const POINTS = { pin: 10, nav: 5, explore: 5 };
export const LEVEL_PTS = 50;

export function getScore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { pts: Number(s.pts) || 0, pins: Number(s.pins) || 0, navs: Number(s.navs) || 0, badges: Array.isArray(s.badges) ? s.badges : [] };
  } catch { return { pts: 0, pins: 0, navs: 0, badges: [] }; }
}

export const levelOf = (pts) => Math.floor(pts / LEVEL_PTS) + 1;

// action: 'pin' | 'nav' | 'explore'. Returns { gained, badges: [new badge objects], score }.
export function award(action) {
  const s = getScore();
  let gained = 0;
  if (action === 'pin') { s.pins += 1; gained = POINTS.pin; }
  else if (action === 'nav') { s.navs += 1; gained = POINTS.nav; }
  else if (action === 'explore') { if (s.badges.includes('explorer')) return { gained: 0, badges: [], score: s }; gained = POINTS.explore; }
  s.pts += gained;
  const earned = [];
  const want = (id, ok) => { if (ok && !s.badges.includes(id)) { s.badges.push(id); earned.push(BADGES.find((b) => b.id === id)); } };
  want('explorer', action === 'explore');
  want('firstPin', s.pins >= 1);
  want('watcher', s.pins >= 5);
  want('hero', s.pins >= 20);
  want('traveller', s.navs >= 1);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  return { gained, badges: earned, score: s };
}
