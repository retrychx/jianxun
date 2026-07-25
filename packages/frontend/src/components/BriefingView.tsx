import { useState } from 'react'
import { Sparkles, ChevronRight, Newspaper, Hash } from 'lucide-react'
import type { BriefingItem, TopicCluster, NewsItem } from '../api'
import { useFollow } from '../hooks/useFollow'
import { TopicsView } from './TopicsView'
import { NewsCard } from './NewsCard'

interface Props {
  items: BriefingItem[]
  topics: TopicCluster[]
  news: NewsItem[]
  onNewsClick: (id: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#6b21a8', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#78716c',
}

export function BriefingView({ items, topics, news, onNewsClick }: Props) {
  const { follows } = useFollow()
  const followedEntities = follows.filter(f => f.type === 'entity')
  const [showTopics, setShowTopics] = useState(false)
  const [showFeed, setShowFeed] = useState(false)

  if (showTopics) {
    return (
      <div className="briefing-view">
        <button className="browse-back" onClick={() => setShowTopics(false)}>
          <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>返回简报</span>
        </button>
        <TopicsView topics={topics} onNewsClick={onNewsClick} />
      </div>
    )
  }

  if (showFeed) {
    return (
      <div className="briefing-view">
        <button className="browse-back" onClick={() => setShowFeed(false)}>
          <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>返回简报</span>
        </button>
        <div className="card-list">
          {news.map((item, i) => (
            <div key={item.id} className="card-enter" style={{ animationDelay: `${i * 40}ms` }}>
              <NewsCard item={item} onClick={() => onNewsClick(item.id)} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Sparkles size={18} className="briefing-icon" />
          <h2 className="briefing-title">今日简报</h2>
        </div>
        <p className="briefing-subtitle">{items.length} 篇精选</p>
      </div>

      {followedEntities.length > 0 && (
        <div className="bf-section">
          <div className="bf-section-title"><Hash size={13} /> 关注的实体</div>
          <div className="bf-follows">
            {followedEntities.slice(0, 8).map(f => <span key={f.id} className="bf-follow-tag">{f.name}</span>)}
          </div>
        </div>
      )}

      <div className="briefing-list">
        {items.map((item, i) => (
          <article key={item.id} className="briefing-card" onClick={() => onNewsClick(item.id)}>
            <div className="briefing-rank"><span className="briefing-num">{String(i + 1).padStart(2, '0')}</span></div>
            <div className="briefing-body">
              <div className="briefing-meta">
                <span className="briefing-source">{item.source}</span>
                <span className="briefing-cat" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>{item.category}</span>
              </div>
              <h3 className="briefing-title">{item.title}</h3>
              <div className="briefing-reason"><span className="briefing-reason-dot" />{item.reason}</div>
            </div>
          </article>
        ))}
      </div>

      {/* Browse More */}
      <div className="browse-more">
        <div className="browse-more-title">浏览更多</div>
        <button className="browse-card" onClick={() => setShowTopics(true)}>
          <div className="browse-card-icon"><Hash size={15} /></div>
          <div className="browse-card-body">
            <span className="browse-card-title">话题簇</span>
            <span className="browse-card-sub">{topics.length} 个热点话题</span>
          </div>
          <ChevronRight size={15} className="browse-card-arrow" />
        </button>
        <button className="browse-card" onClick={() => setShowFeed(true)}>
          <div className="browse-card-icon"><Newspaper size={15} /></div>
          <div className="browse-card-body">
            <span className="browse-card-title">全部新闻</span>
            <span className="browse-card-sub">{news.length} 篇报道 · 时间线</span>
          </div>
          <ChevronRight size={15} className="browse-card-arrow" />
        </button>
      </div>
    </div>
  )
}
