import { memo } from 'react'
import { TrendingUp, ExternalLink } from 'lucide-react'
import type { NewsItem } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  items: NewsItem[]
  lang?: Lang
  onNewsClick: (id: number) => void
}

// 纯热文排行：回答"今天哪篇报道最热"
export const TrendingPanel = memo(function TrendingPanel({ items, lang = 'zh', onNewsClick }: Props) {
  if (!items.length) return null

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
