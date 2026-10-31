// Emergency and help numbers for Malaysia. Checked October 2026 against official and
// organisation sources (civildefence.gov.my, malaysia.gov.my, plus.com.my, the NGOs' own sites).
// `tel` is what the phone dials; `show` is how the number is written.

export const HOTLINE_GROUPS = [
  {
    id: 'gov', icon: 'shield', en: 'Government', bm: 'Kerajaan',
    items: [
      { tel: '999', show: '999', en: 'Emergency: police, ambulance, fire, civil defence', bm: 'Kecemasan: polis, ambulans, bomba, APM', urgent: true },
      { tel: '112', show: '112', en: 'Emergency from any mobile phone', bm: 'Kecemasan dari mana-mana telefon bimbit', urgent: true },
      { tel: '994', show: '994', en: 'Fire & Rescue (Bomba)', bm: 'Bomba dan Penyelamat' },
      { tel: '991', show: '991', en: 'Civil Defence (APM): floods, people trapped', bm: 'Angkatan Pertahanan Awam (APM): banjir, terperangkap' },
      { tel: '15999', show: '15999', en: 'Talian Kasih (JKM): abuse, welfare, family crisis', bm: 'Talian Kasih (JKM): penderaan, kebajikan, krisis keluarga', wa: '60192615999' },
      { tel: '15555', show: '15555', en: 'Talian HEAL (KKM): mental health support', bm: 'Talian HEAL (KKM): sokongan kesihatan mental' },
      { tel: '046570099', show: '04-657 0099', en: 'National Poison Centre', bm: 'Pusat Racun Negara' },
      { tel: '15454', show: '15454', en: 'TNB: power outage or fallen cable', bm: 'TNB: bekalan elektrik terputus atau kabel jatuh' },
    ],
  },
  {
    id: 'car', icon: 'car', en: 'Car problem', bm: 'Kereta rosak',
    items: [
      { tel: '999', show: '999', en: 'Accident with injuries or fire', bm: 'Kemalangan dengan kecederaan atau kebakaran', urgent: true },
      { tel: '1800880000', show: '1-800-88-0000', en: 'PLUS highway hotline (24 hours): breakdown, accident on PLUS', bm: 'Talian PLUS (24 jam): kereta rosak, kemalangan di lebuh raya PLUS' },
    ],
    note: {
      en: 'On other highways, use the orange SOS phone on the roadside. For towing, call the roadside assistance number on your car insurance cover note.',
      bm: 'Di lebuh raya lain, guna telefon SOS jingga di tepi jalan. Untuk tunda, hubungi nombor bantuan jalan raya pada nota perlindungan insurans kereta anda.',
    },
    workshop: true,
  },
  {
    id: 'ngo', icon: 'heart', en: 'NGOs', bm: 'NGO',
    items: [
      { tel: '0376272929', show: '03-7627 2929', en: 'Befrienders KL (24 hours): emotional support', bm: 'Befrienders KL (24 jam): sokongan emosi' },
      { tel: '0330008858', show: '03-3000 8858', en: "Women's Aid Organisation: domestic violence", bm: 'Pertubuhan Pertolongan Wanita (WAO): keganasan rumah tangga', wa: '60189888058' },
      { tel: '0321436122', show: '03-2143 6122', en: 'Malaysian Red Crescent (MRCS)', bm: 'Persatuan Bulan Sabit Merah Malaysia' },
      { tel: '0322762116', show: '03-2276 2116', en: 'MERCY Malaysia: disaster relief (office hours)', bm: 'MERCY Malaysia: bantuan bencana (waktu pejabat)' },
    ],
  },
];
