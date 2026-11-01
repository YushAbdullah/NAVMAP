// Voice packs for spoken navigation: standard EN/BM, Malaysian dialect styles, Tamil, Mandarin and Cantonese.
// Browsers have no dialect voices, so the dialect packs are written in dialect and read by a Malay voice.
// Each pack builds every spoken line; road and place names are kept as they are.
import { stepText } from './routing.js';

const roundKm = (m) => { const km = Math.round(m / 100) / 10; return km % 1 === 0 ? km.toFixed(0) : String(km); };
const roundM = (m) => Math.max(50, m >= 300 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50);
/** Spoken distance with the pack's units, e.g. ['metres', 'kilometres'] or ['米', '公里']. */
const distWith = ([mUnit, kmUnit, kmOne = kmUnit], gap = ' ') => (m) => {
  if (m >= 950) { const km = roundKm(m); return `${km}${gap}${km === '1' ? kmOne : kmUnit}`; }
  return `${roundM(m)}${gap}${mUnit}`;
};
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------- English and standard BM
const en = {
  dist: distWith(['metres', 'kilometres', 'kilometre']),
  step: (s) => stepText(s, 'en'),
  inDist: (d, text) => `In ${d}, ${lower(text)}`,
  start: 'Starting navigation.',
  arrived: 'You have arrived',
  reroute: 'Rerouting',
  hazFar: (title, d) => `Warning: ${title} ${d} ahead.`,
  hazNear: (title, moto) => `${title} ahead. Slow down and ${moto ? 'ride' : 'drive'} carefully.`,
  haze: (n, moto) => `Haze on this route, pollution index ${n}. ${moto ? 'Wear a mask and close your visor.' : 'Close the windows and set the air con to recirculate.'}`,
  weather: (states) => `Weather warning for ${states} on this route.`,
  sample: 'In 500 metres, turn left onto Jalan Tun Razak.',
};

const bm = {
  dist: distWith(['meter', 'kilometer']),
  step: (s) => stepText(s, 'bm'),
  inDist: (d, text) => `Dalam ${d}, ${lower(text)}`,
  start: 'Mula navigasi.',
  arrived: 'Anda telah tiba',
  reroute: 'Mengira semula laluan',
  hazFar: (title, d) => `Amaran: ${title}, ${d} di hadapan.`,
  hazNear: (title, moto) => `${title} di hadapan. Perlahan dan ${moto ? 'tunggang' : 'pandu'} dengan berhati-hati.`,
  haze: (n, moto) => `Jerebu di laluan ini, indeks pencemaran ${n}. ${moto ? 'Pakai pelitup muka dan tutup visor.' : 'Tutup tingkap dan guna edaran semula udara.'}`,
  weather: (states) => `Amaran cuaca untuk ${states} di laluan ini.`,
  sample: 'Dalam 500 meter, belok kiri ke Jalan Tun Razak.',
};

// ---------------------------------------------------------------- Malay dialect styles
// One builder, with each dialect's own words. `w.turn(dir)` gives "turn <dir>", `w.onto` joins a road name.
function dialect(w) {
  const road = (s) => (s.name ? ` ${w.onto} ${s.name}` : '');
  const dir = (m) => ({
    left: w.left, right: w.right,
    'slight left': `${w.slight} ${w.left}`, 'slight right': `${w.slight} ${w.right}`,
    'sharp left': `${w.sharp} ${w.left}`, 'sharp right': `${w.sharp} ${w.right}`,
  }[m] || '');
  const step = (s) => {
    switch (s.type) {
      case 'depart': return `${w.depart}${s.name ? ` ${w.at} ${s.name}` : ''}`;
      case 'arrive': return w.arrived;
      case 'roundabout': case 'rotary': return `${w.roundabout} ${s.exit || ''}${road(s)}`;
      case 'merge': return `${w.merge}${road(s)}`;
      case 'on ramp': return `${w.onRamp}${road(s)}`;
      case 'off ramp': return `${w.offRamp}${road(s)}`;
      case 'fork': return `${w.fork} ${dir(s.modifier) || w.straightWord}${road(s)}`;
      case 'continue': case 'new name': return `${w.cont}${road(s)}`;
      default:
        if (s.modifier === 'straight') return `${w.straight}${road(s)}`;
        if (s.modifier === 'uturn') return `${w.uturn}${road(s)}`;
        return `${w.turn(dir(s.modifier))}${road(s)}`;
    }
  };
  return {
    dist: distWith(['meter', 'kilometer']),
    step,
    inDist: (d, text) => `${w.inDist(d)}, ${lower(text)}`,
    start: w.start, arrived: w.arrived, reroute: w.reroute,
    hazFar: w.hazFar, hazNear: w.hazNear, haze: w.haze, weather: w.weather,
    sample: `${w.start} ${w.inDist('500 meter')}, ${lower(w.turn(w.left))} ${w.onto} Jalan Tun Razak.`,
  };
}

