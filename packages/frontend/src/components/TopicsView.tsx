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

function getSentiment(count: number): { label: string; color: string; pct: number } {
  if (count >= 5) return { label: '热议', color: '#b91c1c', pct: 100 }
  if (count >= 3) return { label: '上升', color: '#d97706', pct: 60 }
  return { label: '发酵', color: '#737373', pct: 30 }
}

function TopicNarrative({ topic, onNewsClick }: { topic: TopicCluster; onNewsClick: (id: number) => void }) {
  const sources = topic.sources.slice(0, 5)
  const sentiment = getSentiment(topic.count)

  return (
    <div className="narrative-box">
      <div className="narrative-header">
        <span className="narrative-sources">
          {sources.map((s, i) => (
            <span key={s} className="narrative-source" style={{ backgroundColor: SOURCE_COLORS[s] || '#6b7280' }}>
              {s}
            </span>
          ))}
          {sources.length < topic.sources.length && (
            <span className="narrative-source-more">+{topic.sources.length - sources.length}</span>
          )}
        </span>
        <div className="narrative-heat">
          <div className="narrative-track">
            <div className="narrative-fill" style={{ width: `${sentiment.pct}%`, backgroundColor: sentiment.color }} />
          </div>
          <span className="narrative-status" style={{ color: sentiment.color }}>{sentiment.label}</span>
        </div>
      </div>
      <div className="narrative-timeline">
        {topic.items.slice(0, 4).map((item, idx) => (
          <div key={item.id} className="timeline-item" onClick={() => onNewsClick(item.id)}>
            <div className={`timeline-dot ${idx === 0 ? 'latest' : ''}`} />
            {idx < Math.min(topic.items.length, 4) - 1 && <div className="timeline-line" />}
            <div className="timeline-content">
              <div className="timeline-source">{item.source}</div>
              <div className="timeline-title">{item.title}</div>
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
        <span className="tph-sub">{topics.length} 个话题</span>
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
