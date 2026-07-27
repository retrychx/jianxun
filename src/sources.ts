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
  { name: '36氪', weight: 0.9,        url: 'https://36kr.com/feed',                  lang: 'zh', limit: 80 },
  { name: '少数派',      url: 'https://sspai.com/feed',                 lang: 'zh' },
  { name: '爱范儿',      url: 'https://www.ifanr.com/feed',             lang: 'zh' },
  { name: '量子位', weight: 1.05,      url: 'https://www.qbitai.com/feed',            lang: 'zh' },
  { name: '钛媒体', weight: 0.85,      url: 'https://www.tmtpost.com/rss.xml',        lang: 'zh' },
  { name: '雷锋网', weight: 0.85,      url: 'https://www.leiphone.com/feed',          lang: 'zh' },
  { name: '品玩', weight: 0.85,        url: 'https://www.pingwest.com/feed',          lang: 'zh' },
  { name: 'Solidot', weight: 0.8,     url: 'https://www.solidot.org/index.rss',      lang: 'zh' },
  { name: '中国新闻网',  url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', lang: 'zh' },
  { name: '美团技术',    url: 'https://tech.meituan.com/rss.xml',       lang: 'zh' },
  { name: '凤凰网科技', weight: 0.9,  url: 'https://news.ifeng.com/rss/tech.xml',    lang: 'zh' },
  { name: 'IT之家', weight: 0.9,      url: 'https://www.ithome.com/rss/',              lang: 'zh' },
  { name: '掘金',        url: 'https://juejin.cn/rss',                    lang: 'zh', weight: 0.7 },
  { name: '博客园',      url: 'https://feed.cnblogs.com/blog/sitehome/rss', lang: 'zh', weight: 0.6 },
  { name: '小众软件',    url: 'https://www.appinn.com/feed/',             lang: 'zh' },

  { name: '动点科技',    url: 'https://technode.com/feed/',             lang: 'en' },
  { name: '开源中国', weight: 0.8,    url: 'https://www.oschina.net/news/rss',        lang: 'zh' },
  // --- AI ---
  { name: 'arXiv AI', weight: 1.15,    url: 'https://rss.arxiv.org/rss/cs.AI',        lang: 'en' },
  { name: 'arXiv Robot', weight: 1.1, url: 'https://arxiv.org/rss/cs.RO',           lang: 'en' },
  { name: 'OpenAI', weight: 1.1,      url: 'https://openai.com/news/rss.xml',        lang: 'en' },
  { name: 'MIT Tech Review', weight: 1.05, url: 'https://www.technologyreview.com/feed/', lang: 'en' },
  // ==================== 英文源 ====================
  { name: 'Hacker News', weight: 0.85,     url: 'https://hnrss.org/frontpage',                 lang: 'en' },
  { name: 'TechCrunch', weight: 1.0,      url: 'https://techcrunch.com/feed/',                 lang: 'en' },
  { name: 'The Verge', weight: 1.0,       url: 'https://www.theverge.com/rss/index.xml',       lang: 'en' },
  { name: 'Ars Technica', weight: 1.0,    url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en' },
  { name: 'Wired', weight: 0.95,           url: 'https://www.wired.com/feed/rss',               lang: 'en' },
  { name: 'Engadget', weight: 0.9,        url: 'https://www.engadget.com/rss.xml',             lang: 'en' },
  { name: 'Dev.to',          url: 'https://dev.to/feed',                          lang: 'en', weight: 0.55 },
  { name: 'Android Central', weight: 0.7, url: 'https://www.androidcentral.com/rss.xml',       lang: 'en' },
  { name: 'New Scientist', weight: 0.9,   url: 'https://www.newscientist.com/feed/',           lang: 'en' },
  { name: 'ScienceDaily', weight: 0.9,    url: 'https://www.sciencedaily.com/rss/all.xml',     lang: 'en' },
  { name: 'Space.com', weight: 0.85,       url: 'https://www.space.com/feeds/all',              lang: 'en' },
  { name: 'NPR', weight: 0.8,             url: 'https://feeds.npr.org/1001/rss.xml',           lang: 'en' },
  // --- Vibe Coding / AI / Deep Tech ---
  { name: 'GitHub Blog', weight: 1.0,     url: 'https://github.blog/feed/',                    lang: 'en' },
  { name: 'Simon Willison', weight: 1.0,  url: 'https://simonwillison.net/atom/everything/',   lang: 'en' },
  { name: 'Quanta Magazine', weight: 1.0, url: 'https://www.quantamagazine.org/feed/',         lang: 'en' },
  { name: 'IEEE Spectrum', weight: 1.0,   url: 'https://spectrum.ieee.org/feeds/feed.rss',    lang: 'en' },
  { name: 'Nature', weight: 1.0,          url: 'https://www.nature.com/nature.rss',            lang: 'en' },
  { name: 'Physics World', weight: 1.0,   url: 'https://physicsworld.com/feed/',               lang: 'en' },
  // --- 科技商业 ---
  { name: 'ZDNet', weight: 0.9,           url: 'https://www.zdnet.com/news/rss.xml',           lang: 'en' },
  // --- 财经 ---
  { name: 'MarketWatch', weight: 0.8,     url: 'https://feeds.marketwatch.com/marketwatch/topstories', lang: 'en', weight: 0.8 },
]
