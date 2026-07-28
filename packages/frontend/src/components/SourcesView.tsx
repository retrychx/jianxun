import { useEffect, useState } from 'react'
import { Rss, Globe, Newspaper, TrendingUp, AlertCircle, CheckCircle, Hash } from 'lucide-react'
import type { SourceHealth } from '../api'
import { getSources } from '../api'

export function SourcesView() {
  const [items, setItems] = useState<SourceHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSources()
      .then(res => { if (!cancelled) setItems(Array.isArray(res.items) ? res.items : []) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return (
    <div className="sources-view">
      <div className="nv-header"><h2 className="nv-title">信源档案</h2></div>
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  if (error) return (
    <div className="sources-view">
      <div className="nv-header"><h2 className="nv-title">信源档案</h2></div>
      <div className="empty" style={{ marginTop: 40 }}>
        <Rss size={28} style={{ opacity: .3, marginBottom: 8 }} />
        <p>加载失败</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-secondary)' }}>重试</button>
      </div>
    </div>
  )

  const sorted = [...items].sort((a, b) => (b.today ?? 0) - (a.today ?? 0))

  return (
    <div className="sources-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">信源档案</h2>
          <p className="nv-subtitle">{sorted.length} 个信源 · 今日产量 {sorted.reduce((s, i) => s + (i.today || 0), 0)} 篇</p>
        </div>
      </div>

      <div className="src-grid">
        {sorted.map(s => {
          const health = s.failCount > 0 ? 'warning' : 'ok'
          const entityCount = s.topEntities?.length || 0
          return (
            <div key={s.name} className="src-card">
              <div className="src-card-header">
                <span className="src-card-name">{s.name}</span>
                <span className={`src-health src-${health}`}>
                  {health === 'ok' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                  {health === 'ok' ? '正常' : `${s.failCount} 次失败`}
                </span>
              </div>
              <div className="src-card-stats">
                <span className="src-stat"><Newspaper size={12} /> 今日 <strong>{s.today}</strong></span>
                <span className="src-stat"><Globe size={12} /> 总量 <strong>{s.total}</strong></span>
                <span className="src-stat"><TrendingUp size={12} /> 权重 <strong>{s.weight}</strong></span>
              </div>
              {s.topCategories && s.topCategories.length > 0 && (
                <div className="src-categories" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {s.topCategories.map(c => <span key={c} className="src-cat-tag">{c}</span>)}
                </div>
              )}
              {entityCount > 0 && (
                <div className="src-entities">
                  <Hash size={10} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  {s.topEntities!.slice(0, 4).map(e => (
                    <span key={e.name} className="src-entity-tag">{e.name}</span>
                  ))}
                  {s.topEntities!.length > 4 && <span className="src-entity-more">+{s.topEntities!.length - 4}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
