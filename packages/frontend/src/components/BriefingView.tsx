import { useState, useEffect, useMemo } from 'react'
import { Newspaper, Hash, GitBranch, TrendingUp } from 'lucide-react'
import type { BriefingItem } from '../api'
import type { FollowItem } from '../hooks/useFollow'
import { categoryColor } from '../constants'
import { boostFollowed, displaySummary, displayTitle, formatTime, formatDate, matchesFollow, type Lang } from '../utils'
import { FollowWeekly } from './FollowWeekly'
import { getActiveInterests, matchesInterest } from '../hooks/useInterest'

interface Props {
  items: BriefingItem[]
  updatedAt: Date | null
  follows: FollowItem[]
  lang: Lang
  onNewsClick: (id: number) => void
  onEntityClick: (name: string) => void
  onUnfollow: (name: string) => void
  onNarrativeClick?: (keyword: string) => void
}

export function BriefingView({ items, updatedAt, follows, lang, onNewsClick, onEntityClick, onUnfollow, onNarrativeClick }: Props) {
  const [narrUpdates, setNarrUpdates] = useState<any[]>([])
  const interests = useMemo(() => getActiveInterests(), [])

  useEffect(() => {
    fetch('/api/news/briefing/updates').then(r => r.json()).then(d => {
      if (d.updatedNarratives) setNarrUpdates(d.updatedNarratives.slice(0, 4))
    }).catch(() => {})
  }, [])

  const followedEntities = follows.filter(f => f.type === 'entity')
  const followedNames = followedEntities.map(f => f.name)
  // 关注 + 兴趣加权：命中关注或兴趣实体的条目稳定置顶
  const boosted = boostFollowed(items, [...followedNames, ...interests])
  // 兴趣标记
  const interestSet = new Set(interests.map(i => i.toLowerCase()))

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <h2 className="briefing-title">今日简报</h2>
          <span className="briefing-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
        </div>
        <p className="briefing-subtitle">
          AI 从 {items.length} 篇报道中精选今日要闻
        </p>
      </div>

      {/* 叙事动态 */}
      {narrUpdates.length > 0 && (
        <div className="bf-section">
          <div className="bf-section-title"><GitBranch size={13} /> 今日故事动态</div>
          <div className="bf-narr-updates">
            {narrUpdates.map(n => (
              <button key={n.keyword} className="bf-narr-update" onClick={() => onNarrativeClick?.(n.keyword)}>
                <span className="bf-narr-update-label">{n.label}</span>
                <span className="bf-narr-update-meta">{n.sourceCount} 个信源 · {n.articleCount} 篇</span>
              </button>
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
          {boosted.map((item, i) => {
            const summary = displaySummary(item, lang)
            const isFirst = i === 0
            if (isFirst) {
              return (
              <article key={item.id} className="briefing-hero" onClick={() => onNewsClick(item.id)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNewsClick(item.id) } }}>
                <div className="briefing-hero-badge">今日精选</div>
                <div className="briefing-hero-meta">
                  <span className="briefing-source">{item.source}</span>
                  <span className="briefing-cat" style={{ backgroundColor: categoryColor(item.category) }}>{item.category}</span>
                  {item.heat != null && item.heat > 1 && <span className="briefing-heat">{item.heat} 家媒体报道</span>}
                </div>
                <h3 className="briefing-hero-title">{displayTitle(item, lang)}</h3>
                {summary && <p className="briefing-hero-summary">{summary}</p>}
                {item.keyPoints && item.keyPoints.length > 0 && (
                  <div className="card-keypoints" style={{ marginTop: 4 }}>
                    {item.keyPoints.slice(0, 2).map((kp, i) => <span key={i} className="card-kp">· {kp}</span>)}
                  </div>
                )}
                {summary && item.reason && item.reason !== summary && (
                  <div className="briefing-reason" style={{ marginTop: 6 }}><span className="briefing-reason-dot" />{item.reason}</div>
                )}
              </article>
              )
            }
            return (
            <article key={item.id} className="briefing-card" onClick={() => onNewsClick(item.id)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNewsClick(item.id) } }}>
              <div className="briefing-rank"><span className="briefing-num">{String(i + 1).padStart(2, '0')}</span></div>
              <div className="briefing-body">
                <div className="briefing-meta">
                  <span className="briefing-source">{item.source}</span>
                  <span className="briefing-cat" style={{ backgroundColor: categoryColor(item.category) }}>{item.category}</span>
                  {item.publishedAt && <span className="briefing-time">{formatDate(item.publishedAt)}</span>}
                  {item.heat != null && item.heat > 1 && (<span className="briefing-heat">{item.heat} 家媒体报道</span>)}
                  {matchesFollow(item, followedNames) && <span className="briefing-followed">关注</span>}
                </div>
                <h3 className="bf-card-title">{displayTitle(item, lang)}</h3>
                <p className="briefing-summary">{summary ?? item.reason}</p>
                {item.keyPoints && item.keyPoints.length > 0 && (
                  <div className="card-keypoints" style={{ marginTop: 2 }}>
                    {item.keyPoints.slice(0, 1).map((kp, i) => <span key={i} className="card-kp">· {kp}</span>)}
                  </div>
                )}
                {summary && item.reason && item.reason !== summary && (
                  <div className="briefing-reason"><span className="briefing-reason-dot" />{item.reason}</div>
                )}
              </div>
            </article>
            )
          })}
        </div>
      )}

      {/* 关注的实体 */}
      {followedEntities.length > 0 && (
        <div className="bf-section" style={{ marginTop: 16 }}>
          <div className="bf-section-title"><Hash size={13} /> 关注的实体</div>
          <div className="bf-follows">
            {followedEntities.slice(0, 12).map(f => (
              <span key={f.id} className="bf-follow-tag">
                <button className="bf-follow-name" onClick={() => onEntityClick(f.name)} title={`查看 ${f.name} 的相关报道`}>{f.name}</button>
                <button className="bf-follow-x" onClick={() => onUnfollow(f.name)} aria-label={`取消关注 ${f.name}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <FollowWeekly follows={follows} onEntityClick={onEntityClick} />
    </div>
  )
}
