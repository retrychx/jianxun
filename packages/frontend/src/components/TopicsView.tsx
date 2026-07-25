import { useState } from 'react'
import type { TopicCluster, NewsItem } from '../api'

interface Props {
  topics: TopicCluster[]
  onNewsClick: (id: number) => void
}

export function TopicsView({ topics, onNewsClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (kw: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(kw)) next.delete(kw)
      else next.add(kw)
      return next
    })
  }

  if (!topics.length) return null

  return (
    <div className="topics-view">
      <div className="topics-header">
        <h2 className="topics-title">今日话题</h2>
        <span className="topics-subtitle">{topics.length} 个热点簇</span>
      </div>
      <div className="topics-list">
        {topics.map((topic, i) => {
          const isOpen = expanded.has(topic.keyword)
          return (
            <div
              key={topic.keyword}
              className={`topic-card ${isOpen ? 'is-open' : ''}`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <button className="topic-trigger" onClick={() => toggle(topic.keyword)}>
                <div className="topic-left">
                  <span className="topic-badge">{topic.count}</span>
                  <div className="topic-info">
                    <span className="topic-keyword">{topic.keyword}</span>
                    <span className="topic-sources">
                      {topic.sources.slice(0, 4).join(' · ')}
                      {topic.sources.length > 4 && ` · +${topic.sources.length - 4}`}
                    </span>
                  </div>
                </div>
                <span className={`topic-chevron ${isOpen ? 'rotated' : ''}`} />
              </button>
              <div className="topic-items-wrapper">
                <div className="topic-items">
                  {topic.items.map(item => (
                    <div
                      key={item.id}
                      className="topic-item"
                      onClick={() => onNewsClick(item.id)}
                    >
                      <span className="topic-item-source">{item.source}</span>
                      <span className="topic-item-title">{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
