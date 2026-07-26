import { useState, useEffect } from 'react'
import { GitBranch, ChevronRight, Clock, Newspaper } from 'lucide-react'
import { getNarratives, getNarrativesTimeline, type NarrativeSummary } from '../api'
import { formatDate } from '../utils'

interface Props {
  onNarrativeClick: (keyword: string) => void
  onNewsClick: (id: number) => void
}

export function NarrativesView({ onNarrativeClick, onNewsClick }: Props) {
  const [narratives, setNarratives] = useState<NarrativeSummary[]>([])
  const [timeline, setTimeline] = useState<{ date: string; items: any[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'narratives' | 'timeline'>('narratives')

  useEffect(() => {
    let cancelled = false
    Promise.all([getNarratives(), getNarrativesTimeline()]).then(([n, t]) => {
      if (cancelled) return
      setNarratives(n.narratives)
      setTimeline(t.timeline)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="narratives-view">
        <div className="nv-header">
          <h2 className="nv-title">叙事追踪</h2>
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="narr-card skeleton" style={{ height: 80, marginBottom: 10, borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    )
  }

  if (!narratives.length) {
    return (
      <div className="narratives-view">
        <div className="nv-header">
          <h2 className="nv-title">叙事追踪</h2>
        </div>
        <div className="empty" style={{ marginTop: 40 }}>
          <GitBranch size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无可追踪的叙事</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>当话题在多轮抓取中持续出现时，Agent 将自动创建叙事</p>
        </div>
      </div>
    )
  }

  return (
    <div className="narratives-view">
      <div className="nv-header">
        <h2 className="nv-title">叙事追踪</h2>
        <span className="nv-sub">{narratives.length} 个活跃叙事</span>
      </div>

      <div className="nv-tabs">
        <button
          className={`nv-tab ${tab === 'narratives' ? 'active' : ''}`}
          onClick={() => setTab('narratives')}
        >
          <GitBranch size={14} /> 叙事
        </button>
        <button
          className={`nv-tab ${tab === 'timeline' ? 'active' : ''}`}
          onClick={() => setTab('timeline')}
        >
          <Clock size={14} /> 时间线
        </button>
      </div>

      {tab === 'narratives' ? (
        <div className="nv-list">
          {narratives.map(n => (
            <button key={n.keyword} className="narr-card" onClick={() => onNarrativeClick(n.keyword)}>
              <div className="narr-card-top">
                <span className={`narr-status narr-${n.status}`}>{n.status === 'active' ? '追踪中' : '已停滞'}</span>
                <ChevronRight size={14} className="narr-chevron" />
              </div>
              <div className="narr-card-label">{n.label}</div>
              {n.summary && <div className="narr-card-summary">{n.summary}</div>}
              <div className="narr-card-meta">
                <span>{n.articleCount} 篇文章</span>
                <span>{n.developmentCount} 条进展</span>
                <span>{Object.keys(n.sourceStats).length} 个来源</span>
              </div>
              <div className="narr-card-sources">
                {Object.entries(n.sourceStats)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([src, count]) => (
                    <span key={src} className="narr-source-tag">
                      {src} <small>{count}</small>
                    </span>
                  ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="nv-timeline">
          {timeline.length === 0 ? (
            <div className="empty">
              <Clock size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
              <p>暂无时间线数据</p>
            </div>
          ) : (
            timeline.map(day => (
              <div key={day.date} className="tl-day">
                <div className="tl-day-header">{formatDate(day.date)}</div>
                <div className="tl-day-items">
                  {day.items.map((item, i) => (
                    <div key={`${item.keyword}-${i}`} className="tl-day-item">
                      <div className="tl-day-dot" />
                      <div className="tl-day-body">
                        <div className="tl-day-label">{item.label}</div>
                        <div className="tl-day-text">{item.text}</div>
                        <div className="tl-day-meta">
                          <span>{item.articleCount} 篇</span>
                          {item.sources?.slice(0, 3).join(' · ')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
