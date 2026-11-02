// First-visit welcome: a few short swipeable cards that explain what NAVMAP is and why it
// exists. Shown once per device (localStorage `navmap.welcomed`), skippable, and reopenable
// from About NAVMAP or the #welcome link. Wording follows the About page and launch copy.

import { icon } from './icons.js';

const KEY = 'navmap.welcomed';
export const welcomed = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
export const markWelcomed = () => { try { localStorage.setItem(KEY, new Date().toISOString().slice(0, 10)); } catch { /* ignore */ } };

/** Already running from the home screen (installed PWA or Play app)? */
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const C = {
  en: {
    skip: 'Skip', next: 'Next', back: 'Back', start: 'Start exploring', install: 'Add to Home Screen', of: 'of',
    cards: [
      { ic: 'map', h: 'Welcome to NAVMAP', p: 'A free live map for Malaysia that keeps you moving and keeps you safe.',
        why: 'Floods and haze hit families every year, but official warnings are spread across many sites and rarely reach you on the road. NAVMAP shows the way and the risks together, on one map.',
        tags: ['Free', 'No account needed', 'English & BM'] },
      { ic: 'flood', h: 'Live alerts near you', p: 'Official flood, storm, haze and earthquake alerts from MetMalaysia and JPS, right on the map.',
        list: [['radar', 'Rain radar and weather forecast'], ['mask', 'Air pollution level, with mask and pharmacy tips'], ['weather', 'A banner when a warning is near you']] },
      { ic: 'nav', h: 'Safer journeys', p: 'Plan any trip by car, motorcycle, bus or train, and see what is ahead before you leave.',
        list: [['car', 'Toll or no-toll, with fuel cost for the trip'], ['flood', 'Hazards on your route, with a voice warning'], ['bus', 'Real bus and train timetables, plus Grab links']] },
      { ic: 'users', h: 'Updates from the community', p: 'People on the spot share what they see: a flooded junction, a fallen tree, a road that is clear again.',
        list: [['pin', 'Drop a pin in a few taps, no account needed'], ['check', 'Others confirm it or mark it cleared'], ['chat', 'Ask a question and get local answers']] },
      { ic: 'phone', h: 'Help in one tap', p: 'The red SOS button calls 999 or 112 and shows your location to read out to the operator.',
        list: [['hospital', 'Nearest hospital, police, Bomba and relief centre'], ['workshop', 'Car trouble hotlines and workshops nearby']],
        note: 'NAVMAP is not an official warning or emergency service. In an emergency, call 999.' },
      { ic: 'home', h: 'Keep NAVMAP one tap away', p: 'No download needed. Add it to your home screen and it opens like an app, even on a weak signal.',
        ios: ['Tap the Share button in Safari', 'Choose “Add to Home Screen”', 'Tap Add'],
        android: ['Tap the ⋮ menu in Chrome', 'Choose “Add to Home screen” or “Install app”', 'Tap Add or Install'],
        installed: 'You are already using NAVMAP from your home screen. You are all set!' },
    ],
  },
  bm: {
    skip: 'Langkau', next: 'Seterusnya', back: 'Kembali', start: 'Mula meneroka', install: 'Tambah ke Skrin Utama', of: 'daripada',
    cards: [
      { ic: 'map', h: 'Selamat datang ke NAVMAP', p: 'Peta langsung percuma untuk Malaysia yang memudahkan perjalanan dan menjaga keselamatan anda.',
        why: 'Banjir dan jerebu menjejaskan keluarga setiap tahun, tetapi amaran rasmi tersebar di banyak laman dan jarang sampai kepada anda di jalan raya. NAVMAP menunjukkan jalan dan risikonya sekali gus, dalam satu peta.',
        tags: ['Percuma', 'Tiada akaun diperlukan', 'BM & Inggeris'] },
      { ic: 'flood', h: 'Amaran langsung berhampiran anda', p: 'Amaran rasmi banjir, ribut, jerebu dan gempa bumi daripada MetMalaysia dan JPS, terus di peta.',
        list: [['radar', 'Radar hujan dan ramalan cuaca'], ['mask', 'Tahap pencemaran udara, dengan tip pelitup muka dan farmasi'], ['weather', 'Sepanduk apabila amaran berhampiran anda']] },
      { ic: 'nav', h: 'Perjalanan lebih selamat', p: 'Rancang perjalanan dengan kereta, motosikal, bas atau tren, dan lihat apa yang menanti sebelum bertolak.',
        list: [['car', 'Ikut tol atau elak tol, dengan kos minyak perjalanan'], ['flood', 'Bahaya di laluan anda, dengan amaran suara'], ['bus', 'Jadual bas dan tren sebenar, serta pautan Grab']] },
      { ic: 'users', h: 'Kemas kini daripada komuniti', p: 'Orang di lokasi berkongsi apa yang mereka lihat: simpang banjir, pokok tumbang, jalan yang sudah pulih.',
        list: [['pin', 'Letak pin dengan beberapa sentuhan, tanpa akaun'], ['check', 'Orang lain mengesahkan atau menandakannya sudah pulih'], ['chat', 'Tanya soalan dan dapatkan jawapan setempat']] },
      { ic: 'phone', h: 'Bantuan satu sentuhan', p: 'Butang SOS merah menghubungi 999 atau 112 dan menunjukkan lokasi anda untuk dibacakan kepada operator.',
        list: [['hospital', 'Hospital, polis, Bomba dan pusat pemindahan terdekat'], ['workshop', 'Talian bantuan kereta rosak dan bengkel berdekatan']],
        note: 'NAVMAP bukan perkhidmatan amaran atau kecemasan rasmi. Dalam kecemasan, hubungi 999.' },
      { ic: 'home', h: 'Simpan NAVMAP di skrin utama', p: 'Tak perlu muat turun. Tambah ke skrin utama dan ia dibuka seperti aplikasi, walaupun isyarat lemah.',
        ios: ['Tekan butang Kongsi di Safari', 'Pilih “Tambah ke Skrin Utama”', 'Tekan Tambah'],
        android: ['Tekan menu ⋮ di Chrome', 'Pilih “Tambah ke skrin utama” atau “Pasang aplikasi”', 'Tekan Tambah atau Pasang'],
        installed: 'Anda sudah menggunakan NAVMAP dari skrin utama. Semuanya sedia!' },
    ],
  },
};

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const welcomeText = (lang) => C[lang] || C.en;

