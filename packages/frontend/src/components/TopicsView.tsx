import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TopicCluster } from '../api'

interface Props {
  topics: TopicCluster[]
  onNewsClick: (id: number) => void
}

const SOURCE_COLORS: Record<string, string> = {
  '36氪': '#b91c1c', '少数派': '#2563eb', '爱范儿': '#059669',
  'TechCrunch': '#059669', 'Wired': '#dc2626', 'Engadget': '#7c3aed',
  'Ars Technica': '#d97706', 'The Verge': '#0891b2',
}

const ANGLE_COLORS: Record<string, string> = {
  '商业': '#b91c1c', '创投': '#b91c1c', '消费': '#1d4ed8',
  '趋势': '#d97706', '产业': '#059669', '技术': '#0891b2',
  'AI': '#7c3aed', '科学': '#0d9488', '工程': '#ea580c',
  '开源': '#16a34a', '社区': '#6366f1', '效率': '#b45309',
  '综合': '#78716c', '深度': '#1a1a1a', '文化': '#be185d',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TopicNarrative({ topic, onNewsClick }: { topic: TopicCluster; onNewsClick: (id: number) => void }) {
  const perspectives = topic.sourcePerspectives || []
  const pct = Math.min(topic.count / 8 * 100, 100)
  const heatLabel = topic.count >= 5 ? '热议' : topic.count >= 3 ? '上升' : '发酵'
  const heatColor = topic.count >= 5 ? '#b91c1c' : topic.count >= 3 ? '#d97706' : '#737373'

  return (
    <div className="narrative-box">
      {/* Date range */}
      {topic.dateRange && (
        <div className="narr-date">{topic.dateRange}</div>
      )}

      {/* Source perspectives */}
      {perspectives.length > 0 && (
        <div className="narr-perspectives">
          {perspectives.slice(0, 6).map(p => (
            <span key={p.name} className="narr-persp" style={{ borderColor: ANGLE_COLORS[p.angle] || '#e5e5e5' }}>
              <span className="narr-persp-dot" style={{ backgroundColor: ANGLE_COLORS[p.angle] || '#a3a3a3' }} />
              {p.name}
              <span className="narr-persp-angle">{p.angle}</span>
            </span>
          ))}
        </div>
      )}

      {/* Heat indicator */}
      <div className="narr-heat">
        <div className="narr-heat-track">
          <div className="narr-heat-fill" style={{ width: `${pct}%`, backgroundColor: heatColor }} />
        </div>
        <span className="narr-heat-label" style={{ color: heatColor }}>{heatLabel}</span>
      </div>

      {/* Timeline */}
      <div className="narr-timeline">
        {topic.items.map((item, idx) => (
          <div key={item.id} className="tl-item" onClick={() => onNewsClick(item.id)}>
            <div className={`tl-dot ${idx === 0 ? 'active' : ''}`} />
            <div className="tl-line" />
            <div className="tl-body">
              <div className="tl-meta">
                <span className="tl-source">{item.source}</span>
                {item.publishedAt && <span className="tl-time">{formatDate(item.publishedAt)}</span>}
              </div>
              <div className="tl-title">{item.title}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TopicsView({ topics, onNewsClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!topics.length) return null

  return (
    <div className="topics-view">
      <div className="tph">
        <h2 className="tph-title">今日叙事</h2>
        <span className="tph-sub">{topics.length} 个话题 · {topics.reduce((s, t) => s + t.count, 0)} 篇报道</span>
      </div>
      <div className="topics-stream">
        {topics.map((topic, i) => {
          const isOpen = expanded.has(topic.keyword)
          return (
            <div key={topic.keyword} className={`ts-card ${isOpen ? 'open' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
              <button className="ts-trigger" onClick={() => {
                setExpanded(prev => {
                  const next = new Set(prev)
                  if (next.has(topic.keyword)) next.delete(topic.keyword)
                  else next.add(topic.keyword)
                  return next
                })
              }}>
                <div className="ts-trigger-left">
                  <div className="ts-meter">
                    <div className="ts-meter-fill" style={{ height: Math.min(topic.count * 5, 36) }} />
                  </div>
                  <div className="ts-info">
                    <div className="ts-keyword">{topic.keyword}</div>
                    <div className="ts-sources">
                      {topic.sources.slice(0, 3).join(' · ')}
                      {topic.sources.length > 3 && ` · +${topic.sources.length - 3}`}
                      {topic.dateRange && <span className="ts-date"> · {topic.dateRange}</span>}
                    </div>
                  </div>
                </div>
                <div className="ts-trigger-right">
                  <span className="ts-count">{topic.count}</span>
                  <ChevronRight size={15} className={`ts-chevron ${isOpen ? 'open' : ''}`} />
                </div>
              </button>
              <div className="ts-body-wrap">
                <div className="ts-body">
                  <TopicNarrative topic={topic} onNewsClick={onNewsClick} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
