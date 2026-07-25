import { useEffect, useState } from 'react'
import { ChevronRight, Hash } from 'lucide-react'
import type { NewsItem } from '../api'
import { getByEntity } from '../api'
import { NewsCard } from './NewsCard'

interface Props {
  entity: string
  onBack: () => void
  onNewsClick: (id: number) => void
}

export function EntityView({ entity, onBack, onNewsClick }: Props) {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getByEntity(entity)
      .then(res => { if (!cancelled) setItems(res.items) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entity])

  return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}>
        <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
        <span>返回</span>
      </button>
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Hash size={18} className="briefing-icon" />
          <h2 className="briefing-title">{entity}</h2>
        </div>
        {!loading && !error && <p className="briefing-subtitle">{items.length} 篇相关报道</p>}
      </div>
      {loading ? (
        <div className="loading">加载中...</div>
      ) : error ? (
        <div className="empty">
          <p>加载失败，请稍后重试</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <Hash size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无相关报道</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((item, i) => (
            <div key={item.id} className="card-enter" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
              <NewsCard item={item} onClick={onNewsClick} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
