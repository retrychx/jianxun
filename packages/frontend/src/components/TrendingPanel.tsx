import { memo, useEffect, useState } from 'react'
import { TrendingUp, ExternalLink, GitBranch, Flame, Activity } from 'lucide-react'
import type { NewsItem } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  items: NewsItem[]
  lang?: Lang
  onNewsClick: (id: number) => void
  /** 是否独立页面模式（显示额外叙事板块） */
  standalone?: boolean
  onNarrativeClick?: (keyword: string) => void
}

export const TrendingPanel = memo(function TrendingPanel({ items, lang = 'zh', onNewsClick, standalone, onNarrativeClick }: Props) {
  const [hotNarrs, setHotNarrs] = useState<any[]>([])
  const [signals, setSignals] = useState<any>(null)

  useEffect(() => {
    if (!standalone) return
    fetch('/api/news/narrative/heat').then(r => r.json()).then(d => {
      if (d.hottest) setHotNarrs(d.hottest.slice(0, 6))
    }).catch(() => {})
    fetch('/api/news/signals').then(r => r.json()).then(d => setSignals(d)).catch(() => {})
  }, [standalone])

  if (!items.length && !hotNarrs.length) return null

  return (
    <div className="trending-panel">
      <div className="panel-header">
        <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
        <span className="panel-title">热门排行</span>
        <span className="panel-subtitle">Top {Math.min(items.length, 10)}</span>
      </div>
      <div className="trending-list">
        {items.slice(0, 10).map((item, i) => (
          <div key={item.id} className="trending-item" onClick={() => onNewsClick(item.id)}>
            <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
            <div className="trending-content">
              <span className="trending-title">{displayTitle(item, lang)}</span>
              <span className="trending-meta">
                <span>{item.source}</span>
                <span className="trending-meta-dot">·</span>
                <span>{item.category}</span>
                {item.heat != null && item.heat > 1 && (
                  <><span className="trending-meta-dot">·</span><span>{item.heat} 家媒体</span></>
                )}
              </span>
            </div>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="trending-ext" aria-label="打开原文" onClick={e => e.stopPropagation()}>
              <ExternalLink size={12} />
            </a>
          </div>
        ))}
      </div>

      {/* 早期信号（仅独立页面） */}
      {standalone && signals?.risingNarratives?.length > 0 && (
        <>
          <div className="panel-header" style={{ borderTop: '1px solid var(--border-light)', marginTop: 0 }}>
            <Activity size={15} style={{ color: 'var(--accent)' }} />
            <span className="panel-title">早期信号</span>
            <span className="panel-subtitle">24h 内升温</span>
          </div>
          <div className="trending-list">
            {signals.risingNarratives.slice(0, 5).map((n: any) => (
              <div key={n.keyword} className="signal-card rising" onClick={() => onNarrativeClick?.(n.keyword)} style={{ cursor: onNarrativeClick ? 'pointer' : 'default' }}>
                <div className="signal-head">
                  <span className="signal-arrow up">▲</span>
                  <span className="signal-label">{n.label}</span>
                </div>
                <div className="signal-meta">
                  <span>热度 {n.heat}</span>
                  <span>{n.sourceCount} 个信源</span>
                  <span>{n.articleCount} 篇</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 热门故事（仅独立页面） */}
      {standalone && hotNarrs.length > 0 && (
        <>
          <div className="panel-header" style={{ borderTop: '1px solid var(--border-light)', marginTop: 0 }}>
            <Flame size={15} style={{ color: 'var(--accent)' }} />
            <span className="panel-title">热门故事</span>
            <span className="panel-subtitle">新进展 · 多信源</span>
          </div>
          <div className="trending-list">
            {hotNarrs.map((n, i) => (
              <div key={n.keyword} className="trending-item" onClick={() => onNarrativeClick?.(n.keyword)} style={{ cursor: onNarrativeClick ? 'pointer' : 'default' }}>
                <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
                <div className="trending-content">
                  <span className="trending-title">{n.label}</span>
                  <span className="trending-meta">
                    <span>{n.sourceCount} 个信源</span>
                    <span className="trending-meta-dot">·</span>
                    <span>{n.articleCount} 篇</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
})

export function TrendingStrip({ items, lang = 'zh', onNewsClick }: Props) {
  if (!items.length) return null
  return (
    <div className="trending-strip">
      <span className="trending-strip-label"><TrendingUp size={12} /> 热门</span>
      {items.slice(0, 10).map((item, i) => (
        <button key={item.id} className="trending-chip" onClick={() => onNewsClick(item.id)}>
          <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
          <span className="trending-chip-title">{displayTitle(item, lang)}</span>
        </button>
      ))}
    </div>
  )
}
