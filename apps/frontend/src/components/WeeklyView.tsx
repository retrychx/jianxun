import { useEffect, useState } from 'react'
import { Hash, Newspaper, TrendingUp, GitBranch, Clock } from 'lucide-react'
import type { WeeklyResponse, NarrativeSummary } from '../api'
import { getWeekly, getNarratives } from '../api'
import { cleanNarrativeLabel as cleanLabel, decodeEntities } from '../utils'

// 近 7 天日期范围：'7月20日 – 7月26日'
function weekRange(): string {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 6)
  const fmt = (d: Date) => d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function WeeklySkeleton() {
  return (
    <div className="weekly-view">
      <div className="weekly-card">
        <div className="skeleton" style={{ height: 24, width: '40%', margin: '0 auto 10px' }} />
        <div className="skeleton skeleton-line tiny" style={{ margin: '0 auto 24px' }} />
        <div className="skeleton" style={{ height: 44, width: '30%', margin: '0 auto 24px' }} />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton skeleton-line" style={{ marginBottom: 12 }} />
        ))}
      </div>
    </div>
  )
}

// 周报卡片（#/weekly）：叙事驱动的周度回顾
export function WeeklyView() {
  const [data, setData] = useState<WeeklyResponse | null>(null)
  const [narratives, setNarratives] = useState<NarrativeSummary[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getWeekly(), getNarratives()])
      .then(([w, n]) => { if (!cancelled) { setData(w); setNarratives(n.narratives || []) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="empty">
        <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
        <p>周报加载失败，请稍后重试</p>
      </div>
    )
  }
  if (!data) return <WeeklySkeleton />
  if (!data.totalNew) {
    return (
      <div className="empty">
        <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
        <p>本周暂无数据</p>
        <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>积累几天报道后再来看看</p>
      </div>
    )
  }

  const maxEntity = Math.max(1, ...data.topEntities.map(e => e.count))

  return (
    <div className="weekly-view">
      <div className="weekly-card">
        <div className="weekly-header">
          <h2 className="weekly-title">AI 圈一周</h2>
          <p className="weekly-range">{weekRange()}</p>
        </div>

        <div className="weekly-total">
          <span className="weekly-total-num">{data.totalNew}</span>
          <span className="weekly-total-label">篇新报道</span>
        </div>

        {data.topEntities.length > 0 && (
          <div className="bf-section">
            <div className="bf-section-title"><Hash size={13} /> 热门实体</div>
            {data.topEntities.map((e, i) => (
              <a key={e.name} className="weekly-entity-row" href={`#/entity/${encodeURIComponent(e.name)}`}>
                <span className={`weekly-entity-rank${i < 3 ? ' top3' : ''}`}>{i + 1}</span>
                <span className="weekly-entity-name">{e.name}</span>
                <span className="weekly-bar">
                  <span className="weekly-bar-fill" style={{ width: `${Math.max(4, Math.round(e.count / maxEntity * 100))}%` }} />
                </span>
                <span className="weekly-entity-count">{e.count}</span>
              </a>
            ))}
          </div>
        )}

        {data.topTopics.length > 0 && (
          <div className="bf-section">
            <div className="bf-section-title"><TrendingUp size={13} /> 热门话题</div>
            {data.topTopics.map(t => (
              <div key={t.label} className="weekly-topic-row">
                <span className="weekly-topic-label">{t.label}</span>
                <span className="weekly-topic-count">{t.count} 篇</span>
              </div>
            ))}
          </div>
        )}

        {narratives.filter(n => n.status === 'active').length > 0 && (
          <div className="bf-section">
            <div className="bf-section-title"><GitBranch size={13} /> 本周追踪中的故事</div>
            {narratives.filter(n => n.status === 'active').slice(0, 5).map(n => (
              <a key={n.keyword} href={`#/narrative/${encodeURIComponent(n.keyword)}`} className="weekly-narr-row">
                <span className="weekly-narr-label">{cleanLabel(n.label || n.keyword)}</span>
                <span className="weekly-narr-meta">{n.articleCount} 篇 · {Object.keys(n.sourceStats).length} 个来源</span>
                {/* 叙事周报：最新一条进展（解码 HTML 实体） */}
                {(n as any).latest && (
                  <span className="weekly-narr-latest">📌 {decodeEntities((n as any).latest.slice(0, 60))}{(n as any).latest.length > 60 ? '…' : ''}</span>
                )}
              </a>
            ))}
          </div>
        )}

        {data.topSources && data.topSources.length > 0 && (
          <div className="bf-section">
            <div className="bf-section-title"><Newspaper size={13} /> 本周高产信源</div>
            <div className="weekly-sources">
              {data.topSources.slice(0, 6).map(s => (
                <span key={s.name} className="weekly-source-chip">{s.name}<small>{s.count}</small></span>
              ))}
            </div>
          </div>
        )}

        <div className="weekly-brand">简讯 · AI 新闻聚合</div>
      </div>
    </div>
  )
}
