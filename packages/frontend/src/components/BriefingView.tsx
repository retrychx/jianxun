import { Sparkles, Hash, Newspaper } from 'lucide-react'
import type { BriefingItem, TopicCluster } from '../api'
import { useFollow } from '../hooks/useFollow'

interface Props {
  items: BriefingItem[]
  topics: TopicCluster[]
  onNewsClick: (id: number) => void
  onViewTopics: () => void
  onViewFeed: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#6b21a8', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#78716c',
}

export function BriefingView({ items, topics, onNewsClick, onViewTopics, onViewFeed }: Props) {
  const { follows } = useFollow()
  const followedEntities = follows.filter(f => f.type === 'entity')
  const hotTopics = topics.slice(0, 4)

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Sparkles size={18} className="briefing-icon" />
          <h2 className="briefing-title">今日简报</h2>
        </div>
        <p className="briefing-subtitle">
          {items.length} 篇精选 · {followedEntities.length} 个关注中
        </p>
      </div>

      {/* My Follows */}
      {followedEntities.length > 0 && (
        <div className="bf-section">
          <div className="bf-section-title">
            <Hash size={13} />
            关注的实体
          </div>
          <div className="bf-follows">
            {followedEntities.slice(0, 8).map(f => (
              <span key={f.id} className="bf-follow-tag">{f.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Briefing List */}
      <div className="briefing-list">
        {items.map((item, i) => (
          <article key={item.id} className="briefing-card" onClick={() => onNewsClick(item.id)}>
            <div className="briefing-rank">
              <span className="briefing-num">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="briefing-body">
              <div className="briefing-meta">
                <span className="briefing-source">{item.source}</span>
                <span className="briefing-cat" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>
                  {item.category}
                </span>
              </div>
              <h3 className="briefing-title">{item.title}</h3>
              <div className="briefing-reason">
                <span className="briefing-reason-dot" />
                {item.reason}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Explore More */}
      <div className="bf-explore">
        <div className="bf-explore-title">探索更多</div>
        <div className="bf-explore-grid">
          {hotTopics.map(t => (
            <button key={t.keyword} className="bf-explore-card" onClick={onViewTopics}>
              <span className="bf-explore-num">{t.count}</span>
              <div className="bf-explore-info">
                <span className="bf-explore-keyword">{t.keyword}</span>
                <span className="bf-explore-sources">{t.sources.length} 个来源</span>
              </div>
            </button>
          ))}
          <button className="bf-explore-card feed" onClick={onViewFeed}>
            <Newspaper size={16} />
            <div className="bf-explore-info">
              <span className="bf-explore-keyword">全部新闻</span>
              <span className="bf-explore-sources">时间线视图</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
