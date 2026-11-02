// Community updates on pins: shared by the app and the /api/pins server so both agree.
// People talk about a pin with short text updates and one-tap status tags. No accounts:
// each device gets a stable nickname made from a hash of its random device code.

export const MAX_TEXT = 200;          // characters in one update
export const MAX_COMMENTS = 60;       // updates kept per pin (oldest drop off)
export const FLAGS_TO_HIDE = 3;       // reports from different devices before an update is hidden

// One-tap status tags. vote = what the tag also counts as on the pin ("Still there" / "Gone").
export const TAGS = [
  { id: 'still', en: 'Still happening', bm: 'Masih berlaku', vote: 'confirm', tone: 'warn' },
  { id: 'worse', en: 'Getting worse', bm: 'Semakin teruk', vote: 'confirm', tone: 'danger' },
  { id: 'better', en: 'Getting better', bm: 'Semakin baik', vote: null, tone: 'ok' },
  { id: 'closed', en: 'Road closed', bm: 'Jalan ditutup', vote: 'confirm', tone: 'danger' },
  { id: 'passable', en: 'Passable with care', bm: 'Boleh lalu, hati-hati', vote: null, tone: 'warn' },
  { id: 'cleared', en: 'All clear', bm: 'Sudah selamat', vote: 'gone', tone: 'ok' },
];
export const TAG_BY_ID = Object.fromEntries(TAGS.map((x) => [x.id, x]));

// Malaysian animals for anonymous nicknames, e.g. "Kancil 42".
const ANIMALS = ['Kancil', 'Harimau', 'Tapir', 'Enggang', 'Penyu', 'Gajah', 'Beruang', 'Seladang', 'Memerang', 'Helang',
  'Pelanduk', 'Monyet', 'Musang', 'Landak', 'Tenggiling', 'Bangau', 'Merak', 'Rusa', 'Kijang', 'Ikan Kelah',
  'Kura-kura', 'Lotong', 'Siamang', 'Belalang'];

/** Nickname from a hex hash of the device code (server side). Same device, same nickname. */
export function handleFrom(hex) {
  const a = parseInt(hex.slice(0, 6), 16), n = parseInt(hex.slice(6, 10), 16);
  return `${ANIMALS[a % ANIMALS.length]} ${10 + (n % 90)}`;
}

// Words masked with *** (English and Malay swearing and slurs). Short and deliberate: the
// Report button and FLAGS_TO_HIDE handle the rest.
const BAD = ['fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'dick', 'pukimak', 'puki', 'lancau', 'pantat',
  'babi', 'bangsat', 'sial', 'celaka', 'keparat', 'bodoh', 'kimak', 'butoh', 'jubur', 'keling', 'nigger', 'pariah'];
const BAD_RE = new RegExp(`\\b(${BAD.join('|')})\\b`, 'gi');
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|my|net|org|io|ly|co|me|xyz|info|biz)\b|t\.me\/|wa\.me)/i;
const PHONE_RE = /(\d[\s\-.]?){7,}/;

/**
 * Clean an update's text. Returns { text } or { error: 'link' | 'phone' | 'long' }.
 * Links and phone numbers are refused (spam and other people's personal data).
 */
export function cleanText(raw) {
  // eslint-disable-next-line no-control-regex
  const text = String(raw || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_TEXT) return { error: 'long' };
  if (LINK_RE.test(text)) return { error: 'link' };
  if (PHONE_RE.test(text)) return { error: 'phone' };
  return { text: text.replace(BAD_RE, (w) => w[0] + '*'.repeat(w.length - 1)) };
}
