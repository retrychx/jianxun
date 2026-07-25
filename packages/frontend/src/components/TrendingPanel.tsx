import { memo } from 'react'
import { TrendingUp } from 'lucide-react'
import type { NewsItem } from '../api'

interface Props {
  items: NewsItem[]
}

const RANK_COLORS = ['#b91c1c', '#b45309', '#737373']

export const TrendingPanel = memo(function TrendingPanel({ items }: Props) {
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
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="trending-item"
          >
            <span className={`trending-rank ${i < 3 ? 'top3' : ''}`} style={i < 3 ? { color: RANK_COLORS[i] } : undefined}>
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
          </a>
        ))}
      </div>
    </div>
  )
})
