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
  // 中国新闻网: /rss 已改为 HTML 页面，使用 scroll-news.xml
  { name: '中国新闻网',  url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', lang: 'zh' },
  // 美团技术: /feed/ 307→/rss.xml，直接用终点避免重定向
  { name: '美团技术',    url: 'https://tech.meituan.com/rss.xml',       lang: 'zh' },
  // 凤凰网科技（新增）
  { name: '凤凰网科技',  url: 'https://news.ifeng.com/rss/tech.xml',    lang: 'zh' },
  // 动点科技（新增，英文但专注中国科技）
  { name: '动点科技',    url: 'https://technode.com/feed/',             lang: 'en' },
  // --- 已失效源：V2EX DNS不稳定，投资界404，机器之心RSS已关，GitHub Trending撤销RSS ---
  // --- 开源中国: 偶发403但大多数情况正常，保留 ---
  { name: '开源中国',    url: 'https://www.oschina.net/news/rss',        lang: 'zh' },
  // --- AI 专题 ---
  { name: 'arXiv AI',    url: 'https://rss.arxiv.org/rss/cs.AI',        lang: 'en' },
  { name: 'arXiv Robot', url: 'https://arxiv.org/rss/cs.RO',           lang: 'en' },
  { name: 'OpenAI',      url: 'https://openai.com/news/rss.xml',        lang: 'en' },
  // MIT Technology Review（新增——已在PERSPECTIVES中但未加入源列表）
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
]
