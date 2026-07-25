import { Sparkles, Bell } from 'lucide-react'
import type { BriefingItem } from '../api'
import { useFollow } from '../hooks/useFollow'

interface Props {
  items: BriefingItem[]
  onNewsClick: (id: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#6b21a8', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#78716c',
}

export function BriefingView({ items, onNewsClick }: Props) {
  const { follows, toggleFollow } = useFollow()
  const followedEntities = follows.filter(f => f.type === 'entity')
  const followedCats = follows.filter(f => f.type === 'category')

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Sparkles size={18} className="briefing-icon" />
          <h2 className="briefing-title">今日简报</h2>
        </div>
        <p className="briefing-subtitle">
          今日 {items.length} 篇精选 · {followedEntities.length} 个关注中
        </p>
      </div>

      {/* My Follows */}
      {followedEntities.length > 0 && (
        <div className="bf-section">
          <div className="bf-section-title">
            <Bell size={13} />
            关注的实体
          </div>
          <div className="bf-follows">
            {followedEntities.map(f => (
              <span key={f.id} className="bf-follow-tag">
                {f.name}
                <button className="bf-follow-x" onClick={() => toggleFollow(f.name, 'entity')}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Briefing List */}
      <div className="briefing-list">
        {items.map((item, i) => {
          const isFollowed = followedEntities.some(f => item.title.includes(f.name))
          return (
            <article key={item.id} className={`briefing-card ${isFollowed ? 'matched' : ''}`} onClick={() => onNewsClick(item.id)}>
              <div className="briefing-rank">
                <span className="briefing-num">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="briefing-body">
                <div className="briefing-meta">
                  <span className="briefing-source">{item.source}</span>
                  <span className="briefing-cat" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>
                    {item.category}
                  </span>
                  {isFollowed && <span className="bf-match-badge">关注</span>}
                </div>
                <h3 className="briefing-title">{item.title}</h3>
                <div className="briefing-reason">
                  <span className="briefing-reason-dot" />
                  {item.reason}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
