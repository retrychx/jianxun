import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { Newspaper, MessageCircleQuestion } from 'lucide-react'
import { CategoryBar } from './components/CategoryBar'
import { NewsCard } from './components/NewsCard'
import { TrendingPanel } from './components/TrendingPanel'
import { DetailPanel } from './components/DetailPanel'
import { BriefingView } from './components/BriefingView'
import { SearchView } from './components/SearchView'
import { AskView } from './components/AskView'
import { BottomNav } from './components/BottomNav'
import { KinkLine } from './components/KinkLine'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Virtuoso } from 'react-virtuoso'

// 代码分割：重视图按需加载，缩小首屏 JS
const TopicsView = lazy(() => import('./components/TopicsView').then(m => ({ default: m.TopicsView })))
const EntityView = lazy(() => import('./components/EntityView').then(m => ({ default: m.EntityView })))
const DigestLoader = lazy(() => import('./components/DigestView').then(m => ({ default: m.DigestLoader })))
const TopicView = lazy(() => import('./components/TopicView').then(m => ({ default: m.TopicView })))
const NarrativesView = lazy(() => import('./components/NarrativesView').then(m => ({ default: m.NarrativesView })))
const NarrativeDetailView = lazy(() => import('./components/NarrativeDetailView').then(m => ({ default: m.NarrativeDetailView })))
const ResearchView = lazy(() => import('./components/ResearchView').then(m => ({ default: m.ResearchView })))
const SourcesView = lazy(() => import('./components/SourcesView').then(m => ({ default: m.SourcesView })))
const SectorsView = lazy(() => import('./components/SectorsView').then(m => ({ default: m.SectorsView })))
const WeeklyView = lazy(() => import('./components/WeeklyView').then(m => ({ default: m.WeeklyView })))
const InsightsView = lazy(() => import('./components/InsightsView').then(m => ({ default: m.InsightsView })))
const IdeasView = lazy(() => import('./components/IdeasView').then(m => ({ default: m.IdeasView })))
import type { NewsItem, CategoryCount, TopicCluster, BriefingItem } from './api'
import { getNews, getTrending, getCategories, getStats, getTopics, getBriefing, getDigests } from './api'
import { useFollow } from './hooks/useFollow'
import { useHashRoute, useNavigate, buildHash, type Route, type ViewName } from './hooks/useHashRoute'
import { useTheme, THEMES, THEME_META } from './hooks/useTheme'
import { useSearch } from './hooks/useSearch'
import { useRealtime } from './hooks/useRealtime'
import { trackEntityClick, getActiveInterests } from './hooks/useInterest'
import { boostFollowed, matchesFollow, cleanNarrativeLabel, type Lang } from './utils'
import './App.css'

const PAGE_SIZE = 50

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line short" />
      <div className="skeleton skeleton-line" style={{ height: 18, marginBottom: 10 }} />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line mid" />
      <div style={{ marginTop: 12 }}>
        <div className="skeleton skeleton-line tiny" />
      </div>
    </div>
  )
}

function getLang(): Lang {
  return localStorage.getItem('lang') === 'en' ? 'en' : 'zh'
}

