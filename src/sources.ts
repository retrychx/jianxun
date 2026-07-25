export interface RssSource {
  name: string
  url: string
  lang: 'zh' | 'en'
  /** Max articles per fetch. Defaults to 20 if not set. */
  limit?: number
}

export const RSS_SOURCES: RssSource[] = [
  // ==================== 中文源 ====================
  // 36氪 — 不限量
  { name: '36氪',        url: 'https://36kr.com/feed',                  lang: 'zh', limit: 80 },
  { name: '少数派',      url: 'https://sspai.com/feed',                 lang: 'zh' },
  { name: '爱范儿',      url: 'https://www.ifanr.com/feed',             lang: 'zh' },
  { name: '量子位',      url: 'https://www.qbitai.com/feed',            lang: 'zh' },
  { name: '钛媒体',      url: 'https://www.tmtpost.com/rss.xml',        lang: 'zh' },
  { name: '雷锋网',      url: 'https://www.leiphone.com/feed',          lang: 'zh' },
  { name: '品玩',        url: 'https://www.pingwest.com/feed',          lang: 'zh' },
  { name: 'Solidot',     url: 'https://www.solidot.org/index.rss',      lang: 'zh' },
  { name: 'V2EX 热榜',   url: 'https://www.v2ex.com/feed/tab/hot.xml',  lang: 'zh' },
  { name: '开源中国',    url: 'https://www.oschina.net/news/rss',        lang: 'zh' },
  { name: '投资界',      url: 'https://www.pedaily.cn/feed/',           lang: 'zh' },
  { name: '中国新闻网',  url: 'https://www.chinanews.com.cn/rss',       lang: 'zh' },
  { name: '美团技术',    url: 'https://tech.meituan.com/feed/',         lang: 'zh' },
  { name: '知乎热榜',   url: 'https://rsshub.app/zhihu/hot',              lang: 'zh' },
  { name: '微博热搜',   url: 'https://rsshub.app/weibo/search/hot',       lang: 'zh' },
  // ==================== 英文源 ====================
  { name: 'Hacker News',     url: 'https://hnrss.org/frontpage',                 lang: 'en' },
  { name: 'GitHub Trending', url: 'https://github.com/trending/rss?since=daily',  lang: 'en' },
  { name: 'TechCrunch',      url: 'https://techcrunch.com/feed/',                 lang: 'en' },
  { name: 'The Verge',       url: 'https://www.theverge.com/rss/index.xml',       lang: 'en' },
  { name: 'Ars Technica',    url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en' },
  { name: 'Wired',           url: 'https://www.wired.com/feed/rss',               lang: 'en' },
  { name: 'Engadget',        url: 'https://www.engadget.com/rss.xml',             lang: 'en' },
  { name: 'Dev.to',          url: 'https://dev.to/feed',                          lang: 'en' },
  { name: 'Android Central', url: 'https://www.androidcentral.com/rss.xml',       lang: 'en' },
  { name: 'New Scientist',   url: 'https://www.newscientist.com/feed/home',       lang: 'en' },
  { name: 'ScienceDaily',    url: 'https://www.sciencedaily.com/rss/all.xml',     lang: 'en' },
  { name: 'Space.com',       url: 'https://www.space.com/feeds/all',              lang: 'en' },
]
