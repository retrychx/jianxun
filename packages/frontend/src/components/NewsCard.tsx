import { memo, useState } from 'react'
import type { NewsItem } from '../api'
import { categoryColor } from '../constants'
import { displaySummary, displayTitle, formatDate, type Lang } from '../utils'

interface Props {
  item: NewsItem
  lang?: Lang
  onClick?: (id: number) => void
  /** 命中关注实体时显示「关注」小标记 */
  followed?: boolean
  /** 上次访问后新增的文章显示「新」标记 */
  isNew?: boolean
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

export const NewsCard = memo(function NewsCard({ item, lang = 'zh', onClick, followed, isNew }: Props) {
  const [imgError, setImgError] = useState(false)
  const showImage = !!item.image && !imgError
  const summary = displaySummary(item, lang)

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
          {isNew && <span className="card-new">新</span>}
          {followed && <span className="card-followed">关注</span>}
        </div>
        <h3 className="card-title">{displayTitle(item, lang)}</h3>
        {summary && <p className="card-summary">{summary}</p>}
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
