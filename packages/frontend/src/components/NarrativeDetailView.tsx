import { useState, useEffect } from 'react'
import { ArrowLeft, GitBranch, Bell, BellOff, BookOpen } from 'lucide-react'
import { decodeEntities } from '../utils'
import { getNarrative, type NarrativeDetail } from '../api'
import { NewsCard } from './NewsCard'

interface Props {
  keyword: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
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

  const narrType = keyword.startsWith('__breaking__') ? '突发' :
    keyword.startsWith('__research__') ? '研究' :
    keyword.startsWith('__debate__') ? '争议' :
    keyword.startsWith('__cross__') ? '多源' : null

  function cleanNarrativeTitle(label: string): string {
    return label.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').replace(/^(?:突发|争议|研究|多源对比:)\s*/, '').trim()
  }

  if (loading) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <div className="narr-detail-info">
            <div className="skeleton" style={{ height: 12, width: '30%', marginBottom: 6, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 22, width: '70%', borderRadius: 4 }} />
          </div>
        </div>
        <div className="narr-detail-skeleton" style={{ marginTop: 16 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 100, marginBottom: 12, borderRadius: 'var(--radius)' }} />)}
        </div>
      </div>
    )
  }

  if (error || !narrative) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <h2 className="narr-detail-title" style={{ flex: 1 }}>叙事未找到</h2>
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
        <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <div className="narr-detail-info">
          <div className="narr-detail-meta">
            {narrType && <span className="narr-type-badge">{narrType}</span>}
            <span className="narr-status">
              {narrative.status === 'active' ? '追踪中' : narrative.status === 'stale' ? '已停滞' : '已归档'}
            </span>
          </div>
          <h2 className="narr-detail-title">{cleanNarrativeTitle(narrative.label || narrative.keyword)}</h2>
        </div>
        <div className="narr-detail-actions">
          {toggleFollow && (
            <button className="narr-action-btn" onClick={() => toggleFollow(keyword, 'narrative')} title={followed ? '取消关注' : '关注此叙事'}>
              {followed ? <BellOff size={16} /> : <Bell size={16} />}
            </button>
          )}
          {onResearch && (
            <button className="narr-action-btn" onClick={() => onResearch(keyword, narrative?.label || keyword)} title="深度研究">
              <BookOpen size={16} />
            </button>
          )}
        </div>
      </div>

      {narrative.summary && (
        <div className="narr-detail-summary">
          <p>{decodeEntities(narrative.summary)}</p>
        </div>
      )}

      <div className="narr-detail-stats">
        <div className="nd-stat"><span className="nd-stat-num">{narrative.articleCount}</span> 篇文章</div>
        <div className="nd-stat"><span className="nd-stat-num">{narrative.developmentCount}</span> 条进展</div>
        <div className="nd-stat"><span className="nd-stat-num">{new Date(narrative.firstSeen).toLocaleDateString('zh-CN')}</span> 首次出现</div>
      </div>

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
                  <div className="nd-dev-text">{decodeEntities(dev.text)}</div>
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
