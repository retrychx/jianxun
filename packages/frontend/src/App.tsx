import { useState, useEffect, useCallback, useRef } from 'react'
import { CategoryBar } from './components/CategoryBar'
import { NewsCard } from './components/NewsCard'
import { TrendingPanel } from './components/TrendingPanel'
import { DetailPanel } from './components/DetailPanel'
import { BriefingView } from './components/BriefingView'
import { TopicsView } from './components/TopicsView'
import { FetchMascot } from './components/FetchMascot'
import type { NewsItem, CategoryCount, TopicCluster, BriefingItem } from './api'
import { getNews, getTrending, getCategories, getStats, triggerFetch, getTopics, getBriefing, searchNews } from './api'
import './App.css'

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#b91c1c', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#737373',
}

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

function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const stored = localStorage.getItem('theme') as Theme | null
  if (stored && THEMES.includes(stored)) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [trending, setTrending] = useState<NewsItem[]>([])
  const [topics, setTopics] = useState<TopicCluster[]>([])
  const [briefingItems, setBriefingItems] = useState<BriefingItem[]>([])
  const [categories, setCategories] = useState<CategoryCount[]>([])
  const [activeCat, setActiveCat] = useState('全部')
  const [stats, setStats] = useState({ total: 0, today: 0 })
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState('')
  const [selectedNewsId, setSelectedNewsId] = useState<number | null>(null)
  const [view, setView] = useState<'briefing' | 'feed' | 'topics'>('briefing')
const [theme, setTheme] = useState<Theme>(getTheme)
  const [scrolled, setScrolled] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NewsItem[] | null>(null)

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

  // Ripple
  const handleCardClick = useCallback((id: number) => (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--x', `${((e.clientX - rect.left) / rect.width) * 100}%`)
    el.style.setProperty('--y', `${((e.clientY - rect.top) / rect.height) * 100}%`)
    setSelectedNewsId(id)
  }, [])

  const loadNews = useCallback(async (cat: string) => {
    setLoading(true)
    try {
      const data = await getNews({ category: cat, pageSize: 50 })
      setNews(data.items)
    } finally { setLoading(false) }
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [cats, tr, tp, br] = await Promise.all([getCategories(), getTrending(), getTopics(), getBriefing()])
      setCategories(cats.categories)
      setTrending(tr.items)
      setTopics(tp.topics)
      setBriefingItems(br.items)
    } catch { /* */ }
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await getStats()) } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      await loadAll()
      if (cancelled) return
      await loadNews('全部')
      if (cancelled) return
      await loadStats()
    }
    init()
    return () => { cancelled = true }
  }, [loadAll, loadNews, loadStats])



  const handleCategory = (cat: string) => { setActiveCat(cat); if (view === 'feed') loadNews(cat) }

  const handleSearch = async (q: string) => {
    setSearchQuery(q)
    if (!q || q.length < 2) { setSearchResults(null); return }
    setLoading(true)
    try {
      const res = await searchNews(q)
      setSearchResults(res.items)
    } catch { setSearchResults([]) }
    finally { setLoading(false) }
  }

  const handleFetch = async () => {
    setFetching(true); setMsg('正在抓取新闻...')
    try {
      const res = await triggerFetch()
      setMsg(`已获取 ${res.fetched} 条新新闻`)
      await Promise.all([loadAll(), loadNews(activeCat), loadStats()])
    } catch (e) { setMsg(`抓取失败: ${(e as Error).message}`) }
    finally { setFetching(false); setTimeout(() => setMsg(''), 4000) }
  }

  // Stats for mini viz
  const totalScore = categories.reduce((s, c) => s + c.count, 0) || 1

  return (
    <div className="app">
      {msg && <div className="toast">{msg}</div>}

      <header className="header">
        <div className="header-left">
          <h1 className="logo">简讯</h1>
          <span className="header-divider" />
          <span className="subtitle">AI 智能分类</span>
        </div>
        <div className="header-right">
          <div className="view-toggle">
            <button className={`view-btn ${view === 'briefing' ? 'active' : ''}`} onClick={() => setView('briefing')}>简报</button>
            <button className={`view-btn ${view === 'topics' ? 'active' : ''}`} onClick={() => setView('topics')}>话题簇</button>
            <button className={`view-btn ${view === 'feed' ? 'active' : ''}`} onClick={() => setView('feed')}>时间线</button>
          </div>
          <span className="stat-badge">{stats.total} 条</span>
          <span className="stat-badge today">今日 {stats.today} 条</span>
          <button className="theme-btn" onClick={cycleTheme} title={theme}>
            {theme === 'light' ? '明' : theme === 'dark' ? '暗' : '旧'}
          </button>
          <button className="fetch-btn" onClick={handleFetch} disabled={fetching}>
            {fetching ? '抓取中...' : '刷新'}
          </button>
        </div>
      </header>

      <CategoryBar categories={categories} active={activeCat} onSelect={handleCategory} />

      {/* Mini data viz */}
      {categories.length > 0 && (
        <div className="stats-bar">
          {categories.slice(0, 7).map(c => (
            <div key={c.name} className="stat-item">
              <span className="stat-dot" style={{ background: CATEGORY_COLORS[c.name] || '#78716c' }} />
              {c.name}
            </div>
          ))}
          <div className="stat-bar-group">
            {categories.slice(0, 12).map(c => {
              const pct = (c.count / totalScore) * 20 + 4
              return (
                <div
                  key={c.name}
                  className="stat-bar-seg"
                  style={{ height: pct, background: CATEGORY_COLORS[c.name] || '#78716c' }}
                  title={`${c.name}: ${c.count}`}
                />
              )
            })}
          </div>
        </div>
      )}

      {fetching && <FetchMascot fetching={fetching} />}

      <div className="main-layout">
        <div className="news-feed">
          {view === 'briefing' ? (
            <BriefingView items={briefingItems} onNewsClick={(id) => setSelectedNewsId(id)} />
          ) : view === 'feed' ? (
            loading ? (
              <>
                <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
              </>
            ) : news.length === 0 ? (
              <div className="empty">
                <p style={{ fontSize: 24, marginBottom: 8, color: 'var(--text-tertiary)' }}>/</p>
                <p>暂无新闻</p>
                <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>点击右上角「刷新」按钮获取最新资讯</p>
              </div>
            ) : (
              <>
                <div className="card-list">
                  {news.map((item, i) => (
                    <div key={item.id} className="card-enter" style={{ animationDelay: `${i * 40}ms` }}>
                      <NewsCard item={item} onClick={handleCardClick(item.id)} />
                    </div>
                  ))}
                </div>

              
              </>
            )
          ) : (
            <TopicsView topics={topics} onNewsClick={(id) => setSelectedNewsId(id)} />
          )}
        </div>
        <aside className="sidebar">
          <TrendingPanel items={trending} />
        </aside>
      </div>

      <DetailPanel
        newsId={selectedNewsId}
        onClose={() => setSelectedNewsId(null)}
        onEntityClick={(entity) => {
          setActiveCat('全部'); setLoading(true)
          getNews({ category: '全部', pageSize: 50 }).then(data => {
            setNews(data.items.filter(i => i.title.includes(entity) || (i.description || '').includes(entity)))
            setLoading(false)
          })
        }}
      />

      <button className={`scroll-top ${scrolled ? 'visible' : ''}`} onClick={scrollToTop}>
        ↑
      </button>
    </div>
  )
}
