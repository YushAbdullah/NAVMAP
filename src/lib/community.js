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
// Tags for discussions about a news story: how to handle it, opinions, offers of help.
export const DISCUSS_TAGS = [
  { id: 'tip', en: 'How to handle it', bm: 'Cara menangani', vote: null, tone: 'ok' },
  { id: 'opinion', en: 'My view', bm: 'Pendapat saya', vote: null, tone: 'info' },
  { id: 'question', en: 'Question', bm: 'Soalan', vote: null, tone: 'warn' },
  { id: 'help', en: 'I can help', bm: 'Saya boleh bantu', vote: null, tone: 'ok' },
];
export const TAG_BY_ID = Object.fromEntries([...TAGS, ...DISCUSS_TAGS].map((x) => [x.id, x]));
export const PIN_TAG_IDS = new Set(TAGS.map((x) => x.id));
export const DISCUSS_TAG_IDS = new Set(DISCUSS_TAGS.map((x) => x.id));

// News stories can be discussed only when they come from the feeds the News tab reads.
const NEWS_HOSTS = ['news.google.com', 'malaymail.com', 'thestar.com.my', 'theguardian.com', 'bbc.co.uk', 'bbc.com', 'news.un.org', 'mongabay.com'];
export function newsUrlOk(u) {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && NEWS_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith(`.${h}`));
  } catch { return false; }
}
export const plain = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Member display names: 2..24 characters, no links or phone numbers, nothing that looks official.
const RESERVED = /\b(navmap|admin|moderator|official|rasmi|bomba|polis|police|pdrm|nadma|jkm|apm|metmalaysia|kerajaan|government)\b/i;
export function cleanName(raw) {
  const n = plain(raw, 24);
  if (n.length < 2) return null;
  const c = cleanText(n);
  if (c.error || c.text !== n || RESERVED.test(n)) return null;
  return n;
}

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
