import { useState } from 'react'
import { ChevronRight, Hash } from 'lucide-react'
import type { TopicCluster } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  topics: TopicCluster[]
  lang: Lang
  onNewsClick: (id: number) => void
}

const ANGLE_COLORS: Record<string, string> = {
  '商业': '#b91c1c', '创投': '#b91c1c', '消费': '#1d4ed8',
  '趋势': '#d97706', '产业': '#059669', '技术': '#0891b2',
  'AI': '#7c3aed', '科学': '#0d9488', '工程': '#ea580c',
  '开源': '#16a34a', '社区': '#6366f1', '效率': '#b45309',
  '综合': '#78716c', '深度': '#1a1a1a', '文化': '#be185d',
}

function formatDate(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatTime(d: string): string {
  const date = new Date(d)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function TopicNarrative({ topic, lang, onNewsClick }: { topic: TopicCluster; lang: Lang; onNewsClick: (id: number) => void }) {
  const perspectives = topic.sourcePerspectives || []

  return (
    <div className="narrative-box">
      {/* AI Narrative Summary */}
      {topic.narrative && (
        <div className="narr-summary">
          <p className="narr-summary-text">{topic.narrative}</p>
        </div>
      )}

      {/* Horizontal Timeline */}
      <div className="narr-timeline-h">
        {topic.items.map((item, idx) => (
          <div key={item.id} className={`tl-h-item ${idx === 0 ? 'active' : ''}`} onClick={() => onNewsClick(item.id)}>
            <div className="tl-h-line" />
            <div className="tl-h-dot-wrap">
              <div className="tl-h-dot" style={{ borderColor: idx === 0 ? 'var(--accent)' : 'var(--border)' }} />
            </div>
            <div className="tl-h-content">
              <span className="tl-h-source">{item.source}</span>
              {item.publishedAt && <span className="tl-h-time">{formatDate(item.publishedAt)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Source perspectives */}
      {perspectives.length > 0 && (
        <div className="narr-section">
          <div className="narr-section-label">来源视角</div>
          <div className="narr-persp-grid">
            {perspectives.map(p => (
              <span key={p.name} className="narr-persp-tag">
                <span className="narr-persp-dot" style={{ backgroundColor: ANGLE_COLORS[p.angle] || '#a3a3a3' }} />
                <span className="narr-persp-name">{p.name}</span>
                <span className="narr-persp-angle">{p.angle}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Vertical detail timeline */}
      <div className="narr-section">
        <div className="narr-section-label">报道时间线</div>
        <div className="narr-timeline-v">
          {topic.items.map((item, idx) => (
            <div key={item.id} className="tl-v-item" onClick={() => onNewsClick(item.id)}>
              <div className={`tl-v-dot ${idx === 0 ? 'active' : ''}`} />
              {idx < topic.items.length - 1 && <div className="tl-v-line" />}
              <div className="tl-v-body">
                <div className="tl-v-meta">
                  <span className="tl-v-source">{item.source}</span>
                  {item.publishedAt && <span className="tl-v-time">{formatTime(item.publishedAt)}</span>}
                </div>
                <div className="tl-v-title">{displayTitle(item, lang)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TopicsView({ topics, lang, onNewsClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!topics.length) {
    return (
      <div className="topics-view">
        <div className="empty" style={{ marginTop: 40 }}>
          <Hash size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>暂无话题</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>有足够多的同源报道时会自动生成话题簇，先看看新闻吧</p>
        </div>
      </div>
    )
  }

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
                    <div className="ts-keyword">{topic.label ?? topic.keyword}</div>
                    <div className="ts-sources">
                      {topic.sources.slice(0, 3).join(' · ')}
                      {topic.sources.length > 3 && ` · +${topic.sources.length - 3}`}
                      {topic.dateRange && <span> · {topic.dateRange}</span>}
                    </div>
                    {topic.entities && topic.entities.length > 0 && (
                      <div className="ts-entities">
                        {topic.entities.slice(0, 4).map(e => <span key={e} className="ts-entity-tag">{e}</span>)}
                        {topic.entities.length > 4 && <span className="ts-entity-more">+{topic.entities.length - 4}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="ts-trigger-right">
                  <span className="ts-count">{topic.count}</span>
                  <ChevronRight size={15} className={`ts-chevron ${isOpen ? 'open' : ''}`} />
                </div>
              </button>
              <div className="ts-body-wrap">
                <div className="ts-body">
                  <a className="ts-deep-link" href={`#/topic/${encodeURIComponent(topic.keyword)}`}>
                    话题深挖 <ChevronRight size={12} />
                  </a>
                  <TopicNarrative topic={topic} lang={lang} onNewsClick={onNewsClick} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