const BUILD = '2026-07-27-v3'
export default function App() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsTotal, setNewsTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [trending, setTrending] = useState<NewsItem[]>([])
  const [topics, setTopics] = useState<TopicCluster[]>([])
  const [briefingItems, setBriefingItems] = useState<BriefingItem[]>([])
  const [briefingAt, setBriefingAt] = useState<Date | null>(null)
  const [categories, setCategories] = useState<CategoryCount[]>([])
  const [stats, setStats] = useState({ total: 0, today: 0 })
  const [initialLoading, setInitialLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState(false)
  const [msg, setMsg] = useState('')
  const [askOpen, setAskOpen] = useState(false)
  const [askQuery, setAskQuery] = useState('')
  const { theme, setTheme } = useTheme()
  const [lang, setLang] = useState<Lang>(getLang)
  const [digestDates, setDigestDates] = useState<string[]>([])
  const [scrolled, setScrolled] = useState(false)
  const {
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    searching, setSearching,
    searchError, setSearchError,
    searchNavRef, lastViewHashRef,
  } = useSearch()
  const { follows, isFollowing, toggleFollow } = useFollow()

  // 设备 ID（localStorage 持久化，用于信号去重和个性化）
  const deviceId = useRef('')
  useEffect(() => {
    let did = localStorage.getItem('jianxun_device_id')
    if (!did) { did = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 12); localStorage.setItem('jianxun_device_id', did) }
    deviceId.current = did
  }, [])

  const trackSignal = useCallback((type: string, id: string, action = 'click') => {
    fetch('/api/signal/click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, id, action, deviceId: deviceId.current }) }).catch(() => {})
  }, [])

  // ─── 不感兴趣：隐藏的文章 ID ───
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hiddenNews') || '[]')) } catch { return new Set() }
  })
  // useCallback 保持引用稳定，否则每个 NewsCard 的 memo 都被击穿、每次渲染全量重绘
  const hideArticle = useCallback((id: number) => {
    setHiddenIds(prev => {
      const next = new Set(prev); next.add(id)
      return next
    })
    // AI 反馈闭环：隐藏 = 负反馈信号，agent 会据此重分析/降权同类文章
    trackSignal('article', String(id), 'hide')
  }, [trackSignal])
  // localStorage 写入放在 effect（updater 必须是纯函数，渲染期也不该读写 localStorage）
  useEffect(() => {
    localStorage.setItem('hiddenNews', JSON.stringify([...hiddenIds]))
  }, [hiddenIds])

  // ─── 反噪音：屏蔽来源 + 只看重要 ───
  const [blockedSources, setBlockedSources] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('blockedSources') || '[]')) } catch { return new Set() }
  })
  useEffect(() => {
    localStorage.setItem('blockedSources', JSON.stringify([...blockedSources]))
  }, [blockedSources])
  const blockSource = useCallback((source: string) => {
    setBlockedSources(prev => { const next = new Set(prev); next.add(source); return next })
  }, [])
  const [onlyImportant, setOnlyImportant] = useState(false)

  // ─── 新文章标记：记录上次访问时间 ───
  // 首次渲染时惰性读一次（不再每次渲染都 getItem/setItem）
  const lastVisitRef = useRef<number>(0)
  if (lastVisitRef.current === 0) {
    const saved = localStorage.getItem('lastVisit')
    lastVisitRef.current = saved ? Number(saved) : Date.now()
  }
  useEffect(() => {
    localStorage.setItem('lastVisit', String(Date.now()))
  }, [])

  // Hash 路由：route 为当前 hash 解析结果；baseRoute 为详情覆盖层之下的视图
  const route = useHashRoute()
  const navigate = useNavigate()
  const [baseRoute, setBaseRoute] = useState<Route>(route)
  useEffect(() => {
    if (!route.newsId) setBaseRoute(route)
  }, [route])
  const selectedNewsId = route.newsId
  const view = baseRoute.view
  const activeCat = view === 'feed' ? (baseRoute.cat ?? '全部') : ''
  // tab 高亮：历史日报/话题深挖归入「日报」；信源/问答/周报页不高亮任何 tab
  const navActive: ViewName = view === 'digest' || view === 'topic' ? 'briefing' : view
  // 供 SSE 处理器读取当前 feed 状态（避免闭包捕获过期 view/cat 导致重新订阅 EventSource）
  const feedStateRef = useRef({ view: 'briefing', cat: '全部' })
  feedStateRef.current = { view, cat: activeCat }
  // 个性化 feed（客户端重排）：命中「关注 + 兴趣 + 近 7 天点击热实体」的条目稳定置顶。
  // 用 useMemo：boostFollowed 是 O(n·m)，每次渲染重算 + 数组重建会白白浪费。
  const followedEntityNames = useMemo(() => follows.filter(f => f.type === 'entity').map(f => f.name), [follows])
  const interests = useMemo(() => getActiveInterests(), [])
  const [hotEntityNames, setHotEntityNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/news/heat-entities').then(r => r.json()).then(d => {
      if (!cancelled && Array.isArray(d.entities)) setHotEntityNames(d.entities.map((e: any) => e.name))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const boostNames = useMemo(
    () => [...new Set([...followedEntityNames, ...interests, ...hotEntityNames])],
    [followedEntityNames, interests, hotEntityNames],
  )
  const boostedNews = useMemo(
    () => boostFollowed(news, boostNames)
      .filter(n => !hiddenIds.has(n.id) && !blockedSources.has(n.source) && (!onlyImportant || n.impact === 'high')),
    [news, boostNames, hiddenIds, blockedSources, onlyImportant],
  )

  // 记录会话内导航次数：区分「SPA 内打开详情」与「刷新/分享直达详情」
  const navCountRef = useRef(0)

  // Language
  useEffect(() => {
    localStorage.setItem('lang', lang)
  }, [lang])

  // Lock body scroll when panel open
  useEffect(() => {
    document.body.classList.toggle('no-scroll', !!selectedNewsId)
    return () => { document.body.classList.remove('no-scroll') }
  }, [selectedNewsId])

  // Scroll-to-top
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // Toast
  const toastTimer = useRef<number | null>(null)
  const showToast = useCallback((text: string) => {
    setMsg(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setMsg(''), 3000)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // 竞态防护：切分类/翻页时取消上一轮请求，旧响应用 AbortController 中止 + aborted 检查丢弃
  const newsAbort = useRef<AbortController | null>(null)
  useEffect(() => () => newsAbort.current?.abort(), [])
  const loadNews = useCallback(async (cat: string, pageNum = 1, append = false) => {
    newsAbort.current?.abort()
    const ac = new AbortController()
    newsAbort.current = ac
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const data = await getNews({ category: cat, page: pageNum, pageSize: PAGE_SIZE }, ac.signal)
      if (ac.signal.aborted) return
      setNews(prev => append ? [...prev, ...data.items] : data.items)
      setNewsTotal(data.total)
      setPage(pageNum)
      setFeedError(false)
    } catch {
      if (ac.signal.aborted) return
      setFeedError(true)
      showToast('新闻加载失败，请稍后重试')
    } finally {
      if (!ac.signal.aborted) {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    }
  }, [showToast])

  const loadAll = useCallback(async () => {
    try {
      const [cats, tr, tp, br] = await Promise.all([getCategories(), getTrending(), getTopics(), getBriefing()])
      setCategories(cats.categories)
      setTrending(tr.items)
      setTopics(tp.topics)
      setBriefingItems(br.items)
      setBriefingAt(new Date())
    } catch {
      showToast('数据加载失败，请刷新重试')
    }
  }, [showToast])

  const loadStats = useCallback(async () => {
    try { setStats(await getStats()) } catch { /* stats 非关键，静默失败 */ }
  }, [])

  // 往期日报日期列表：仅用于日期箭头与往期入口，失败静默（箭头隐藏）
  const loadDigestDates = useCallback(async () => {
    try {
      const d = await getDigests()
      setDigestDates(Array.isArray(d.dates) ? d.dates : [])
    } catch { /* 非关键，静默失败 */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await Promise.all([loadAll(), loadStats(), loadDigestDates()])
      if (!cancelled) setInitialLoading(false)
    }
    init()
    // 注册 Service Worker（PWA 离线 + 添加到桌面提示）
    // 首次交互时请求通知权限
    const handleInteraction = () => {
      document.removeEventListener('click', handleInteraction)
      document.removeEventListener('touchstart', handleInteraction)
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(r => setNotifGranted(r === 'granted'))
      }
    }
    document.addEventListener('click', handleInteraction)
    document.addEventListener('touchstart', handleInteraction)
    return () => { cancelled = true; document.removeEventListener('click', handleInteraction); document.removeEventListener('touchstart', handleInteraction) }
  }, [loadAll, loadStats, loadDigestDates])

  // PWA 安装提示（Chrome beforeinstallprompt）
  const [installEvent, setInstallEvent] = useState<any>(null)
  useEffect(() => {
    const win = window as any
    if (win.__pwaPrompt) setInstallEvent(win.__pwaPrompt)
    const handler = (e: any) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const handleInstall = useCallback(() => {
    if (!installEvent) return
    installEvent.prompt()
    installEvent.userChoice.then(() => setInstallEvent(null))
  }, [installEvent])

  // 浏览器通知（用于突发/叙事更新）
  const [notifGranted, setNotifGranted] = useState(false)
  const notifyBrowser = useCallback((title: string, body: string, url?: string) => {
    if (!notifGranted) return
    try {
      const n = new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="90" font-size="90">📰</text></svg>' })
      if (url) n.onclick = () => { window.focus(); window.location.hash = url }
    } catch {}
  }, [notifGranted])

  // SSE + SW 实时事件（抽取到 useRealtime，减轻巨石组件）
  const { isOffline, showUpdate } = useRealtime({
    loadAll,
    loadStats,
    loadDigestDates,
    loadNews,
    feedState: feedStateRef.current,
    showToast,
    notifyBrowser,
    // 追更订阅：只对已关注的叙事推浏览器通知
    isFollowingNarrative: (kw) => follows.some(f => f.id === `narrative:${kw}`),
  })

  // 预加载：用户可能在当前页面停留时提前加载下一个 tab 的数据
  const prefetched = useRef(new Set<string>())
  useEffect(() => {
    if (initialLoading) return
    const prefetch = (url: string) => {
      if (prefetched.current.has(url)) return
      prefetched.current.add(url)
      fetch(url).catch(() => {})
    }
    // 按当前视图预判下一步
    const timer = setTimeout(() => {
      if (view === 'briefing') {
        prefetch('/api/news/trending')
        prefetch('/api/news/topics')
      } else if (view === 'feed') {
        prefetch('/api/news/trending')
      } else if (view === 'trending') {
        prefetch('/api/news/news?pageSize=10')
      }
    }, 2000) // 页面加载 2 秒后静默预取
    return () => clearTimeout(timer)
  }, [view, initialLoading])

  // feed 视图：路由驱动加载与分类切换
  const routeView = baseRoute.view
  const routeCat = baseRoute.cat
  useEffect(() => {
    if (routeView !== 'feed') return
    loadNews(routeCat ?? '全部')
  }, [routeView, routeCat, loadNews])

  // 视图切换后回到顶部
  const routeEntity = baseRoute.entity
  const routeTopic = baseRoute.topic
  const routeDate = baseRoute.date
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [routeView, routeCat, routeEntity, routeTopic, routeDate])

  // 搜索框与路由双向同步；记录最近非搜索视图供清空后返回
  useEffect(() => {
    if (route.newsId) return
    if (route.view === 'search') {
      if (searchNavRef.current) searchNavRef.current = false
      else setSearchQuery(route.q ?? '')
    } else {
      setSearchQuery('')
      lastViewHashRef.current = buildHash(route)
    }
  }, [route])

  // 动态页面标题
  useEffect(() => {
    const titles: Record<string, string> = {
      briefing: '今日简报',
      feed: '新闻',
      topics: '话题',
      narratives: '故事',
      trending: '热门',
      search: '搜索',
      sources: '信源',
      weekly: '周报',
      sectors: '行业雷达',
      insights: '读者洞察',
      ideas: '每日灵感',
    }
    const base = titles[view] || '简讯'
    if (view === 'narrative' && baseRoute.narrative) {
      document.title = `${baseRoute.narrative} - 故事 - 简讯`
    } else if (view === 'entity' && baseRoute.entity) {
      document.title = `${baseRoute.entity} - ${base} - 简讯`
    } else if (view === 'research' && baseRoute.research) {
      document.title = `研究 - 简讯`
    } else {
      document.title = `${base} - 简讯`
    }
  }, [view, baseRoute.narrative, baseRoute.entity, baseRoute.research])

  const handleSearchChange = (v: string) => {
    setSearchQuery(v)
    if (v.trim()) {
      const hash = buildHash({ view: 'search', q: v.trim() })
      if (window.location.hash.startsWith('#/search')) {
        navigate(hash, true)
      } else {
        searchNavRef.current = true
        navCountRef.current++
        navigate(hash)
      }
    } else if (window.location.hash.startsWith('#/search')) {
      navCountRef.current++
      navigate(lastViewHashRef.current)
    }
  }

  const handleCategory = (cat: string) => {
    navCountRef.current++
    navigate(buildHash({ view: 'feed', cat }))
  }

  const openNews = useCallback((id: number) => {
    navCountRef.current++
    trackSignal('article', String(id))
    navigate(`#/news/${id}`)
  }, [navigate, trackSignal])

  const openEntity = useCallback((name: string) => {
    navCountRef.current++
    trackSignal('entity', name)
    trackEntityClick(name)
    navigate(buildHash({ view: 'entity', entity: name }))
  }, [navigate, trackSignal])

  // 返回键：SPA 内有历史则后退，否则（刷新/分享直达）回到日报
  const goBack = useCallback(() => {
    if (navCountRef.current > 0) window.history.back()
    else navigate('#/')
  }, [navigate])

  return (
    <div className="app">
      {isOffline && <div className="offline-banner">网络已断开，部分内容可能不可用</div>}
      {showUpdate && (
        <div className="update-banner">
          <span>有新版本可用</span>
          <button onClick={() => window.location.reload()}>立即刷新</button>
        </div>
      )}
      {msg && <div className="toast">{msg}</div>}

      <header className="header">
        <div className="header-top">
          <h1 className="logo"><a href="#/" aria-label="简讯首页"><span className="logo-accent">简</span><span className="logo-muted">讯</span></a></h1>
          <nav className="header-nav" aria-label="主导航">
            <a href="#/" className={navActive === 'briefing' ? 'active' : ''} aria-current={navActive === 'briefing' ? 'page' : undefined}>日报<KinkLine /></a>
            <a href="#/narratives" className={navActive === 'narratives' || navActive === 'narrative' ? 'active' : ''} aria-current={navActive === 'narratives' || navActive === 'narrative' ? 'page' : undefined}>故事<KinkLine /></a>
            <a href="#/feed" className={navActive === 'feed' ? 'active' : ''} aria-current={navActive === 'feed' ? 'page' : undefined}>新闻<KinkLine /></a>
            <a href="#/topics" className={navActive === 'topics' ? 'active' : ''} aria-current={navActive === 'topics' ? 'page' : undefined}>话题<KinkLine /></a>
          </nav>
          <div className="header-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hs-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="hs-field" placeholder="搜索新闻..." value={searchQuery} onChange={e => handleSearchChange(e.target.value)} aria-label="搜索新闻" />
            {searchQuery && <button className="hs-field-clear" onClick={() => handleSearchChange('')} aria-label="清除搜索">&times;</button>}
          </div>
          <div className="header-actions" role="group" aria-label="主题切换">
            {THEMES.map(t => {
              const meta = THEME_META[t]
              return (
                <button
                  key={t}
                  className={`ha-btn${theme === t ? ' active' : ''}`}
                  onClick={() => setTheme(t)}
                  title={`${meta.label}主题`}
                  aria-label={`切换到${meta.label}主题`}
                  aria-pressed={theme === t}
                >
                  <meta.Icon size={15} />
                </button>
              )
            })}
          </div>
          <div className="header-lang" role="group" aria-label="语言切换">
            <button
              className={`ha-btn lang-btn${lang === 'zh' ? ' active' : ''}`}
              onClick={() => setLang('zh')}
              title="中文优先（无译文显示原文）"
              aria-label="切换到中文"
              aria-pressed={lang === 'zh'}
            >中</button>
            <button
              className={`ha-btn lang-btn${lang === 'en' ? ' active' : ''}`}
              onClick={() => setLang('en')}
              title="Always show original language"
              aria-label="Switch to English"
              aria-pressed={lang === 'en'}
            >EN</button>
          </div>
        </div>
      </header>
      {view === 'feed' && <CategoryBar categories={categories} active={activeCat} onSelect={handleCategory} />}

      <div className="main-layout">
        <div className="news-feed">
          {initialLoading ? (
            <>
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </>
          ) : (
            <ErrorBoundary>
              <Suspense fallback={<SkeletonCard />}>
              {view === 'search' ? (
            <SearchView
              results={searchResults}
              query={searchQuery.trim()}
              searching={searching}
              error={searchError}
              lang={lang}
              onClear={() => handleSearchChange('')}
              onNewsClick={openNews}
              onAsk={(q) => { setAskQuery(q); setAskOpen(true) }}
              onEntityClick={(name) => navigate(`#/entity/${encodeURIComponent(name)}`)}
              onNarrativeClick={(kw) => navigate(`#/narrative/${encodeURIComponent(kw)}`)}
            />
          ) : view === 'entity' && baseRoute.entity ? (
            <EntityView entity={baseRoute.entity} lang={lang} onBack={goBack} onNewsClick={openNews} onNarrativeClick={(kw: string) => { navigate(`#/narrative/${encodeURIComponent(kw)}`) }} onEntityClick={openEntity} />
          ) : view === 'digest' && baseRoute.date ? (
            <DigestLoader date={baseRoute.date} dates={digestDates} lang={lang} onNewsClick={openNews} follows={follows} onEntityClick={openEntity} />
          ) : view === 'topic' && baseRoute.topic ? (
            <TopicView name={baseRoute.topic} lang={lang} onBack={goBack} onNewsClick={openNews} />
          ) : view === 'narratives' ? (
            <NarrativesView onNarrativeClick={(kw, label) => {
              navigate(`#/narrative/${encodeURIComponent(cleanNarrativeLabel(label || kw))}?kw=${encodeURIComponent(kw)}`)
            }} onNewsClick={openNews} onResearchCreate={(kw) => { navigate(`#/research?q=${encodeURIComponent(kw)}`) }} />
          ) : view === 'narrative' && baseRoute.narrative ? (
            <NarrativeDetailView keyword={baseRoute.narrative} lang={lang} onBack={goBack} onNewsClick={openNews} isFollowing={isFollowing} toggleFollow={toggleFollow} onResearch={(kw: string) => { navigate(`#/research?q=${encodeURIComponent(kw)}`) }} onNarrativeClick={(kw: string, label?: string) => {
              navigate(`#/narrative/${encodeURIComponent(cleanNarrativeLabel(label || kw))}?kw=${encodeURIComponent(kw)}`)
            }} />
          ) : view === 'trending' ? (
            <div className="trending-view"><TrendingPanel items={trending} lang={lang} onNewsClick={openNews} /></div>
          ) : view === 'sources' ? (
            <SourcesView />
          ) : view === 'sectors' ? (
            <SectorsView />
          ) : view === 'weekly' ? (
            <WeeklyView />
          ) : view === 'insights' ? (
            <InsightsView lang={lang} onEntityClick={openEntity} onNewsClick={openNews} />
          ) : view === 'ideas' ? (
            <IdeasView />
          ) : view === 'feed' ? (
            <>
              {loading ? (
                <>
                  <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
                </>
              ) : news.length === 0 ? (
                feedError ? (
                  <div className="empty" style={{ marginTop: 40 }}>
                    <p>新闻加载失败</p>
                    <button className="load-more" onClick={() => loadNews(activeCat || '全部')} style={{ marginTop: 12 }}>重试</button>
                  </div>
                ) : (
                  <div className="empty">
                    <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                    <p>暂无新闻</p>
                    <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>切换分类看看，或稍后再来</p>
                  </div>
                )
              ) : (
                <>
                <div className="feed-toolbar">
                  <button className={`feed-toggle${onlyImportant ? ' active' : ''}`} onClick={() => setOnlyImportant(v => !v)} title="只看 AI 判定的重要报道">
                    只看重要
                  </button>
                  {blockedSources.size > 0 && (
                    <button className="feed-toggle" onClick={() => { setBlockedSources(new Set()); localStorage.setItem('blockedSources', '[]') }}>
                      已屏蔽 {blockedSources.size} 个来源 · 清除
                    </button>
                  )}
                </div>
                <Virtuoso
                  useWindowScroll
                  data={boostedNews}
                  endReached={() => {
                    if (!loadingMore && page * PAGE_SIZE < newsTotal) {
                      loadNews(activeCat || '全部', page + 1, true)
                    }
                  }}
                  components={{
                    Footer: () => (
                      <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                        {loadingMore ? '加载中...' : page * PAGE_SIZE < newsTotal ? '上滑加载更多' : '— 已显示全部 —'}
                      </div>
                    ),
                  }}
                  itemContent={(_index, item) => (
                    // 虚拟化后条目会随滚动挂载/卸载，逐条入场动画会反复播放，故只保留间距
                    <div style={{ paddingBottom: 10 }}>
                      <NewsCard
                        item={item}
                        lang={lang}
                        onClick={openNews}
                        followed={matchesFollow(item, followedEntityNames)}
                        isNew={new Date(item.createdAt).getTime() > lastVisitRef.current}
                        onHide={hideArticle}
                        onBlockSource={blockSource}
                      />
                    </div>
                  )}
                />
                </>
              )}
            </>
          ) : view === 'topics' ? (
            <TopicsView topics={topics} lang={lang} onNewsClick={openNews} />
          ) : (
            <DigestLoader
                dates={digestDates}
                lang={lang}
                onNewsClick={openNews}
                follows={follows}
                onEntityClick={openEntity}
                fallback={
                  <BriefingView
                    items={briefingItems}
                    updatedAt={briefingAt}
                    follows={follows}
                    lang={lang}
                    onNewsClick={openNews}
                    onEntityClick={openEntity}
                    onUnfollow={(name) => toggleFollow(name, 'entity')}
                    onNarrativeClick={(kw) => navigate(`#/narrative/${encodeURIComponent(kw)}`)}
                  />
                }
              />
              )}
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
        <aside className="sidebar">
          <TrendingPanel items={trending} lang={lang} onNewsClick={openNews} />
        </aside>
      </div>

      <footer className="footer" data-version={BUILD}>
        {stats.total > 0 && <>共 {stats.total} 篇 · 今日 {stats.today} 篇 · </>}
        <a href="#/trending" className="footer-link">热门</a> · <a href="#/narratives" className="footer-link">故事</a> · <a href="#/sources" className="footer-link">信源</a> · <a href="#/weekly" className="footer-link">周报</a> · <a href="#/insights" className="footer-link">洞察</a> · <a href="#/ideas" className="footer-link">灵感</a>
      </footer>

      <BottomNav active={navActive} />

      {/* AI 问答悬浮入口 */}
      <button
        className="ask-fab"
        onClick={() => { setAskQuery(''); setAskOpen(true) }}
        aria-label="问问简讯"
        title="问问简讯 · AI 搜索"
      >
        <MessageCircleQuestion size={21} />
      </button>

      {/* PWA 安装按钮（仅 Chrome 支持 beforeinstallprompt 时显示） */}
      {installEvent && (
        <button className="pwa-install-btn" onClick={handleInstall}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          安装到桌面
        </button>
      )}
      <AskView
        open={askOpen}
        initialQuestion={askQuery}
        lang={lang}
        onNewsClick={(id) => { setAskOpen(false); openNews(id) }}
        onClose={() => setAskOpen(false)}
        onResearch={(q) => { setAskOpen(false); navigate(`#/research?q=${encodeURIComponent(q)}`) }}
      />

      <DetailPanel
        newsId={selectedNewsId}
        lang={lang}
        onClose={goBack}
        onEntityClick={openEntity}
        onNewsClick={openNews}
        isFollowing={isFollowing}
        toggleFollow={toggleFollow}
      />

      <button className={`scroll-top ${scrolled ? 'visible' : ''}`} onClick={scrollToTop} aria-label="回到顶部">
        ↑
      </button>
    </div>
  )
}
