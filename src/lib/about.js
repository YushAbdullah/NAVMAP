// About NAVMAP: who made it, vision and mission, objectives, why it exists, the ecosystem,
// and how it uses public data to solve community problems. English and Bahasa Melayu.
//
// "About me" follows the founder's own site, yushabdullah.github.io. Any text in
// [square brackets] shows as a dashed placeholder box.

import { icon } from './icons.js';

const C = {
  en: {
    title: 'About NAVMAP',
    tagline: 'A free live map for Malaysia that keeps you moving and keeps you safe.',
    meH: 'About me',
    me: [
      "Hi, I'm Yusri Abdullah (Yush Abdullah), the founder of NAVMAP. I'm a product owner and PMO lead in Kuala Lumpur, and I build NAVMAP on my own as an independent Malaysian project.",
      "I started out in public policy. I studied Government and Public Policy, then earned a Master's in Business Management. Since then I have worked in digital marketing, customer operations, HR, public health research and teaching, and today I build people technology products.",
      'Outside work I write books and white papers, speak, train and volunteer, from business planning workshops for young entrepreneurs to leadership training for Indigenous communities. NAVMAP brings that wish to serve the community together with what I do every day: building products people trust.',
    ],
    meLink: 'More about me:',
    visionH: 'Vision',
    vision: 'Every Malaysian can travel safely and confidently, with the right information about the road, the weather and the community around them, free of charge.',
    missionH: 'Mission',
    mission: 'Bring public data, live alerts and what people see on the ground into one simple map, in English and Bahasa Melayu, that works on any phone, even on a weak signal.',
    objH: 'Objectives',
    obj: [
      'Warn people early about floods, storms, haze and earthquakes near them and along their route.',
      'Help people find what they need nearby: fuel, EV charging, food, toilets, surau, hospitals, pharmacies, police, Bomba and relief centres.',
      'Make every trip easier to plan, by car, motorcycle, bus or train, with the time, toll and cost shown up front.',
      'Put emergency help one tap away with the SOS button and verified hotlines.',
      'Let the community share what is happening on the spot, so everyone nearby benefits.',
      'Keep NAVMAP free, light and respectful of privacy: no account needed and no tracking of individuals.',
    ],
    whyH: 'Why NAVMAP was created',
    why: [
      'Every year, monsoon floods, flash floods and haze affect families across Malaysia. Official warnings exist, but they are spread across many websites and apps, and they rarely reach people while they are already on the road.',
      'Popular map apps are great at directions, but they do not tell you that the road ahead is flooded, that the air outside is unhealthy, or where the nearest relief centre is. NAVMAP was created to close that gap: one map that shows the way and the risks together.',
    ],
    ecoH: 'The NAVMAP ecosystem',
    ecoLead: 'NAVMAP connects four things in one place:',
    eco: [
      ['map', 'Map and navigation', 'Search, nearby places, turn-by-turn voice guidance, tolls, bus and train journeys, and ride-hailing hand-off.'],
      ['shield', 'Live safety', 'Official flood, weather and earthquake alerts, rain radar, the pollution index and the SOS button.'],
      ['users', 'Community', 'Pins, updates and discussions from people on the spot, which others confirm or clear.'],
      ['news', 'Information', 'Nature and climate news, weather forecasts and email updates.'],
    ],
    ecoSources: 'Built on open and public data from data.gov.my (MetMalaysia, JPS), OpenStreetMap, Open-Meteo, Copernicus CAMS, RainViewer, Transitous and public news feeds, and on everything our community shares.',
    publicH: 'Using public data to solve community problems',
    public: [
      'Malaysia already publishes a lot of useful public data: flood warnings, weather warnings, transport timetables and more. Most people never see it, because it sits in technical formats on government portals.',
      'NAVMAP turns that public data into plain, timely help. A flood warning becomes a red area on your route and a voice alert while you drive. A weather warning becomes a banner when it is near you. A timetable becomes a bus or train journey you can follow.',
      'Then the community fills the gaps that official data cannot: a fallen tree, a flooded junction, a road that is clear again. Public data plus people on the ground means faster, more local information for everyone.',
    ],
    contactH: 'Get in touch',
    contact: 'Ideas, feedback or want to work together? Email',
    note: 'NAVMAP is not an official warning or emergency service. In an emergency, call 999.',
  },
  bm: {
    title: 'Tentang NAVMAP',
    tagline: 'Peta langsung percuma untuk Malaysia yang memudahkan perjalanan dan menjaga keselamatan anda.',
    meH: 'Tentang saya',
    me: [
      'Hai, saya Yusri Abdullah (Yush Abdullah), pengasas NAVMAP. Saya seorang pemilik produk dan peneraju PMO di Kuala Lumpur, dan saya membina NAVMAP sendiri sebagai projek bebas anak Malaysia.',
      'Saya bermula dalam bidang dasar awam. Saya belajar Kerajaan dan Dasar Awam, kemudian memperoleh Sarjana Pengurusan Perniagaan. Sejak itu saya bekerja dalam pemasaran digital, operasi pelanggan, sumber manusia, penyelidikan kesihatan awam dan pengajaran, dan kini saya membina produk teknologi sumber manusia.',
      'Di luar kerja, saya menulis buku dan kertas putih, berucap, melatih dan menjadi sukarelawan, daripada bengkel perancangan perniagaan untuk usahawan muda hingga latihan kepimpinan untuk komuniti Orang Asli. NAVMAP menggabungkan keinginan untuk berkhidmat kepada komuniti dengan apa yang saya lakukan setiap hari: membina produk yang dipercayai orang.',
    ],
    meLink: 'Lebih lanjut tentang saya:',
    visionH: 'Visi',
    vision: 'Setiap rakyat Malaysia boleh bergerak dengan selamat dan yakin, dengan maklumat yang tepat tentang jalan raya, cuaca dan komuniti di sekeliling mereka, secara percuma.',
    missionH: 'Misi',
    mission: 'Menghimpunkan data awam, amaran langsung dan apa yang dilihat orang di lokasi ke dalam satu peta yang mudah, dalam Bahasa Melayu dan Inggeris, yang berfungsi pada mana-mana telefon, walaupun isyarat lemah.',
    objH: 'Objektif',
    obj: [
      'Memberi amaran awal tentang banjir, ribut, jerebu dan gempa bumi berhampiran anda dan di sepanjang laluan anda.',
      'Membantu orang mencari keperluan berdekatan: minyak, pengecas EV, makanan, tandas, surau, hospital, farmasi, polis, Bomba dan pusat pemindahan.',
      'Memudahkan setiap perjalanan, dengan kereta, motosikal, bas atau tren, dengan masa, tol dan kos ditunjukkan lebih awal.',
      'Bantuan kecemasan hanya satu sentuhan dengan butang SOS dan talian yang disahkan.',
      'Membolehkan komuniti berkongsi apa yang berlaku di lokasi, supaya semua orang berdekatan mendapat manfaat.',
      'Mengekalkan NAVMAP percuma, ringan dan menghormati privasi: tiada akaun diperlukan dan tiada penjejakan individu.',
    ],
    whyH: 'Mengapa NAVMAP dicipta',
    why: [
      'Setiap tahun, banjir monsun, banjir kilat dan jerebu menjejaskan keluarga di seluruh Malaysia. Amaran rasmi memang ada, tetapi ia tersebar di banyak laman web dan aplikasi, dan jarang sampai kepada orang yang sudah berada di jalan raya.',
      'Aplikasi peta popular sangat bagus untuk arah perjalanan, tetapi tidak memberitahu bahawa jalan di hadapan banjir, udara di luar tidak sihat, atau di mana pusat pemindahan terdekat. NAVMAP dicipta untuk merapatkan jurang itu: satu peta yang menunjukkan jalan dan risikonya sekali gus.',
    ],
    ecoH: 'Ekosistem NAVMAP',
    ecoLead: 'NAVMAP menghubungkan empat perkara di satu tempat:',
    eco: [
      ['map', 'Peta dan navigasi', 'Carian, tempat berdekatan, panduan suara langkah demi langkah, tol, perjalanan bas dan tren, dan sambungan ke e-hailing.'],
      ['shield', 'Keselamatan langsung', 'Amaran rasmi banjir, cuaca dan gempa bumi, radar hujan, indeks pencemaran dan butang SOS.'],
      ['users', 'Komuniti', 'Pin, kemas kini dan perbincangan daripada orang di lokasi, yang disahkan atau dikosongkan oleh orang lain.'],
      ['news', 'Maklumat', 'Berita alam dan iklim, ramalan cuaca dan kemas kini melalui e-mel.'],
    ],
    ecoSources: 'Dibina atas data terbuka dan awam daripada data.gov.my (MetMalaysia, JPS), OpenStreetMap, Open-Meteo, Copernicus CAMS, RainViewer, Transitous dan suapan berita awam, serta semua yang dikongsi oleh komuniti kami.',
    publicH: 'Menggunakan data awam untuk menyelesaikan masalah komuniti',
    public: [
      'Malaysia sudah menerbitkan banyak data awam yang berguna: amaran banjir, amaran cuaca, jadual pengangkutan dan banyak lagi. Kebanyakan orang tidak pernah melihatnya kerana ia berada dalam format teknikal di portal kerajaan.',
      'NAVMAP menukar data awam itu menjadi bantuan yang mudah dan tepat pada masanya. Amaran banjir menjadi kawasan merah di laluan anda dan amaran suara semasa memandu. Amaran cuaca menjadi sepanduk apabila ia berhampiran anda. Jadual menjadi perjalanan bas atau tren yang boleh anda ikuti.',
      'Kemudian komuniti mengisi ruang yang tidak dapat diisi oleh data rasmi: pokok tumbang, simpang banjir, jalan yang sudah pulih. Data awam ditambah orang di lokasi bermakna maklumat yang lebih pantas dan setempat untuk semua.',
    ],
    contactH: 'Hubungi kami',
    contact: 'Ada idea, maklum balas atau ingin bekerjasama? E-mel',
    note: 'NAVMAP bukan perkhidmatan amaran atau kecemasan rasmi. Dalam kecemasan, hubungi 999.',
  },
};

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Placeholders show up as a dashed box so they are easy to spot and replace.
const para = (s) => (/^\[.*\]$/.test(s) ? `<p class="ab-todo">${esc(s)}</p>` : `<p>${esc(s)}</p>`);