function card(c, i, n, o) {
  let body = '';
  if (c.why) body += `<p class="wl-why">${esc(c.why)}</p>`;
  if (c.tags) body += `<div class="wl-tags">${c.tags.map((x) => `<span>${icon('check')}${esc(x)}</span>`).join('')}</div>`;
  if (c.list) body += `<ul class="wl-list">${c.list.map(([ic, x]) => `<li>${icon(ic)}<span>${esc(x)}</span></li>`).join('')}</ul>`;
  if (c.ios) {
    if (o.standalone) body += `<p class="wl-done">${icon('check')}${esc(c.installed)}</p>`;
    else {
      if (o.canInstall) body += `<button class="btn wl-install" data-wl="install">${icon('home')}${esc(o.t.install)}</button>`;
      body += `<ol class="wl-steps">${(o.ios ? c.ios : c.android).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
    }
  }
  if (c.note) body += `<p class="wl-note">${esc(c.note)}</p>`;
  return `<section class="wl-card" role="group" aria-roledescription="slide" aria-label="${i + 1} ${esc(o.t.of)} ${n}">
    <div class="wl-hero ${c.ic === 'phone' ? 'sos' : ''}">${icon(c.ic)}</div>
    <h2${i === 0 ? ' id="welcome-title"' : ''}>${esc(c.h)}</h2><p class="wl-lead">${esc(c.p)}</p>${body}</section>`;
}

/** The welcome cards. `canInstall` = the browser offered its own install prompt. */
export function welcomeHtml(lang, { canInstall = false } = {}) {
  const t = welcomeText(lang);
  const o = { t, canInstall, standalone: standalone(), ios: ios() };
  const n = t.cards.length;
  return `<div class="wl-track" id="wl-track">${t.cards.map((c, i) => card(c, i, n, o)).join('')}</div>`;
}
