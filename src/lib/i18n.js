const STR = {
  en: {
    gmapsSearch: 'Search on Google Maps', gmapsMore: 'Not listed here?', gmapsPlace: 'Reviews & photos on Google Maps',
    subTitle: 'Get NAVMAP updates', subLead: 'News about new features, safety tips and future NAVMAP campaigns, by email. No spam.', subEmail: 'Email address',
    subConsent: 'I agree that Yush Abdullah (NAVMAP) may store my email address and send me NAVMAP news, updates and future campaigns. I can unsubscribe at any time. See the <a href="/privacy.html" target="_blank">Privacy Policy</a>.',
    subBtn: 'Subscribe', subLink: 'Subscribe', subCard: 'Updates and campaigns by email. Unsubscribe any time.',
    subDone: 'Thank you! You are subscribed.', subFailed: 'Could not subscribe right now. Please try again.', subBadEmail: 'Please enter a valid email address.', subRate: 'Too many tries. Please try again later.',
    subUnsubLink: 'Unsubscribe an email', subUnsubTitle: 'Unsubscribe', subUnsubLead: 'Enter the email address to remove from NAVMAP updates.', subUnsubBtn: 'Unsubscribe', subUnsubDone: 'Done. That email will not receive NAVMAP emails.', subBackLink: 'Back to subscribe',
    tabNews: 'News', newsTitle: 'Nature & climate news', newsLead: 'Live headlines about floods, weather, haze, climate and nature, from Malaysia and around the world.',
    newsLoading: 'Loading the latest news…', newsFailed: 'Could not load the news right now.', newsNone: 'No news for this filter yet.',
    newsLocal: 'Malaysia', newsWorld: 'World', allTopics: 'All topics',
    topic_disaster: 'Disaster', topic_weather: 'Weather', topic_haze: 'Haze & pollution', topic_climate: 'Climate', topic_nature: 'Nature',
    newsSource: 'Headlines from public news feeds (Google News, Malay Mail, The Star, The Guardian, BBC, UN News, Mongabay). Articles open on the publisher\'s site and belong to them. NAVMAP does not check or endorse them.',
    savedHome: 'Home', savedWork: 'Work', setHome: 'Set Home', setWork: 'Set Work', saveAsHome: 'Save as Home', saveAsWork: 'Save as Work', savedAsHome: 'Saved as Home', savedAsWork: 'Saved as Work',
    saveSetTitle: 'Set your {k}', saveUseLoc: 'Use my current location', saveSearch: 'Search an address', saveSearchHint: 'Search for the address above, then tap "Save as {k}".', cancel: 'Cancel', saveRemove: 'Remove', saveChange: 'Change', savedToast: 'Saved as {k} on this phone', removedToast: '{k} removed', saveNoLoc: 'Location not found. Search for the address instead.', savedNote: 'Saved only on this phone.',
    layersTitle: 'Map layers', layerMap: 'Map', layerSat: 'Satellite', layerAlerts: 'Alerts and pins on map',
    statVisitors: 'visitors today', statVisitor: 'visitor today', statPins: 'live pins', statPin: 'live pin',
    copyright: '© 2026 NAVMAP by Yush Abdullah. All rights reserved.', terms: 'Terms of Service', privacy: 'Privacy Policy',
    sosTitle: 'Emergency calls', sosLead: 'In danger? Call 999. Calls are free.', myCoords: 'Your location (read this to the operator)',
    copy: 'Copy', copied: 'Location copied', locUnknown: 'Location not found yet. Tap the arrow button on the map.', findWorkshop: 'Find a workshop nearby',
    whatsapp: 'WhatsApp', sosNote: 'Numbers checked October 2026. NAVMAP is not an emergency service.',
    pollution: 'Pollution index', pollClean: 'Clean', pollWorst: 'Worst', pollNow: 'Now', pollPeak: 'Worst in next 24 h',
    pollLevels: 'Levels', pollParts: 'What is in the air (µg/m³)', pollSource: 'Estimated from the Copernicus (CAMS) air-quality model via Open-Meteo, using the US AQI scale. For official DOE readings see',
    pollNa: 'Pollution data is not available right now.',
    tabWeather: 'Weather', unpin: 'Remove pin', unpinned: 'Pin removed', unpinFailed: 'Could not remove the pin',
    noPins: 'No community pins nearby yet. Be the first to share what the weather is like.',
    communityWx: 'Community weather', liveShared: 'Live · shared', deviceOnly: 'This device only', pinWeather: 'Pin weather here',
    wxFailed: 'Could not load the weather.', now: 'Now', today: 'Today', feels: 'Feels', humidity: 'Humidity', wind: 'Wind', air: 'Air quality',
    radarOn: 'Show rain radar', radarOff: 'Hide rain radar', radarFailed: 'Rain radar is not available right now', sevenDay: '7-day forecast',
    wxSource: 'Weather: Open-Meteo. Radar: RainViewer. Community pins are shared by NAVMAP users and expire after a few hours.',
    pinnedShared: 'Pinned. Everyone nearby can see it.', pinnedLocal: 'Pinned on this device. Sharing turns on once the community database is connected.',
    pinRate: 'Too many pins. Try again later.', pinFailed: 'Could not pin. Please try again.',
    searchLabel: 'Search places', searchPh: 'Search places, address, EV…', tabExplore: 'Explore', tabDrive: 'Drive', tabAlerts: 'Alerts',
    report: 'Pin weather or hazard', locate: 'Centre on my location', stop: 'End',
    reportTitle: "What's happening here?", reportHint: 'Your pin is shown to everyone nearby and expires after a few hours. You can remove it any time.', cancel: 'Cancel',
    nearby: 'Nearby', seeAll: 'See all', showLess: 'Show less', pickCat: 'What do you need nearby?',
    pickCatHint: 'Pick a category above, or search for any place in Malaysia.',
    loading: 'Looking around…', none: 'Nothing found within 4 km. Try zooming out or moving the map.',
    failed: 'Could not load places right now. Please try again.', retry: 'Try again', searchArea: 'Search this area',
    directions: 'Directions', start: 'Start', close: 'Close', from: 'From', to: 'To', myLocation: 'My location', mapCentre: 'Map centre',
    noDest: 'Where to?', noDestHint: 'Search for a place or tap a nearby result, then press Directions.',
    routing: 'Finding the best route…', routeFailed: 'Could not find a route.', via: 'via', steps: 'Steps',
    routeWarn: 'This route passes near an active alert', routeOk: 'No active alerts on this route',
    alertsTitle: 'Live alerts', all: 'All', flood: 'Floods', weather: 'Weather', quake: 'Earthquakes', reports: 'Community',
    noAlerts: 'No active alerts right now.', sample: 'Live feeds are unreachable, so you are seeing SAMPLE alerts. Do not rely on them.',
    sourceNote: 'Sources: JPS flood stations and MetMalaysia warnings via data.gov.my. NAVMAP is not an official warning service. In an emergency call 999. <a href="/privacy.html">Privacy & disclaimer</a>',
    updated: 'Updated', showOnMap: 'Show on map', away: 'away', reported: 'Thanks. Your report is on the map.',
    geoDenied: 'Location is off. Using the map centre. Tip: open NAVMAP in Safari or Chrome and allow location.', fastest: 'Fastest', alt: 'Alternative', safest: 'Avoids alerts',
    arrived: 'You have arrived', voiceOn: 'Turn voice on', voiceOff: 'Mute voice', hours: 'Hours', call: 'Call', inMalaysia: 'Malaysia',
  },
  bm: {
    gmapsSearch: 'Cari di Google Maps', gmapsMore: 'Tiada dalam senarai?', gmapsPlace: 'Ulasan & gambar di Google Maps',
    subTitle: 'Dapatkan berita NAVMAP', subLead: 'Berita ciri baharu, tip keselamatan dan kempen NAVMAP akan datang melalui e-mel. Tiada spam.', subEmail: 'Alamat e-mel',
    subConsent: 'Saya bersetuju Yush Abdullah (NAVMAP) menyimpan alamat e-mel saya dan menghantar berita, kemas kini dan kempen NAVMAP akan datang. Saya boleh berhenti melanggan pada bila-bila masa. Lihat <a href="/privacy.html" target="_blank">Dasar Privasi</a>.',
    subBtn: 'Langgan', subLink: 'Langgan', subCard: 'Kemas kini dan kempen melalui e-mel. Berhenti bila-bila masa.',
    subDone: 'Terima kasih! Anda telah melanggan.', subFailed: 'Tidak dapat melanggan sekarang. Sila cuba lagi.', subBadEmail: 'Sila masukkan alamat e-mel yang sah.', subRate: 'Terlalu banyak cubaan. Sila cuba sebentar lagi.',
    subUnsubLink: 'Berhenti melanggan', subUnsubTitle: 'Berhenti melanggan', subUnsubLead: 'Masukkan alamat e-mel untuk dibuang daripada senarai NAVMAP.', subUnsubBtn: 'Berhenti melanggan', subUnsubDone: 'Selesai. E-mel itu tidak akan menerima e-mel NAVMAP.', subBackLink: 'Kembali untuk melanggan',
    tabNews: 'Berita', newsTitle: 'Berita alam & iklim', newsLead: 'Tajuk berita terkini tentang banjir, cuaca, jerebu, iklim dan alam semula jadi, dari Malaysia dan seluruh dunia.',
    newsLoading: 'Memuatkan berita terkini…', newsFailed: 'Tidak dapat memuatkan berita sekarang.', newsNone: 'Tiada berita untuk penapis ini.',
    newsLocal: 'Malaysia', newsWorld: 'Dunia', allTopics: 'Semua topik',
    topic_disaster: 'Bencana', topic_weather: 'Cuaca', topic_haze: 'Jerebu & pencemaran', topic_climate: 'Iklim', topic_nature: 'Alam',
    newsSource: 'Tajuk daripada suapan berita awam (Google News, Malay Mail, The Star, The Guardian, BBC, UN News, Mongabay). Artikel dibuka di laman penerbit dan milik mereka. NAVMAP tidak menyemak atau menyokongnya.',
    savedHome: 'Rumah', savedWork: 'Kerja', setHome: 'Tetapkan Rumah', setWork: 'Tetapkan Kerja', saveAsHome: 'Simpan sebagai Rumah', saveAsWork: 'Simpan sebagai Kerja', savedAsHome: 'Disimpan sebagai Rumah', savedAsWork: 'Disimpan sebagai Kerja',
    saveSetTitle: 'Tetapkan {k} anda', saveUseLoc: 'Guna lokasi semasa saya', saveSearch: 'Cari alamat', saveSearchHint: 'Cari alamat di atas, kemudian tekan "Simpan sebagai {k}".', cancel: 'Batal', saveRemove: 'Buang', saveChange: 'Tukar', savedToast: 'Disimpan sebagai {k} dalam telefon ini', removedToast: '{k} dibuang', saveNoLoc: 'Lokasi tidak ditemui. Cari alamat sebagai ganti.', savedNote: 'Disimpan dalam telefon ini sahaja.',
    layersTitle: 'Lapisan peta', layerMap: 'Peta', layerSat: 'Satelit', layerAlerts: 'Amaran dan pin di peta',
    statVisitors: 'pelawat hari ini', statVisitor: 'pelawat hari ini', statPins: 'pin aktif', statPin: 'pin aktif',
    copyright: '© 2026 NAVMAP oleh Yush Abdullah. Hak cipta terpelihara.', terms: 'Terma Perkhidmatan', privacy: 'Dasar Privasi',
    sosTitle: 'Panggilan kecemasan', sosLead: 'Dalam bahaya? Hubungi 999. Panggilan percuma.', myCoords: 'Lokasi anda (bacakan kepada operator)',
    copy: 'Salin', copied: 'Lokasi disalin', locUnknown: 'Lokasi belum dijumpai. Tekan butang anak panah pada peta.', findWorkshop: 'Cari bengkel berdekatan',
    whatsapp: 'WhatsApp', sosNote: 'Nombor disemak Oktober 2026. NAVMAP bukan perkhidmatan kecemasan.',
    pollution: 'Indeks pencemaran', pollClean: 'Bersih', pollWorst: 'Paling teruk', pollNow: 'Kini', pollPeak: 'Paling teruk dalam 24 jam',
    pollLevels: 'Tahap', pollParts: 'Kandungan udara (µg/m³)', pollSource: 'Anggaran daripada model kualiti udara Copernicus (CAMS) melalui Open-Meteo, skala US AQI. Bacaan rasmi JAS di',
    pollNa: 'Data pencemaran tiada buat masa ini.',
    tabWeather: 'Cuaca', unpin: 'Buang pin', unpinned: 'Pin dibuang', unpinFailed: 'Tidak dapat membuang pin',
    noPins: 'Belum ada pin komuniti berdekatan. Jadi yang pertama kongsi keadaan cuaca.',
    communityWx: 'Cuaca komuniti', liveShared: 'Langsung · dikongsi', deviceOnly: 'Peranti ini sahaja', pinWeather: 'Pin cuaca di sini',
    wxFailed: 'Tidak dapat memuatkan cuaca.', now: 'Kini', today: 'Hari ini', feels: 'Terasa', humidity: 'Kelembapan', wind: 'Angin', air: 'Kualiti udara',
    radarOn: 'Tunjuk radar hujan', radarOff: 'Sembunyi radar hujan', radarFailed: 'Radar hujan tidak tersedia sekarang', sevenDay: 'Ramalan 7 hari',
    wxSource: 'Cuaca: Open-Meteo. Radar: RainViewer. Pin komuniti dikongsi pengguna NAVMAP dan luput selepas beberapa jam.',
    pinnedShared: 'Dipin. Semua orang berdekatan boleh melihatnya.', pinnedLocal: 'Dipin di peranti ini. Perkongsian aktif selepas pangkalan data komuniti disambung.',
    pinRate: 'Terlalu banyak pin. Cuba lagi nanti.', pinFailed: 'Tidak dapat pin. Sila cuba lagi.',
    searchLabel: 'Cari tempat', searchPh: 'Cari tempat, alamat, EV…', tabExplore: 'Teroka', tabDrive: 'Pandu', tabAlerts: 'Amaran',
    report: 'Pin cuaca atau bahaya', locate: 'Ke lokasi saya', stop: 'Tamat',
    reportTitle: 'Apa yang berlaku di sini?', reportHint: 'Pin anda dilihat semua orang berdekatan dan luput selepas beberapa jam. Anda boleh membuangnya bila-bila masa.', cancel: 'Batal',
    nearby: 'Berdekatan', seeAll: 'Lihat semua', showLess: 'Kurangkan', pickCat: 'Apa yang anda perlukan?',
    pickCatHint: 'Pilih kategori di atas, atau cari mana-mana tempat di Malaysia.',
    loading: 'Mencari…', none: 'Tiada dalam 4 km. Cuba zum keluar atau gerakkan peta.',
    failed: 'Tidak dapat memuatkan tempat. Sila cuba lagi.', retry: 'Cuba lagi', searchArea: 'Cari kawasan ini',
    directions: 'Arah', start: 'Mula', close: 'Tutup', from: 'Dari', to: 'Ke', myLocation: 'Lokasi saya', mapCentre: 'Tengah peta',
    noDest: 'Ke mana?', noDestHint: 'Cari tempat atau pilih hasil berdekatan, kemudian tekan Arah.',
    routing: 'Mencari laluan terbaik…', routeFailed: 'Laluan tidak ditemui.', via: 'melalui', steps: 'Langkah',
    routeWarn: 'Laluan ini melalui kawasan amaran aktif', routeOk: 'Tiada amaran aktif di laluan ini',
    alertsTitle: 'Amaran langsung', all: 'Semua', flood: 'Banjir', weather: 'Cuaca', quake: 'Gempa bumi', reports: 'Komuniti',
    noAlerts: 'Tiada amaran aktif sekarang.', sample: 'Suapan langsung tidak dapat dicapai, jadi ini amaran CONTOH. Jangan bergantung padanya.',
    sourceNote: 'Sumber: stesen banjir JPS dan amaran MetMalaysia melalui data.gov.my. NAVMAP bukan perkhidmatan amaran rasmi. Kecemasan, hubungi 999. <a href="/privacy.html">Privasi & penafian</a>',
    updated: 'Dikemas kini', showOnMap: 'Lihat di peta', away: 'dari sini', reported: 'Terima kasih. Laporan anda di peta.',
    geoDenied: 'Lokasi dimatikan. Menggunakan tengah peta. Tip: buka NAVMAP di Safari atau Chrome dan benarkan lokasi.', fastest: 'Terpantas', alt: 'Alternatif', safest: 'Elak amaran',
    arrived: 'Anda telah tiba', voiceOn: 'Hidupkan suara', voiceOff: 'Senyapkan suara', hours: 'Waktu', call: 'Hubungi', inMalaysia: 'Malaysia',
  },
};

let lang = (() => {
  try { return localStorage.getItem('navmap.lang') || (navigator.language?.startsWith('ms') ? 'bm' : 'en'); } catch { return 'en'; }
})();

export const getLang = () => lang;
export const t = (k) => STR[lang][k] ?? STR.en[k] ?? k;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('navmap.lang', l); } catch { /* ignore */ }
  applyStatic();
}
export function applyStatic() {
  document.documentElement.lang = lang === 'bm' ? 'ms' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
/** Pick the BM or EN field of an object (e.g. title / title_bm). */
export const L = (o, k) => (lang === 'bm' && o[`${k}_bm`]) || o[k] || '';
