// Live environment and nature news from public RSS/Atom feeds.
// Shared by the Vercel function (api/news.js) and the tests. No dependencies.

const gn = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

// region: 'my' = Malaysia (local), 'world' = international.
// filter: true when the feed is general news and must be narrowed to nature topics.
export const FEEDS = [
  { id: 'gn-my-en', region: 'my', url: gn('Malaysia (flood OR haze OR landslide OR storm OR "climate change" OR environment OR wildlife OR forest OR pollution OR MetMalaysia OR earthquake) when:3d', 'en-MY', 'MY', 'MY:en') },
  { id: 'gn-my-ms', region: 'my', url: gn('banjir OR jerebu OR "tanah runtuh" OR "alam sekitar" OR "perubahan iklim" OR "ribut petir" OR MetMalaysia when:3d', 'ms', 'MY', 'MY:ms') },
  { id: 'malaymail', region: 'my', filter: true, source: 'Malay Mail', url: 'https://www.malaymail.com/feed/rss/malaysia' },
  { id: 'thestar', region: 'my', filter: true, source: 'The Star', url: 'https://www.thestar.com.my/rss/News/Nation' },
  { id: 'guardian', region: 'world', source: 'The Guardian', url: 'https://www.theguardian.com/environment/rss' },
  { id: 'bbc', region: 'world', filter: true, source: 'BBC News', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { id: 'un', region: 'world', source: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/topic/climate-change/feed/rss.xml' },
  { id: 'mongabay', region: 'world', source: 'Mongabay', url: 'https://news.mongabay.com/feed/' },
  { id: 'gn-world', region: 'world', url: gn('("climate change" OR "global warming" OR wildfire OR heatwave OR cyclone OR typhoon OR deforestation OR "extreme weather") when:2d', 'en-US', 'US', 'US:en') },
];

// Topic tags, checked in order; the first match wins. Also used to filter general feeds.
export const TOPICS = [
  { id: 'disaster', re: /\b(flood|floods|flooding|flash flood|banjir|landslide|tanah runtuh|earthquake|gempa|tsunami|cyclone|typhoon|hurricane|storm|ribut|wildfire|bushfire|volcano|eruption|evacuat|pemindahan|mangsa)/i },
  { id: 'haze', re: /\b(haze|jerebu|air pollution|air quality|pencemaran|pollution|smog|ipu\b|api reading|emission)/i },
  { id: 'climate', re: /\b(climate|iklim|global warming|pemanasan global|carbon|net zero|net-zero|cop\d\d|greenhouse|heatwave|heat wave|gelombang haba|el nino|la nina|sea level|renewable|solar|fossil)/i },
  { id: 'weather', re: /\b(weather|cuaca|monsoon|monsun|rain|hujan|thunderstorm|metmalaysia|heavy rain|drought|kemarau|heat)/i },
  { id: 'nature', re: /\b(wildlife|hidupan liar|forest|hutan|deforestation|biodiversity|species|tiger|harimau|elephant|gajah|orangutan|turtle|penyu|coral|marine|ocean|river|sungai|mangrove|environment|alam sekitar|conservation|plastic|recycl|nature)/i },
];

export function topicOf(text) {
  return TOPICS.find((t) => t.re.test(text))?.id || null;
}

const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]+)"`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&') : '';
};

/** Parse RSS 2.0 or Atom text into plain items. */
export function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const channel = decode(tag(xml.replace(/<item[\s\S]*$/i, ''), 'title'));
  return blocks.map((b) => {
    let title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link')) || attr(b, 'link', 'href');
    let source = decode(tag(b, 'source')) || feed.source || channel;
    // Google News titles end with " - Source Name"
    if (feed.url.includes('news.google.com')) {
      const i = title.lastIndexOf(' - ');
      if (i > 20) { if (!tag(b, 'source')) source = title.slice(i + 3); title = title.slice(0, i); }
    }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const time = date ? new Date(decode(date)) : null;
    const summary = decode(tag(b, 'description') || tag(b, 'summary')).slice(0, 220);
    const image = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || (/type="image/i.test(b) ? attr(b, 'enclosure', 'url') : '');
    if (!title || !/^https?:\/\//.test(link)) return null;
    return {
      title, link, source: source || 'News', region: feed.region,
      time: time && !Number.isNaN(time.getTime()) ? time.toISOString() : null,
      summary: feed.url.includes('news.google.com') ? '' : summary,
      image: /^https:\/\//.test(image) ? image : '',
    };
  }).filter(Boolean);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 70);

/** Fetch every feed in parallel, keep nature topics, drop duplicates, newest first. */
export async function fetchNews(fetchImpl = fetch, { maxAgeDays = 4, limit = 80 } = {}) {
  const results = await Promise.allSettled(FEEDS.map(async (f) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetchImpl(f.url, { signal: ctrl.signal, headers: { 'user-agent': 'NAVMAP news reader (+https://navmap.vercel.app)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      if (!r.ok) throw new Error(`${f.id} ${r.status}`);
      return parseFeed(await r.text(), f).map((it) => ({ ...it, feed: f.id, filter: !!f.filter }));
    } finally { clearTimeout(timer); }
  }));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const cutoff = Date.now() - maxAgeDays * 86400e3;
  const seen = new Set();
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .map((it) => ({ ...it, topic: topicOf(`${it.title} ${it.summary}`) }))
    .filter((it) => (it.filter ? it.topic : true))
    .filter((it) => !it.time || new Date(it.time).getTime() > cutoff)
    .filter((it) => { const k = norm(it.title); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .filter((it, _, arr) => arr.filter((x) => x.region === it.region).indexOf(it) < limit / 2) // keep both regions
    .map(({ filter, ...it }) => ({ ...it, topic: it.topic || 'nature' }));
  return { items, feedsOk: ok, feedsTotal: FEEDS.length, at: new Date().toISOString() };
}
