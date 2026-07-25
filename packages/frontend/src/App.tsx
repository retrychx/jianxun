import { useState, useEffect, useCallback, useRef } from 'react'
import { Sun, Moon, Feather, ChevronRight, Newspaper } from 'lucide-react'
import { CategoryBar } from './components/CategoryBar'
import { NewsCard } from './components/NewsCard'
import { TrendingPanel, TrendingStrip } from './components/TrendingPanel'
import { DetailPanel } from './components/DetailPanel'
import { BriefingView } from './components/BriefingView'
import { TopicsView } from './components/TopicsView'
import { SearchView } from './components/SearchView'
import { EntityView } from './components/EntityView'
import { FetchMascot } from './components/FetchMascot'
import type { NewsItem, CategoryCount, TopicCluster, BriefingItem } from './api'
import { getNews, getTrending, getCategories, getStats, getTopics, getBriefing, searchNews } from './api'
import { useFollow } from './hooks/useFollow'
import { categoryColor } from './constants'
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

type View = 'briefing' | 'feed' | 'topics'
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
  const [activeCat, setActiveCat] = useState('全部')
  const [stats, setStats] = useState({ total: 0, today: 0 })
  const [initialLoading, setInitialLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [msg, setMsg] = useState('')
  const [selectedNewsId, setSelectedNewsId] = useState<number | null>(null)
  const [view, setView] = useState<View>('briefing')
  const [entityView, setEntityView] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(getTheme)
  const [scrolled, setScrolled] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NewsItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const { follows, isFollowing, toggleFollow } = useFollow()

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const cycleTheme = () => setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])

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
      await Promise.all([loadAll(), loadNews('全部'), loadStats()])
      if (!cancelled) setInitialLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [loadAll, loadNews, loadStats])

  const handleCategory = (cat: string) => {
    setActiveCat(cat)
    setSearchQuery('')
    setEntityView(null)
    setView('feed')
    loadNews(cat)
  }

  const handleNewsClick = useCallback((id: number) => setSelectedNewsId(id), [])

  const openEntity = useCallback((name: string) => {
    setEntityView(name)
    setSelectedNewsId(null)
  }, [])

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

  const searchActive = searchQuery.trim().length > 0

  // Stats for mini viz
  const totalScore = categories.reduce((s, c) => s + c.count, 0) || 1

  const themeMeta = THEME_META[theme]

  const backToBriefing = (
    <button className="browse-back" onClick={() => setView('briefing')}>
      <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
      <span>返回简报</span>
    </button>
  )

  return (
    <div className="app">
      {msg && <div className="toast">{msg}</div>}

      <header className="header">
        <div className="header-top">
          <h1 className="logo">简讯</h1>
          <div className="header-search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hs-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="hs-field" placeholder="搜索新闻..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} aria-label="搜索新闻" />
            {searchQuery && <button className="hs-field-clear" onClick={() => setSearchQuery('')} aria-label="清除搜索">&times;</button>}
          </div>
          <div className="header-actions">
            <button className="ha-btn" onClick={cycleTheme} title={`主题：${themeMeta.label}`} aria-label={`切换主题，当前为${themeMeta.label}模式`}>
              <themeMeta.Icon size={15} />
            </button>
          </div>
        </div>
      </header>
      <CategoryBar categories={categories} active={activeCat} onSelect={handleCategory} />

      {/* Mini data viz */}
      {categories.length > 0 && (
        <div className="stats-bar">
          {categories.slice(0, 7).map(c => (
            <div key={c.name} className="stat-item">
              <span className="stat-dot" style={{ background: categoryColor(c.name) }} />
              {c.name}
            </div>
          ))}
          <div className="stat-bar-group">
            {categories.slice(0, 12).map(c => {
              const pct = Math.min((c.count / totalScore) * 20 + 4, 20)
              return (
                <div
                  key={c.name}
                  className="stat-bar-seg"
                  style={{ height: pct, background: categoryColor(c.name) }}
                  title={`${c.name}: ${c.count}`}
                />
              )
            })}
          </div>
        </div>
      )}

      <TrendingStrip items={trending} onNewsClick={handleNewsClick} />

      <div className="main-layout">
        <div className="news-feed">
          {initialLoading ? (
            <FetchMascot />
          ) : searchActive ? (
            <SearchView
              results={searchResults}
              query={searchQuery.trim()}
              searching={searching}
              error={searchError}
              onClear={() => setSearchQuery('')}
              onNewsClick={handleNewsClick}
            />
          ) : entityView ? (
            <EntityView entity={entityView} onBack={() => setEntityView(null)} onNewsClick={handleNewsClick} />
          ) : view === 'briefing' ? (
            <BriefingView
              items={briefingItems}
              topics={topics}
              newsCount={newsTotal}
              updatedAt={briefingAt}
              follows={follows}
              onNewsClick={handleNewsClick}
              onShowTopics={() => setView('topics')}
              onShowFeed={() => setView('feed')}
              onEntityClick={openEntity}
              onUnfollow={(name) => toggleFollow(name, 'entity')}
            />
          ) : view === 'feed' ? (
            <>
              {backToBriefing}
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
                        <NewsCard item={item} onClick={handleNewsClick} />
                      </div>
                    ))}
                  </div>
                  {page * PAGE_SIZE < newsTotal && (
                    <button className="load-more" onClick={() => loadNews(activeCat, page + 1, true)} disabled={loadingMore}>
                      {loadingMore ? '加载中...' : `加载更多（还有 ${newsTotal - news.length} 篇）`}
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {backToBriefing}
              <TopicsView topics={topics} onNewsClick={handleNewsClick} />
            </>
          )}
        </div>
        <aside className="sidebar">
          <TrendingPanel items={trending} onNewsClick={handleNewsClick} />
        </aside>
      </div>

      {stats.total > 0 && (
        <footer className="footer">共 {stats.total} 篇 · 今日 {stats.today} 篇</footer>
      )}

      <DetailPanel
        newsId={selectedNewsId}
        onClose={() => setSelectedNewsId(null)}
        onEntityClick={openEntity}
        onNewsClick={handleNewsClick}
        isFollowing={isFollowing}
        toggleFollow={toggleFollow}
      />

      <button className={`scroll-top ${scrolled ? 'visible' : ''}`} onClick={scrollToTop} aria-label="回到顶部">
        ↑
      </button>
    </div>
  )
}
