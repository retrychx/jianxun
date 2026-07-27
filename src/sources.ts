export interface RssSource {
  name: string
  url: string
  lang: 'zh' | 'en'
  /** Max articles per fetch. Defaults to 20 if not set. */
  limit?: number
  /** Score multiplier for UGC/SEO-heavy sources. Defaults to 1. */
  weight?: number
}

export const RSS_SOURCES: RssSource[] = [
  // ==================== 中文源 ====================
  { name: '36氪',        url: 'https://36kr.com/feed',                  lang: 'zh', limit: 80 },
  { name: '少数派',      url: 'https://sspai.com/feed',                 lang: 'zh' },
  { name: '爱范儿',      url: 'https://www.ifanr.com/feed',             lang: 'zh' },
  { name: '量子位',      url: 'https://www.qbitai.com/feed',            lang: 'zh' },
  { name: '钛媒体',      url: 'https://www.tmtpost.com/rss.xml',        lang: 'zh' },
  { name: '雷锋网',      url: 'https://www.leiphone.com/feed',          lang: 'zh' },
  { name: '品玩',        url: 'https://www.pingwest.com/feed',          lang: 'zh' },
  { name: 'Solidot',     url: 'https://www.solidot.org/index.rss',      lang: 'zh' },
  { name: '中国新闻网',  url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', lang: 'zh' },
  { name: '美团技术',    url: 'https://tech.meituan.com/rss.xml',       lang: 'zh' },
  { name: '凤凰网科技',  url: 'https://news.ifeng.com/rss/tech.xml',    lang: 'zh' },
  { name: '动点科技',    url: 'https://technode.com/feed/',             lang: 'en' },
  { name: '开源中国',    url: 'https://www.oschina.net/news/rss',        lang: 'zh' },
  // --- AI ---
  { name: 'arXiv AI',    url: 'https://rss.arxiv.org/rss/cs.AI',        lang: 'en' },
  { name: 'arXiv Robot', url: 'https://arxiv.org/rss/cs.RO',           lang: 'en' },
  { name: 'OpenAI',      url: 'https://openai.com/news/rss.xml',        lang: 'en' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', lang: 'en' },
  // ==================== 英文源 ====================
  { name: 'Hacker News',     url: 'https://hnrss.org/frontpage',                 lang: 'en' },
  { name: 'TechCrunch',      url: 'https://techcrunch.com/feed/',                 lang: 'en' },
  { name: 'The Verge',       url: 'https://www.theverge.com/rss/index.xml',       lang: 'en' },
  { name: 'Ars Technica',    url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en' },
  { name: 'Wired',           url: 'https://www.wired.com/feed/rss',               lang: 'en' },
  { name: 'Engadget',        url: 'https://www.engadget.com/rss.xml',             lang: 'en' },
  { name: 'Dev.to',          url: 'https://dev.to/feed',                          lang: 'en', weight: 0.55 },
  { name: 'Android Central', url: 'https://www.androidcentral.com/rss.xml',       lang: 'en' },
  { name: 'New Scientist',   url: 'https://www.newscientist.com/feed/',           lang: 'en' },
  { name: 'ScienceDaily',    url: 'https://www.sciencedaily.com/rss/all.xml',     lang: 'en' },
  { name: 'Space.com',       url: 'https://www.space.com/feeds/all',              lang: 'en' },
  { name: 'NPR',             url: 'https://feeds.npr.org/1001/rss.xml',           lang: 'en' },
  // --- Vibe Coding / AI / Deep Tech ---
  { name: 'GitHub Blog',     url: 'https://github.blog/feed/',                    lang: 'en' },
  { name: 'Simon Willison',  url: 'https://simonwillison.net/atom/everything/',   lang: 'en' },
  { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/',         lang: 'en' },
  { name: 'IEEE Spectrum',   url: 'https://spectrum.ieee.org/feeds/feed.rss',    lang: 'en' },
  { name: 'Nature',          url: 'https://www.nature.com/nature.rss',            lang: 'en' },
  { name: 'Physics World',   url: 'https://physicsworld.com/feed/',               lang: 'en' },
  // --- 科技商业 ---
  { name: 'ZDNet',           url: 'https://www.zdnet.com/news/rss.xml',           lang: 'en' },
  // --- 财经 ---
  { name: 'MarketWatch',     url: 'https://feeds.marketwatch.com/marketwatch/topstories', lang: 'en', weight: 0.8 },
]
