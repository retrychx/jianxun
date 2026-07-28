import { useEffect, useState } from 'react'
import { ChevronRight, Hash, Globe, Clock, TrendingUp, GitBranch, Newspaper } from 'lucide-react'
import type { NewsItem, NarrativeSummary } from '../api'
import { getByEntity, getNarratives } from '../api'
import { NewsCard } from './NewsCard'
import type { Lang } from '../utils'

interface EntityBriefing {
  entity: string
  articles: NewsItem[]
  relatedNarratives: { keyword: string; label: string; articleCount: number }[]
  sourceStats: { source: string; count: number }[]
}

interface Props {
  entity: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
  onNarrativeClick?: (keyword: string) => void
}

export function EntityView({ entity, lang, onBack, onNewsClick, onNarrativeClick }: Props) {
  const [briefing, setBriefing] = useState<EntityBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    Promise.all([getByEntity(entity), getNarratives()]).then(([articles, narratives]) => {
      if (cancelled) return
      // Find narratives that mention this entity
      const entityLower = entity.toLowerCase()
      const relatedNarratives = (narratives.narratives || []).filter(n =>
        (n.label || n.keyword || '').toLowerCase().includes(entityLower)
      ).map(n => ({ keyword: n.keyword, label: n.label, articleCount: n.articleCount }))
      // Source stats from articles
      const srcMap = new Map<string, number>()
      for (const a of articles.items || []) {
        const s = a.source || 'unknown'
        srcMap.set(s, (srcMap.get(s) || 0) + 1)
      }
      const sourceStats = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }))
      setBriefing({ entity, articles: articles.items, relatedNarratives, sourceStats })
      setLoading(false)
    }).catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [entity])

  if (loading) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  if (error || !briefing) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      <div className="empty" style={{ marginTop: 40 }}><Hash size={28} style={{ opacity: .3 }} /><p>加载失败</p></div>
    </div>
  )

  const maxCount = Math.max(...briefing.sourceStats.map(s => s.count), 1)

  return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>

      <div className="nd-hero" style={{ marginBottom: 20, paddingBottom: 16 }}>
        <h1 className="nd-hero-title">{briefing.entity}</h1>
        <div className="nd-cover-bar" style={{ marginTop: 10 }}>
          <div className="nd-cover-stat"><Newspaper size={14} /><span className="nd-cover-num">{briefing.articles.length}</span><span className="nd-cover-label">篇报道</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Globe size={14} /><span className="nd-cover-num">{briefing.sourceStats.length}</span><span className="nd-cover-label">个信源</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><GitBranch size={14} /><span className="nd-cover-num">{briefing.relatedNarratives.length}</span><span className="nd-cover-label">个叙事</span></div>
        </div>
      </div>

      {/* 信源覆盖 */}
      {briefing.sourceStats.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">信源覆盖</h3>
          <div className="nd-source-grid">
            {briefing.sourceStats.slice(0, 8).map(({ source, count }) => (
              <div key={source} className="nd-source-chip">
                <span className="nd-source-chip-name">{source}</span>
                <span className="nd-source-chip-bar"><span className="nd-source-chip-fill" style={{ width: `${(count / maxCount) * 100}%` }} /></span>
                <span className="nd-source-chip-count">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 关联叙事 */}
      {briefing.relatedNarratives.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关联故事 {onNarrativeClick ? '' : ''}</h3>
          <div className="nd-related-list">
            {briefing.relatedNarratives.slice(0, 5).map(r => (
              <button key={r.keyword} className={`nd-related-card ${onNarrativeClick ? 'clickable' : ''}`} onClick={() => onNarrativeClick?.(r.keyword)}>
                <div className="nd-related-top"><GitBranch size={14} className="nd-related-icon" /><span className="nd-related-label">{r.label.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim()}</span></div>
                <div className="nd-related-meta"><span>{r.articleCount} 篇</span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 相关报道 */}
      <h3 className="nd-section-title">相关报道</h3>
      {briefing.articles.length === 0 ? (
        <div className="empty" style={{ marginTop: 20 }}><Hash size={28} style={{ opacity: .3 }} /><p>暂无相关报道</p></div>
      ) : (
        <div className="card-list">
          {briefing.articles.map((item, i) => (
            <div key={item.id} className="card-enter" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
              <NewsCard item={item} lang={lang} onClick={onNewsClick} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