// Kelantan: final -an becomes -e (jalan → jale, kanan → kane, depan → depe), final -a becomes -o (jaga → jago).
const kelantan = dialect({
  left: 'kiri', right: 'kane', slight: 'sikit ke', sharp: 'tajam ke', straightWord: 'terus',
  onto: 'masuk', at: 'kat', turn: (d) => `Belok ${d}`, straight: 'Gi terus', uturn: 'Pusing U',
  depart: 'Kito gerak doh', roundabout: 'Masuk bulate, ambik susur', merge: 'Masuk jale',
  onRamp: 'Ambik susur masuk', offRamp: 'Ambik susur keluar', fork: 'Kat simpang, ikut', cont: 'Jale terus',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom gi! Kito mulo jale.', arrived: 'Sampai doh! Demo doh sampai.',
  reroute: 'Salah jale ni, tunggu sat, kito cari jale lain.',
  hazFar: (title, d) => `Jago-jago, ado ${title}, lagi ${d} depe tu.`,
  hazNear: (title) => `${title} depe ni. Pelahe sikit, jago-jago.`,
  haze: (n, moto) => `Jerebu kat jale ni, indeks pencemare ${n}. ${moto ? 'Pakai topeng, tutup visor.' : 'Tutup tingkap, pasang aircond edar balik.'}`,
  weather: (states) => `Ado amare cuaco untuk ${states} kat jale ni.`,
});

// Terengganu: final -an becomes -ang (jalan → jalang, kanan → kanang), "mung" for you, "lening" for now.
const terengganu = dialect({
  left: 'kiri', right: 'kanang', slight: 'sikit ke', sharp: 'tajang ke', straightWord: 'terus',
  onto: 'masuk', at: 'kak', turn: (d) => `Belok ${d}`, straight: 'Gi terus', uturn: 'Pusing U',
  depart: 'Kite gerak lening', roundabout: 'Masuk bulatang, ambik susur', merge: 'Masuk jalang',
  onRamp: 'Ambik susur masuk', offRamp: 'Ambik susur keluar', fork: 'Kak simpang, ikut', cont: 'Jalang terus',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom gi! Kite jalang lening.', arrived: 'Doh sampai doh! Mung doh sampai.',
  reroute: 'Salah jalang ning, tunggu kejap, kite cari jalang lain.',
  hazFar: (title, d) => `Jage-jage, ade ${title}, lagi ${d} kak depang.`,
  hazNear: (title) => `${title} kak depang ning. Pelahang sikit, jage-jage.`,
  haze: (n, moto) => `Jerebu kak jalang ning, indeks pencemarang ${n}. ${moto ? 'Pakai topeng, tutup visor.' : 'Tutup tingkap, pasang aircond edar balik.'}`,
  weather: (states) => `Ade amarang cuace untuk ${states} kak jalang ning.`,
});

