import { useEffect, useState } from 'react'
import { ChevronRight, Hash, Globe, TrendingUp, GitBranch, Newspaper, Clock, Smile, Frown, Meh } from 'lucide-react'
import type { NewsItem, NarrativeSummary } from '../api'
import { decodeEntities } from '../utils'
import { NewsCard } from './NewsCard'
import type { Lang } from '../utils'

interface EntityBriefing {
  entity: string
  articleCount: number
  sourceStats: { source: string; count: number }[]
  sentimentTrend: { date: string; positive: number; negative: number; neutral: number; total: number }[]
  narratives: { keyword: string; label: string; articleCount: number; summary: string }[]
  keyPeople: { name: string; count: number }[]
  articles: NewsItem[]
}

interface Props {
  entity: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
  onNarrativeClick?: (keyword: string) => void
  onEntityClick?: (name: string) => void
}

export function EntityView({ entity, lang, onBack, onNewsClick, onNarrativeClick, onEntityClick }: Props) {
  const [briefing, setBriefing] = useState<EntityBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    fetch(`/api/news/entity/${encodeURIComponent(entity)}/briefing`).then(r => r.json()).then(d => {
      if (!cancelled) setBriefing(d)
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entity])

  if (loading) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 100, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  if (error || !briefing) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      <div className="empty" style={{ marginTop: 40 }}>
        <Hash size={28} style={{ opacity: .3, marginBottom: 8 }} />
        <p>加载失败</p>
        <button style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-secondary)' }} onClick={() => window.location.reload()}>重试</button>
      </div>
    </div>
  )

  const maxSrc = Math.max(...briefing.sourceStats.map(s => s.count), 1)
  const maxSent = Math.max(...briefing.sentimentTrend.map(s => s.total), 1)

  return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>

      {/* ═══ Hero ═══ */}
      <div className="nd-hero" style={{ marginBottom: 20, paddingBottom: 16 }}>
        <h1 className="nd-hero-title">{briefing.entity}</h1>
        <div className="nd-cover-bar" style={{ marginTop: 10 }}>
          <div className="nd-cover-stat"><Newspaper size={14} /><span className="nd-cover-num">{briefing.articleCount}</span><span className="nd-cover-label">篇报道</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Globe size={14} /><span className="nd-cover-num">{briefing.sourceStats.length}</span><span className="nd-cover-label">个信源</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><GitBranch size={14} /><span className="nd-cover-num">{briefing.narratives.length}</span><span className="nd-cover-label">个故事</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Clock size={14} /><span className="nd-cover-num">{briefing.sentimentTrend.length}</span><span className="nd-cover-label">天数据</span></div>
        </div>
      </div>

      {/* ═══ 情感趋势 ═══ */}
      {briefing.sentimentTrend.length > 1 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">情感走势</h3>
          <div className="eb-sent-chart">
            {briefing.sentimentTrend.map(day => (
              <div key={day.date} className="eb-sent-col" title={`${day.date} 正面${day.positive} 负面${day.negative} 中性${day.neutral}`}>
                <div className="eb-sent-bars">
                  <div className="eb-sent-bar positive" style={{ height: `${(day.positive / maxSent) * 100}%` }} />
                  <div className="eb-sent-bar negative" style={{ height: `${(day.negative / maxSent) * 100}%` }} />
                  <div className="eb-sent-bar neutral" style={{ height: `${(day.neutral / maxSent) * 100}%` }} />
                </div>
                <span className="eb-sent-label">{day.date.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="eb-sent-legend">
            <span><Smile size={12} style={{ color: '#059669' }} /> 正面</span>
            <span><Frown size={12} style={{ color: '#dc2626' }} /> 负面</span>
            <span><Meh size={12} style={{ color: '#a3a3a3' }} /> 中性</span>
          </div>
        </section>
      )}

      {/* ═══ 信源覆盖 ═══ */}
      {briefing.sourceStats.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">信源覆盖</h3>
          <div className="nd-source-grid">
            {briefing.sourceStats.slice(0, 10).map(({ source, count }) => (
              <div key={source} className="nd-source-chip">
                <span className="nd-source-chip-name">{source}</span>
                <span className="nd-source-chip-bar"><span className="nd-source-chip-fill" style={{ width: `${(count / maxSrc) * 100}%` }} /></span>
                <span className="nd-source-chip-count">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 关联故事 ═══ */}
      {briefing.narratives.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关联故事</h3>
          <div className="nd-related-list">
            {briefing.narratives.map(n => (
              <button key={n.keyword} className={`nd-related-card ${onNarrativeClick ? 'clickable' : ''}`} onClick={() => onNarrativeClick?.(n.keyword)}>
                <div className="nd-related-top"><GitBranch size={14} className="nd-related-icon" /><span className="nd-related-label">{n.label}</span></div>
                <div className="nd-related-meta"><span>{n.articleCount} 篇</span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 关键人物 ═══ */}
      {briefing.keyPeople && briefing.keyPeople.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关键人物</h3>
          <div className="eb-people">
            {briefing.keyPeople.map(p => (
              <span key={p.name} className="eb-person-chip" onClick={() => onEntityClick?.(p.name)} style={{ cursor: 'pointer' }}>
                <span className="eb-person-name">{p.name}</span>
                <span className="eb-person-count">{p.count} 篇</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 相关报道 ═══ */}
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