export const aboutTitle = (lang) => C[lang]?.title || C.en.title;

export function aboutHtml(lang) {
  const c = C[lang] || C.en;
  return `<p class="ab-tag">${esc(c.tagline)}</p>
    <section class="ab-sec"><h3>${icon('user')}${esc(c.meH)}</h3>${c.me.map(para).join('')}<p>${esc(c.meLink)} <a href="https://yushabdullah.github.io" target="_blank" rel="noopener">yushabdullah.github.io</a></p></section>
    <section class="ab-sec ab-vm">
      <div><h3>${icon('locate')}${esc(c.visionH)}</h3><p>${esc(c.vision)}</p></div>
      <div><h3>${icon('arrive')}${esc(c.missionH)}</h3><p>${esc(c.mission)}</p></div>
    </section>
    <section class="ab-sec"><h3>${icon('check')}${esc(c.objH)}</h3><ol class="ab-list">${c.obj.map((o) => `<li>${esc(o)}</li>`).join('')}</ol></section>
    <section class="ab-sec"><h3>${icon('heart')}${esc(c.whyH)}</h3>${c.why.map(para).join('')}</section>
    <section class="ab-sec"><h3>${icon('share')}${esc(c.ecoH)}</h3><p>${esc(c.ecoLead)}</p>
      <div class="ab-eco">${c.eco.map(([ic, h, d]) => `<div>${icon(ic)}<b>${esc(h)}</b><small>${esc(d)}</small></div>`).join('')}</div>
      <p class="muted sm">${esc(c.ecoSources)}</p></section>
    <section class="ab-sec"><h3>${icon('users')}${esc(c.publicH)}</h3>${c.public.map(para).join('')}</section>
    <section class="ab-sec"><h3>${icon('mail')}${esc(c.contactH)}</h3><p>${esc(c.contact)} <a href="mailto:muhdyusry.abdullah@gmail.com">muhdyusry.abdullah@gmail.com</a></p></section>
    <p class="source">${esc(c.note)}</p>`;
}
