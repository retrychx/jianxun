import { useState, useEffect, useCallback, useRef } from 'react'
import { CategoryBar } from './components/CategoryBar'
import { NewsCard } from './components/NewsCard'
import { TrendingPanel } from './components/TrendingPanel'
import { DetailPanel } from './components/DetailPanel'
import { BriefingView } from './components/BriefingView'
import { TopicsView } from './components/TopicsView'
import { SearchView } from './components/SearchView'
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
  const [searchOpen, setSearchOpen] = useState(false)
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
        <div className="header-top">
          {view !== 'briefing' && (
            <button className="back-btn" onClick={() => setView('briefing')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <h1 className="logo">{view === 'briefing' ? '简讯' : view === 'topics' ? '话题' : '时间线'}</h1>
          <div className="header-actions">
            <button className="ha-btn" onClick={() => handleSearch(searchQuery || ' ')} title="搜索">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
            <button className="ha-btn" onClick={cycleTheme} title={theme}>
              {theme === 'light' ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>}
            </button>
            <button className="ha-btn" onClick={handleFetch} disabled={fetching} title="刷新">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={fetching ? { animation: 'spin .6s linear infinite' } : undefined}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="header-search-bar">
            <input className="hs-input-wide" placeholder="搜索..." value={searchQuery} onChange={e => handleSearch(e.target.value)} autoFocus />
            <button className="hs-close" onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults(null) }}>&times;</button>
          </div>
        )}

      </header>
      {view === 'feed' && <CategoryBar categories={categories} active={activeCat} onSelect={handleCategory} />}

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
          {searchResults !== null ? (
            <SearchView results={searchResults} query={searchQuery} onClear={() => handleSearch('')} onNewsClick={(id) => setSelectedNewsId(id)} />
          ) : view === 'briefing' ? (
            <BriefingView items={briefingItems} topics={topics} news={news} onNewsClick={(id) => setSelectedNewsId(id)} />
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
