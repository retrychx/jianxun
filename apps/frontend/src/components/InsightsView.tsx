import { useEffect, useState } from 'react'
import { Hash, TrendingUp, Newspaper, ArrowUpRight } from 'lucide-react'
import type { InsightsResponse } from '../api'
import type { Lang } from '../utils'

interface Props {
  lang: Lang
  onEntityClick: (name: string) => void
  onNewsClick: (id: number) => void
}

function Empty() {
  return <div className="empty" style={{ padding: '20px 0' }}><p style={{ fontSize: 13 }}>暂无数据</p></div>
}

// 读者洞察：点击数据（signals / click_count）→ 可读统计
export function InsightsView({ lang, onEntityClick, onNewsClick }: Props) {
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    fetch('/api/news/insights').then(r => r.json()).then(d => {
      if (!cancelled) setData(d)
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) return (
    <div className="insights-view">
      <div className="nv-header"><h2 className="nv-title">读者洞察</h2></div>
      {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 70, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  if (error || !data) return (
    <div className="insights-view">
      <div className="nv-header"><h2 className="nv-title">读者洞察</h2></div>
      <div className="empty" style={{ marginTop: 40 }}>
        <p>洞察数据加载失败</p>
        <button className="load-more" onClick={() => setReloadKey(k => k + 1)} style={{ marginTop: 12 }}>重试</button>
      </div>
    </div>
  )

  const row = (i: number, name: string, meta: string, onClick?: () => void) => (
    <div
      key={name + i}
      className="insights-row"
      role="link"
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <span className="insights-rank">{i + 1}</span>
      <span className="insights-row-name">{name}</span>
      <span className="insights-row-meta">{meta}</span>
    </div>
  )

  return (
    <div className="insights-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">读者洞察</h2>
          <p className="nv-subtitle">基于你的阅读行为 · 近 7 天</p>
        </div>
      </div>

      <div className="insights-section">
        <div className="insights-section-title"><Hash size={13} /> 热门实体</div>
        {data.topEntities.length === 0 ? <Empty /> : data.topEntities.map((e, i) => row(i, e.name, `${e.count} 次点击`, () => onEntityClick(e.name)))}
      </div>

      <div className="insights-section">
        <div className="insights-section-title"><TrendingUp size={13} /> 24h 升温</div>
        {data.risingEntities.length === 0 ? <Empty /> : data.risingEntities.map((e, i) => row(i, e.name, `${e.count} 次`, () => onEntityClick(e.name)))}
      </div>

      <div className="insights-section">
        <div className="insights-section-title"><Newspaper size={13} /> 最多阅读</div>
        {data.mostRead.length === 0 ? <Empty /> : data.mostRead.map((a, i) => row(i, a.title, `${a.clicks} 次`, () => onNewsClick(a.id)))}
      </div>

      <div className="insights-section">
        <div className="insights-section-title"><ArrowUpRight size={13} /> 热门来源</div>
        {data.topSources.length === 0 ? <Empty /> : data.topSources.map((s, i) => row(i, s.name, `${s.clicks} 次`))}
      </div>
    </div>
  )
}
