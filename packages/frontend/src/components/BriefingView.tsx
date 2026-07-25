import { Sparkles, Newspaper, Hash } from 'lucide-react'
import type { BriefingItem } from '../api'
import type { FollowItem } from '../hooks/useFollow'
import { categoryColor } from '../constants'
import { formatTime, formatDate } from '../utils'

interface Props {
  items: BriefingItem[]
  updatedAt: Date | null
  follows: FollowItem[]
  onNewsClick: (id: number) => void
  onEntityClick: (name: string) => void
  onUnfollow: (name: string) => void
}

export function BriefingView({ items, updatedAt, follows, onNewsClick, onEntityClick, onUnfollow }: Props) {
  const followedEntities = follows.filter(f => f.type === 'entity')

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Sparkles size={18} className="briefing-icon" />
          <h2 className="briefing-title">今日简报</h2>
        </div>
        <p className="briefing-subtitle">
          {items.length} 篇精选{updatedAt ? ` · 更新于 ${formatTime(updatedAt)}` : ''}
        </p>
      </div>

      {followedEntities.length > 0 && (
        <div className="bf-section">
          <div className="bf-section-title"><Hash size={13} /> 关注的实体</div>
          <div className="bf-follows">
            {followedEntities.slice(0, 8).map(f => (
              <span key={f.id} className="bf-follow-tag">
                <button className="bf-follow-name" onClick={() => onEntityClick(f.name)} title={`查看 ${f.name} 的相关报道`}>{f.name}</button>
                <button className="bf-follow-x" onClick={() => onUnfollow(f.name)} aria-label={`取消关注 ${f.name}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>今日简报暂无内容</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>稍后再来看看</p>
        </div>
      ) : (
        <div className="briefing-list">
          {items.map((item, i) => (
            <article key={item.id} className="briefing-card" onClick={() => onNewsClick(item.id)}>
              <div className="briefing-rank"><span className="briefing-num">{String(i + 1).padStart(2, '0')}</span></div>
              <div className="briefing-body">
                <div className="briefing-meta">
                  <span className="briefing-source">{item.source}</span>
                  <span className="briefing-cat" style={{ backgroundColor: categoryColor(item.category) }}>{item.category}</span>
                  {item.publishedAt && <span className="briefing-time">{formatDate(item.publishedAt)}</span>}
                  {item.heat != null && item.heat > 1 && (
                    <span className="briefing-heat">{item.heat} 家媒体报道</span>
                  )}
                </div>
                <h3 className="bf-card-title">{item.title}</h3>
                <p className="briefing-summary">{item.summary ?? item.reason}</p>
                {item.summary && item.reason && item.reason !== item.summary && (
                  <div className="briefing-reason"><span className="briefing-reason-dot" />{item.reason}</div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
