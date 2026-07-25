import { memo } from 'react'
import { TrendingUp, ExternalLink } from 'lucide-react'
import type { NewsItem } from '../api'

interface Props {
  items: NewsItem[]
  onNewsClick: (id: number) => void
}

export const TrendingPanel = memo(function TrendingPanel({ items, onNewsClick }: Props) {
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
          <div
            key={item.id}
            className="trending-item"
            onClick={() => onNewsClick(item.id)}
          >
            <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>
              {i + 1}
            </span>
            <div className="trending-content">
              <span className="trending-title">{item.title}</span>
              <span className="trending-meta">
                <span>{item.source}</span>
                <span className="trending-meta-dot">·</span>
                <span>{item.category}</span>
              </span>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="trending-ext"
              aria-label="打开原文"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink size={12} />
            </a>
          </div>
        ))}
      </div>
    </div>
  )
})

// 移动端横向热门条（sidebar 在小屏隐藏时的入口）
export function TrendingStrip({ items, onNewsClick }: Props) {
  if (!items.length) return null

  return (
    <div className="trending-strip">
      <span className="trending-strip-label"><TrendingUp size={12} /> 热门</span>
      {items.slice(0, 10).map((item, i) => (
        <button key={item.id} className="trending-chip" onClick={() => onNewsClick(item.id)}>
          <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
          <span className="trending-chip-title">{item.title}</span>
        </button>
      ))}
    </div>
  )
}