// Utara (Kedah, Penang, Perlis): "hang" for you, "pi" for go, "sat" for a moment, -s becomes -ih (terus → teruih),
// final -r becomes a throaty -q (keluar → kluaq).
const utara = dialect({
  left: 'kiri', right: 'kanan', slight: 'sikit ke', sharp: 'tajam ke', straightWord: 'teruih',
  onto: 'masuk', at: 'kat', turn: (d) => `Belok ${d}`, straight: 'Pi teruih', uturn: 'Pusing U',
  depart: 'Kita gerak', roundabout: 'Masuk bulatan, ambik susur', merge: 'Masuk',
  onRamp: 'Ambik susur masuk', offRamp: 'Ambik susur kluaq', fork: 'Kat simpang, ikut', cont: 'Jalan teruih',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom pi! Kita jalan la ni.', arrived: 'Sampai dah! Hang dah sampai.',
  reroute: 'Salah jalan ni, sat no, cek cari jalan lain.',
  hazFar: (title, d) => `Jaga-jaga, ada ${title}, lagi ${d} kat depan.`,
  hazNear: (title) => `${title} kat depan ni. Pelan-pelan sikit, jaga-jaga.`,
  haze: (n, moto) => `Jerebu kat jalan ni, indeks pencemaran ${n}. ${moto ? 'Pakai topeng, tutup visor.' : 'Tutup tingkap, pasang aircond edaq balik.'}`,
  weather: (states) => `Ada amaran cuaca untuk ${states} kat jalan ni.`,
});

// Negeri Sembilan: final -a becomes -o (ada → ado, jaga → jago), "kek" for at, "den" for I, "ekau" for you.
const n9 = dialect({
  left: 'kiri', right: 'kanan', slight: 'sikit ke', sharp: 'tajam ke', straightWord: 'lurus',
  onto: 'masuk', at: 'kek', turn: (d) => `Belok ${d}`, straight: 'Jalan lurus', uturn: 'Pusing U',
  depart: 'Kito gerak', roundabout: 'Masuk bulatan, ambik susur', merge: 'Masuk',
  onRamp: 'Ambik susur masuk', offRamp: 'Ambik susur keluar', fork: 'Kek simpang, ikut', cont: 'Jalan lurus',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom kito jalan!', arrived: 'Dah sampai dah! Ekau dah sampai.',
  reroute: 'Salah jalan ni, tunggu kojap, den cari jalan lain.',
  hazFar: (title, d) => `Jago-jago, ado ${title}, lagi ${d} kek depan.`,
  hazNear: (title) => `${title} kek depan ni. Bawak elok-elok, perlahan sikit.`,
  haze: (n, moto) => `Jerebu kek jalan ni, indeks pencemaran ${n}. ${moto ? 'Pakai topeng, tutup visor.' : 'Tutup tingkap, pasang aircond edar balik.'}`,
  weather: (states) => `Ado amaran cuaco untuk ${states} kek jalan ni.`,
});

// Sabah: "bah" particle, "sia" for I, "pigi" for go, "ati-ati" for careful.
const sabah = dialect({
  left: 'kiri', right: 'kanan', slight: 'sikit ke', sharp: 'tajam ke', straightWord: 'trus',
  onto: 'masuk', at: 'di', turn: (d) => `Belok ${d}`, straight: 'Jalan trus saja', uturn: 'Pusing U',
  depart: 'Kita pigi sudah', roundabout: 'Masuk bulatan, ambil susur', merge: 'Masuk',
  onRamp: 'Ambil susur masuk', offRamp: 'Ambil susur keluar', fork: 'Di simpang, ikut', cont: 'Jalan trus',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom bah, kita jalan sudah!', arrived: 'Sampai sudah bah!',
  reroute: 'Salah jalan ni, tunggu kejap, sia cari jalan lain.',
  hazFar: (title, d) => `Ati-ati, ada ${title}, lagi ${d} di depan.`,
  hazNear: (title) => `${title} di depan sana. Pelan-pelan saja bah, ati-ati.`,
  haze: (n, moto) => `Ada jerebu di jalan ni, indeks pencemaran ${n}. ${moto ? 'Pakai topeng, tutup visor bah.' : 'Tutup tingkap, kasi aircond pusing balik udara.'}`,
  weather: (states) => `Ada amaran cuaca untuk ${states} di jalan ni bah.`,
});

