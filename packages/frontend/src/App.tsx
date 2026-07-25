import { useState, useEffect, useCallback, useRef } from 'react'
import { Sun, Moon, Feather, Newspaper } from 'lucide-react'
import { CategoryBar } from './components/CategoryBar'
import { NewsCard } from './components/NewsCard'
import { TrendingPanel, TrendingStrip } from './components/TrendingPanel'
import { DetailPanel } from './components/DetailPanel'
import { BriefingView } from './components/BriefingView'
import { TopicsView } from './components/TopicsView'
import { SearchView } from './components/SearchView'
import { EntityView } from './components/EntityView'
import { FetchMascot } from './components/FetchMascot'
import { BottomNav } from './components/BottomNav'
import { KinkLine } from './components/KinkLine'
import type { NewsItem, CategoryCount, TopicCluster, BriefingItem } from './api'
import { getNews, getTrending, getCategories, getStats, getTopics, getBriefing, searchNews } from './api'
import { useFollow } from './hooks/useFollow'
import { useHashRoute, useNavigate, buildHash, type Route } from './hooks/useHashRoute'
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

type Theme = 'light' | 'dark' | 'retro'
const THEMES: Theme[] = ['light', 'dark', 'retro']
const THEME_META: Record<Theme, { label: string; Icon: typeof Sun }> = {
  light: { label: '浅色', Icon: Sun },
  dark: { label: '深色', Icon: Moon },
  retro: { label: '复古', Icon: Feather },
}

function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const stored = localStorage.getItem('theme') as Theme | null
  if (stored && THEMES.includes(stored)) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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
  const [msg, setMsg] = useState('')
  const [theme, setTheme] = useState<Theme>(getTheme)
  const [scrolled, setScrolled] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NewsItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const { follows, isFollowing, toggleFollow } = useFollow()

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

  // 记录会话内导航次数：区分「SPA 内打开详情」与「刷新/分享直达详情」
  const navCountRef = useRef(0)
  const lastViewHashRef = useRef('#/')

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

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

  const loadNews = useCallback(async (cat: string, pageNum = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const data = await getNews({ category: cat, page: pageNum, pageSize: PAGE_SIZE })
      setNews(prev => append ? [...prev, ...data.items] : data.items)
      setNewsTotal(data.total)
      setPage(pageNum)
    } catch {
      showToast('新闻加载失败，请稍后重试')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
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

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await Promise.all([loadAll(), loadStats()])
      if (!cancelled) setInitialLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [loadAll, loadStats])

  // feed 视图：路由驱动加载与分类切换
  const routeView = baseRoute.view
  const routeCat = baseRoute.cat
  useEffect(() => {
    if (routeView !== 'feed') return
    loadNews(routeCat ?? '全部')
  }, [routeView, routeCat, loadNews])

  // 视图切换后回到顶部
  const routeEntity = baseRoute.entity
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [routeView, routeCat, routeEntity])

  // 搜索框与路由双向同步；记录最近非搜索视图供清空后返回
  const searchNavRef = useRef(false) // 本次 search 跳转来自输入框，跳过后续 query 回写
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

  const handleSearchChange = (v: string) => {
    setSearchQuery(v)
    if (v.trim()) {
      const hash = buildHash({ view: 'search', q: v.trim() })
      if (window.location.hash.startsWith('#/search')) {
        navigate(hash, true) // 输入中只替换 URL，不刷历史
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
    navigate(`#/news/${id}`)
  }, [navigate])

  const openEntity = useCallback((name: string) => {
    navCountRef.current++
    navigate(buildHash({ view: 'entity', entity: name }))
  }, [navigate])

  // 返回键：SPA 内有历史则后退，否则（刷新/分享直达）回到简报
  const goBack = useCallback(() => {
    if (navCountRef.current > 0) window.history.back()
    else navigate('#/')
  }, [navigate])

  // Search: 300ms debounce + 请求序号防竞态
  const searchSeq = useRef(0)
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      searchSeq.current++
      setSearchResults([])
      setSearchError(false)
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      try {
        const res = await searchNews(q)
        if (seq !== searchSeq.current) return
        setSearchResults(res.items)
        setSearchError(false)
      } catch {
        if (seq !== searchSeq.current) return
        setSearchResults([])
        setSearchError(true)
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  return (
    <div className="app">
      {msg && <div className="toast">{msg}</div>}

      <header className="header">
        <div className="header-top">
          <h1 className="logo"><a href="#/" aria-label="简讯首页">简讯</a></h1>
          <nav className="header-nav" aria-label="主导航">
            <a href="#/" className={view === 'briefing' ? 'active' : ''} aria-current={view === 'briefing' ? 'page' : undefined}>简报<KinkLine /></a>
            <a href="#/feed" className={view === 'feed' ? 'active' : ''} aria-current={view === 'feed' ? 'page' : undefined}>新闻<KinkLine /></a>
            <a href="#/topics" className={view === 'topics' ? 'active' : ''} aria-current={view === 'topics' ? 'page' : undefined}>话题<KinkLine /></a>
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
        </div>
      </header>
      <CategoryBar categories={categories} active={activeCat} onSelect={handleCategory} />

      <div className="main-layout">
        <div className="news-feed">
          {initialLoading ? (
            <FetchMascot />
          ) : view === 'search' ? (
            <SearchView
              results={searchResults}
              query={searchQuery.trim()}
              searching={searching}
              error={searchError}
              onClear={() => handleSearchChange('')}
              onNewsClick={openNews}
            />
          ) : view === 'entity' && baseRoute.entity ? (
            <EntityView entity={baseRoute.entity} onBack={goBack} onNewsClick={openNews} />
          ) : view === 'feed' ? (
            <>
              <TrendingStrip items={trending} onNewsClick={openNews} />
              {loading ? (
                <>
                  <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
                </>
              ) : news.length === 0 ? (
                <div className="empty">
                  <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
                  <p>暂无新闻</p>
                  <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>切换分类看看，或稍后再来</p>
                </div>
              ) : (
                <>
                  <div className="card-list">
                    {news.map((item, i) => (
                      <div key={item.id} className="card-enter" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                        <NewsCard item={item} onClick={openNews} />
                      </div>
                    ))}
                  </div>
                  {page * PAGE_SIZE < newsTotal && (
                    <button className="load-more" onClick={() => loadNews(activeCat || '全部', page + 1, true)} disabled={loadingMore}>
                      {loadingMore ? '加载中...' : `加载更多（还有 ${newsTotal - news.length} 篇）`}
                    </button>
                  )}
                </>
              )}
            </>
          ) : view === 'topics' ? (
            <TopicsView topics={topics} onNewsClick={openNews} />
          ) : (
            <BriefingView
              items={briefingItems}
              updatedAt={briefingAt}
              follows={follows}
              onNewsClick={openNews}
              onEntityClick={openEntity}
              onUnfollow={(name) => toggleFollow(name, 'entity')}
            />
          )}
        </div>
        <aside className="sidebar">
          <TrendingPanel items={trending} onNewsClick={openNews} />
        </aside>
      </div>

      {stats.total > 0 && (
        <footer className="footer">共 {stats.total} 篇 · 今日 {stats.today} 篇</footer>
      )}

      <BottomNav active={view} />

      <DetailPanel
        newsId={selectedNewsId}
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
