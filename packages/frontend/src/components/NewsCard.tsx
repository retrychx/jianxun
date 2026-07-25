import { memo, useState } from 'react'
import type { NewsItem } from '../api'
import { categoryColor } from '../constants'
import { formatDate } from '../utils'

interface Props {
  item: NewsItem
  onClick?: (id: number) => void
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

export const NewsCard = memo(function NewsCard({ item, onClick }: Props) {
  const [imgError, setImgError] = useState(false)
  const showImage = !!item.image && !imgError

  return (
    <article className={`news-card${showImage ? '' : ' no-image'}`} onClick={() => onClick?.(item.id)}>
      {showImage && (
        <div className="card-image-wrap">
          <img
            className="card-image"
            src={item.image!}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
          />
        </div>
      )}
      <div className="card-body">
        <div className="card-header">
          <span className="card-source">{item.source}</span>
          <span className="card-time">{item.publishedAt ? formatDate(item.publishedAt) : ''}</span>
        </div>
        <h3 className="card-title">{item.title}</h3>
        {item.summary && <p className="card-summary">{item.summary}</p>}
        <div className="card-footer">
          <span className="card-category" style={{ backgroundColor: categoryColor(item.category) }}>
            {item.category}
          </span>
          <span className="card-domain">{getDomain(item.url)}</span>
          {item.heat != null && item.heat > 1 && (
            <span className="card-heat">{item.heat} 家媒体报道</span>
          )}
        </div>
      </div>
    </article>
  )
});