// Sarawak: "kitak" for you, "kamek" for I, "kinek" for now, "sik" for not, "carik" for look for.
const sarawak = dialect({
  left: 'kiri', right: 'kanan', slight: 'sikit ke', sharp: 'tajam ke', straightWord: 'terus',
  onto: 'masuk', at: 'di', turn: (d) => `Belok ${d}`, straight: 'Jalan terus', uturn: 'Pusing U',
  depart: 'Kitak gerak kinek', roundabout: 'Masuk bulatan, ambik susur', merge: 'Masuk',
  onRamp: 'Ambik susur masuk', offRamp: 'Ambik susur keluar', fork: 'Di simpang, ikut', cont: 'Jalan terus',
  inDist: (d) => `Lagi ${d}`,
  start: 'Jom kita bejalan kinek!', arrived: 'Dah sampai kitak!',
  reroute: 'Salah jalan tok, nanti kejap, kamek carik jalan lain.',
  hazFar: (title, d) => `Ati-ati, ada ${title}, lagi ${d} di depan.`,
  hazNear: (title) => `${title} di depan tok. Bawak pelan-pelan, ati-ati.`,
  haze: (n, moto) => `Ada jerebu di jalan tok, indeks pencemaran ${n}. ${moto ? 'Pakai topeng, tutup visor.' : 'Tutup tingkap, pasang aircond edar balik.'}`,
  weather: (states) => `Ada amaran cuaca untuk ${states} di jalan tok.`,
});

// ---------------------------------------------------------------- Tamil
const taDir = { left: 'இடது பக்கம்', right: 'வலது பக்கம்', 'slight left': 'சற்று இடது பக்கம்', 'slight right': 'சற்று வலது பக்கம்', 'sharp left': 'கூர்மையாக இடது பக்கம்', 'sharp right': 'கூர்மையாக வலது பக்கம்' };
const taRoad = (s) => (s.name ? `${s.name} நோக்கி ` : '');
const ta = {
  dist: distWith(['மீட்டர்', 'கிலோமீட்டர்']),
  step: (s) => {
    const d = taDir[s.modifier] || '';
    switch (s.type) {
      case 'depart': return `${s.name ? `${s.name} வழியாக ` : ''}புறப்படுங்கள்`;
      case 'arrive': return 'நீங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்';
      case 'roundabout': case 'rotary': return `சுற்றுவட்டத்தில் ${s.exit ? `${s.exit}-வது` : 'அடுத்த'} வெளியேறலை எடுத்து ${taRoad(s)}செல்லுங்கள்`;
      case 'merge': return `${taRoad(s)}இணைந்து செல்லுங்கள்`;
      case 'on ramp': return `${taRoad(s)}நுழைவுச் சாலையில் செல்லுங்கள்`;
      case 'off ramp': return `${taRoad(s)}வெளியேறும் சாலையில் செல்லுங்கள்`;
      case 'fork': return `சாலை பிரியும் இடத்தில் ${taRoad(s)}${d || 'நேராக'} செல்லுங்கள்`;
      case 'continue': case 'new name': return `${taRoad(s)}தொடர்ந்து செல்லுங்கள்`;
      default:
        if (s.modifier === 'straight') return `${taRoad(s)}நேராகச் செல்லுங்கள்`;
        if (s.modifier === 'uturn') return `${taRoad(s)}யூ டர்ன் செய்யுங்கள்`;
        return `${taRoad(s)}${d} திரும்புங்கள்`;
    }
  },
  inDist: (d, text) => `${d} தூரத்தில், ${text}`,
  start: 'வழிகாட்டல் தொடங்குகிறது.',
  arrived: 'நீங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்',
  reroute: 'புதிய வழியைக் கணக்கிடுகிறது',
  hazFar: (title, d) => `எச்சரிக்கை: ${d} தூரத்தில் ${title}.`,
  hazNear: (title, moto) => `முன்னால் ${title}. மெதுவாகவும் கவனமாகவும் ${moto ? 'ஓட்டுங்கள்' : 'வாகனம் ஓட்டுங்கள்'}.`,
  haze: (n, moto) => `இந்த வழியில் புகைமூட்டம் உள்ளது, காற்று மாசு குறியீடு ${n}. ${moto ? 'முகக்கவசம் அணிந்து, தலைக்கவசத்தின் கண்ணாடியை மூடுங்கள்.' : 'ஜன்னல்களை மூடி, குளிரூட்டியை உள்சுழற்சியில் வையுங்கள்.'}`,
  weather: (states) => `இந்த வழியில் ${states} பகுதிகளுக்கு வானிலை எச்சரிக்கை உள்ளது.`,
  sample: '500 மீட்டர் தூரத்தில், Jalan Tun Razak நோக்கி இடது பக்கம் திரும்புங்கள்.',
};

