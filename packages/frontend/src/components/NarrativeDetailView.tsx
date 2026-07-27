import { useState, useEffect } from 'react'
import { ArrowLeft, GitBranch, Newspaper, Bell, BellOff, BookOpen } from 'lucide-react'
import { getNarrative, type NarrativeDetail, type NewsItem } from '../api'
import { NewsCard } from './NewsCard'

interface Props {
  keyword: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
  /** 关注状态（父组件维护，传给 SSE 监听用） */
  isFollowing?: (id: string) => boolean
  toggleFollow?: (name: string, type: 'entity' | 'category' | 'source' | 'narrative') => void
  onResearch?: (keyword: string, label: string) => void
}

type Lang = 'zh' | 'en'

export function NarrativeDetailView({ keyword, lang, onBack, onNewsClick, isFollowing, toggleFollow, onResearch }: Props) {
  const [narrative, setNarrative] = useState<NarrativeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getNarrative(keyword).then(n => {
      if (!cancelled) { setNarrative(n); setLoading(false) }
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [keyword])

  const followId = `narrative:${keyword}`
  const followed = isFollowing?.(followId) ?? false

  if (loading) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /></button>
        </div>
        <div className="narr-detail-skeleton">
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 100, marginBottom: 12, borderRadius: 'var(--radius)' }} />)}
        </div>
      </div>
    )
  }

  if (error || !narrative) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /></button>
          <h2 className="narr-detail-title">叙事详情</h2>
        </div>
        <div className="empty" style={{ marginTop: 40 }}>
          <GitBranch size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>叙事未找到</p>
        </div>
      </div>
    )
  }

  return (
    <div className="narr-detail">
      <div className="narr-detail-top">
        <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="narr-detail-info">
          <h2 className="narr-detail-title">{narrative.label || narrative.keyword}</h2>
          <span className={`narr-status narr-${narrative.status}`}>
            {narrative.status === 'active' ? '追踪中' : narrative.status === 'stale' ? '已停滞' : '已归档'}
          </span>
        </div>
        {toggleFollow && (
          <button
            className="narr-follow-btn"
            onClick={() => toggleFollow(keyword, 'narrative')}
            title={followed ? '取消关注' : '关注此叙事'}
            aria-label={followed ? '取消关注' : '关注此叙事'}
          >
            {followed ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
        )}
        {onResearch && (
          <button
            className="narr-research-btn"
            onClick={() => onResearch(keyword, narrative?.label || keyword)}
            title="深度研究"
            aria-label="深度研究"
          >
            <BookOpen size={16} />
          </button>
        )}
      </div>

      {/* Summary */}
      {narrative.summary && (
        <div className="narr-detail-summary">
          <p>{narrative.summary}</p>
        </div>
      )}

      {/* Stats */}
      <div className="narr-detail-stats">
        <div className="nd-stat"><span className="nd-stat-num">{narrative.articleCount}</span> 篇文章</div>
        <div className="nd-stat"><span className="nd-stat-num">{narrative.developmentCount}</span> 条进展</div>
        <div className="nd-stat"><span className="nd-stat-num">{new Date(narrative.firstSeen).toLocaleDateString('zh-CN')}</span> 首次出现</div>
      </div>

      {/* Developments Timeline */}
      {narrative.developments.length > 0 && (
        <div className="nd-dev-section">
          <h3 className="nd-dev-title">关键进展</h3>
          <div className="nd-dev-timeline">
            {narrative.developments.map((dev, i) => (
              <div key={i} className="nd-dev-item">
                <div className={`nd-dev-dot ${i === narrative.developments.length - 1 ? 'latest' : ''}`} />
                {i < narrative.developments.length - 1 && <div className="nd-dev-line" />}
                <div className="nd-dev-body">
                  <div className="nd-dev-date">{dev.date}</div>
                  <div className="nd-dev-text">{dev.text}</div>
                  <div className="nd-dev-meta">
                    <span>{dev.articleCount} 篇</span>
                    {dev.sources?.slice(0, 3).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source Breakdown */}
      {Object.keys(narrative.sourceStats).length > 0 && (
        <div className="nd-sources-section">
          <h3 className="nd-dev-title">来源分布</h3>
          <div className="nd-sources-list">
            {Object.entries(narrative.sourceStats)
              .sort(([, a], [, b]) => b - a)
              .map(([src, count]) => {
                const max = Math.max(...Object.values(narrative.sourceStats))
                const pct = (count / max) * 100
                return (
                  <div key={src} className="nd-source-row">
                    <span className="nd-source-name">{src}</span>
                    <div className="nd-source-bar-wrap">
                      <div className="nd-source-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="nd-source-count">{count}</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Related Articles */}
      {narrative.articles.length > 0 && (
        <div className="nd-articles-section">
          <h3 className="nd-dev-title">相关报道</h3>
          {narrative.articles.map(item => (
            <NewsCard key={item.id} item={item} lang={lang} onClick={onNewsClick} />
          ))}
        </div>
      )}
    </div>
  )
}
