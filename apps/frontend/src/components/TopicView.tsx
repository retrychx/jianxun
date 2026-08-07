import { useEffect, useState } from 'react'
import { ChevronRight, Hash } from 'lucide-react'
import type { TopicDetail } from '../api'
import { getTopic } from '../api'
import { displayTitle, formatDate, type Lang } from '../utils'

interface Props {
  name: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
}

type SentKey = 'positive' | 'neutral' | 'negative'

/** perspectives 的 label 归一到正/中/负（兼容中英文写法，null/未知按中性） */
function sentKey(label: string | null | undefined): SentKey {
  const l = (label || '').toLowerCase()
  if (l.includes('pos') || l.includes('正')) return 'positive'
  if (l.includes('neg') || l.includes('负')) return 'negative'
  return 'neutral'
}

export function TopicView({ name, lang, onBack, onNewsClick }: Props) {
  const [data, setData] = useState<TopicDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setData(null)
    getTopic(name)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [name, reloadKey])

  const timeline = data && Array.isArray(data.timeline) ? data.timeline : []

  // 各方立场：按信源聚合成 正/中/负 比例条
  // （后端每源一行时是主导立场的单段条；每(源,立场)一行时是多段比例条，两种形态兼容）
  const bySource = new Map<string, Record<SentKey, number>>()
  if (data && Array.isArray(data.perspectives)) {
    for (const p of data.perspectives) {
      const row = bySource.get(p.source) ?? { positive: 0, neutral: 0, negative: 0 }
      row[sentKey(p.label)] += p.count || 0
      bySource.set(p.source, row)
    }
  }

  return (
    <div className="topic-view">
      <button className="browse-back" onClick={onBack}>
        <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
        <span>返回</span>
      </button>
      {loading ? (
        <div style={{ marginTop: 16 }}>
          <div className="skeleton" style={{ height: 20, width: '50%', marginBottom: 16, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 80, marginBottom: 12, borderRadius: 'var(--radius)' }} />
          <div className="skeleton" style={{ height: 14, width: '30%', marginBottom: 10, borderRadius: 4 }} />
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8, borderRadius: 'var(--radius-sm)' }} />)}
        </div>
      ) : error || !data ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <Hash size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>话题加载失败</p>
          <button className="search-clear" onClick={() => setReloadKey(k => k + 1)} style={{ marginTop: 8, fontSize: 13, color: 'var(--accent)' }}>重试</button>
        </div>
      ) : (
        <>
          <div className="briefing-header">
            <div className="briefing-title-row">
              <Hash size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <h2 className="briefing-title">{data.label || data.keyword || name}</h2>
            </div>
            <p className="briefing-subtitle">
              {timeline.length} 篇报道{bySource.size > 0 ? ` · ${bySource.size} 家媒体` : ''}
            </p>
          </div>

          {data.storyline && (
            <div className="topic-storyline">
              <div className="narr-section-label">前情提要</div>
              <p className="topic-storyline-text">{data.storyline}</p>
            </div>
          )}

          {bySource.size > 0 && (
            <div className="topic-section">
              <div className="narr-section-label">各方立场</div>
              <div className="topic-persp-list">
                {[...bySource].map(([source, c]) => {
                  const total = c.positive + c.neutral + c.negative
                  if (!total) return null
                  return (
                    <div key={source} className="topic-persp-row">
                      <span className="topic-persp-source">{source}</span>
                      <div className="sheet-sentiment-track">
                        <div className="sheet-sentiment-fill s-positive" style={{ width: `${(c.positive / total) * 100}%` }} />
                        <div className="sheet-sentiment-fill s-neutral" style={{ width: `${(c.neutral / total) * 100}%` }} />
                        <div className="sheet-sentiment-fill s-negative" style={{ width: `${(c.negative / total) * 100}%` }} />
                      </div>
                      <span className="topic-persp-count">{total}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="topic-section">
            <div className="narr-section-label">时间线</div>
            {timeline.length === 0 ? (
              <div className="empty">
                <p>暂无相关报道</p>
              </div>
            ) : (
              <div className="narr-timeline-v">
                {timeline.map((item, idx) => (
                  <div key={item.id} className="tl-v-item" onClick={() => onNewsClick(item.id)}>
                    <div className={`tl-v-dot ${idx === 0 ? 'active' : ''}`} />
                    {idx < timeline.length - 1 && <div className="tl-v-line" />}
                    <div className="tl-v-body">
                      <div className="tl-v-meta">
                        <span className="tl-v-source">{item.source}</span>
                        {item.publishedAt && <span className="tl-v-time">{formatDate(item.publishedAt)}</span>}
                      </div>
                      <div className="tl-v-title">{displayTitle(item, lang)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