// ---------------------------------------------------------------- Chinese: Mandarin (Simplified, as used in Malaysia) and Cantonese
function chinese(w) {
  const road = (s) => (s.name ? `${w.into}${s.name}` : '');
  return {
    dist: distWith([w.m, w.km], ''),
    step: (s) => {
      const d = w.dir[s.modifier] || '';
      switch (s.type) {
        case 'depart': return s.name ? `${w.departOn}${s.name}${w.depart}` : w.depart;
        case 'arrive': return w.arrived;
        case 'roundabout': case 'rotary': return w.roundabout(s.exit || '', road(s));
        case 'merge': return `${w.merge}${s.name || ''}`;
        case 'on ramp': return `${w.onRamp}${road(s)}`;
        case 'off ramp': return `${w.offRamp}${road(s)}`;
        case 'fork': return `${w.fork}${w.keep[s.modifier] || w.keep.straight}${road(s)}`;
        case 'continue': case 'new name': return `${w.cont}${road(s)}`;
        default:
          if (s.modifier === 'straight') return `${w.straight}${road(s)}`;
          if (s.modifier === 'uturn') return `${w.uturn}${road(s)}`;
          return `${d}${road(s)}`;
      }
    },
    inDist: w.inDist,
    start: w.start, arrived: w.arrived, reroute: w.reroute,
    hazFar: w.hazFar, hazNear: w.hazNear, haze: w.haze, weather: w.weather,
    sample: w.sample, end: '。',
  };
}

const zh = chinese({
  m: '米', km: '公里', into: '进入',
  dir: { left: '左转', right: '右转', 'slight left': '稍向左转', 'slight right': '稍向右转', 'sharp left': '向左急转', 'sharp right': '向右急转' },
  keep: { left: '靠左', 'slight left': '靠左', 'sharp left': '靠左', right: '靠右', 'slight right': '靠右', 'sharp right': '靠右', straight: '直行' },
  departOn: '沿', depart: '出发', arrived: '您已到达目的地',
  roundabout: (n, road) => `进入圆环，从第${n}个出口驶出${road ? `，${road}` : ''}`,
  merge: '并入', onRamp: '驶上匝道', offRamp: '从出口驶出', fork: '在岔路口', cont: '继续直行', straight: '直行', uturn: '掉头',
  inDist: (d, text) => `${d}后，${text}`,
  start: '开始导航。', reroute: '正在重新规划路线',
  hazFar: (title, d) => `注意：前方${d}有${title}。`,
  hazNear: (title) => `前方${title}，请减速慢行，小心驾驶。`,
  haze: (n, moto) => `这条路线有烟霾，空气污染指数${n}。${moto ? '请戴上口罩，拉下头盔面罩。' : '请关上车窗，把冷气调到内循环。'}`,
  weather: (states) => `这条路线经过的${states}有天气警报。`,
  sample: '500米后，左转进入Jalan Tun Razak。',
});

const yue = chinese({
  m: '米', km: '公里', into: '入',
  dir: { left: '左轉', right: '右轉', 'slight left': '微微靠左', 'slight right': '微微靠右', 'sharp left': '急左轉', 'sharp right': '急右轉' },
  keep: { left: '靠左', 'slight left': '靠左', 'sharp left': '靠左', right: '靠右', 'slight right': '靠右', 'sharp right': '靠右', straight: '直行' },
  departOn: '沿住', depart: '出發', arrived: '到咗目的地喇',
  roundabout: (n, road) => `入圓環，揸第${n}個出口${road ? `，${road}` : ''}`,
  merge: '併入', onRamp: '上斜路', offRamp: '由出口落', fork: '喺分岔路', cont: '繼續直行', straight: '一直行', uturn: '掉頭',
  inDist: (d, text) => `再過${d}，${text}`,
  start: '開始導航，出發啦！', reroute: '重新計緊路線',
  hazFar: (title, d) => `小心，前面${d}有${title}。`,
  hazNear: (title) => `前面有${title}，揸慢啲，小心啲。`,
  haze: (n, moto) => `呢條路有煙霾，空氣污染指數${n}。${moto ? '記得戴口罩，拉低頭盔面罩。' : '閂埋車窗，冷氣較做內循環。'}`,
  weather: (states) => `呢條路經過嘅${states}有天氣警告。`,
  sample: '再過500米，左轉入Jalan Tun Razak。',
});

// ---------------------------------------------------------------- the list shown in the picker
// `tts`: preferred browser voice languages, in order. `base`: which alert text (EN or BM) the pack reads out.
// `needs`: when true, the pack is only used if a matching voice is installed; otherwise speech falls back to EN/BM.
export const VOICE_PACKS = [
  { id: 'auto', group: 'std', name: { en: 'Same as app language', bm: 'Ikut bahasa aplikasi' }, hint: 'EN / BM' },
  { id: 'en', group: 'std', name: { en: 'English', bm: 'Bahasa Inggeris' }, hint: 'English', base: 'en', tts: ['en-MY', 'en-SG', 'en-GB', 'en-US', 'en'], p: en },
  { id: 'bm', group: 'std', name: { en: 'Bahasa Melayu', bm: 'Bahasa Melayu' }, hint: 'Standard', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: bm },
  { id: 'kelantan', group: 'dialect', name: { en: 'Kelantan', bm: 'Kelantan' }, hint: 'Jom gi! Kito mulo jale.', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: kelantan },
  { id: 'terengganu', group: 'dialect', name: { en: 'Terengganu', bm: 'Terengganu' }, hint: 'Kite jalang lening.', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: terengganu },
  { id: 'utara', group: 'dialect', name: { en: 'Utara (Kedah, Penang, Perlis)', bm: 'Utara (Kedah, Pulau Pinang, Perlis)' }, hint: 'Jom pi! Pi teruih.', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: utara },
  { id: 'n9', group: 'dialect', name: { en: 'Negeri Sembilan', bm: 'Negeri Sembilan' }, hint: 'Jom kito jalan!', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: n9 },
  { id: 'sabah', group: 'dialect', name: { en: 'Sabah', bm: 'Sabah' }, hint: 'Jom bah, kita jalan sudah!', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: sabah },
  { id: 'sarawak', group: 'dialect', name: { en: 'Sarawak', bm: 'Sarawak' }, hint: 'Jom kita bejalan kinek!', base: 'bm', tts: ['ms-MY', 'ms', 'id-ID', 'id'], p: sarawak },
  { id: 'ta', group: 'lang', name: { en: 'Tamil', bm: 'Tamil' }, hint: 'தமிழ்', base: 'en', tts: ['ta-MY', 'ta-SG', 'ta-IN', 'ta'], needs: true, p: ta },
  { id: 'zh', group: 'lang', name: { en: 'Chinese (Mandarin)', bm: 'Cina (Mandarin)' }, hint: '华语', base: 'en', tts: ['zh-MY', 'zh-SG', 'zh-CN', 'cmn', 'zh-TW', 'zh'], needs: true, p: zh },
  { id: 'yue', group: 'lang', name: { en: 'Chinese (Cantonese)', bm: 'Cina (Kantonis)' }, hint: '廣東話', base: 'en', tts: ['zh-HK', 'yue-HK', 'yue', 'zh-yue'], needs: true, p: yue },
];

export const packById = (id) => VOICE_PACKS.find((x) => x.id === id) || VOICE_PACKS[0];
export const STD = { en: VOICE_PACKS[1], bm: VOICE_PACKS[2] };
