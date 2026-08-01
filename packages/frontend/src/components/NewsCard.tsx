import { memo, useState, useCallback } from 'react'
import { Bookmark } from 'lucide-react'
import type { NewsItem } from '../api'
import { categoryColor, sourceTrust } from '../constants'
import { displaySummary, displayTitle, formatDate, type Lang } from '../utils'
import { isBookmarked, addBookmark, removeBookmark } from '../hooks/useBookmark'

interface Props {
  item: NewsItem
  lang?: Lang
  onClick?: (id: number) => void
  followed?: boolean
  isNew?: boolean
  onHide?: (id: number) => void
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

export const NewsCard = memo(function NewsCard({ item, lang = 'zh', onClick, followed, isNew, onHide }: Props) {
  const [imgError, setImgError] = useState(false)
  const [saved, setSaved] = useState(() => isBookmarked(item.id))
  const showImage = !!item.image && !imgError
  const summary = displaySummary(item, lang)
  const toggleBookmark = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (saved) { removeBookmark(item.id); setSaved(false) }
    else { addBookmark({ id: item.id, title: item.title, source: item.source, url: item.url }); setSaved(true) }
  }, [saved, item.id, item.title, item.source, item.url])

  return (
    <article
      className={`news-card${showImage ? '' : ' no-image'}`}
      onClick={() => onClick?.(item.id)}
      role="link"
      tabIndex={0}
      aria-label={displayTitle(item, lang)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(item.id) }
      }}
    >
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
        {onHide && <button className="card-hide-btn" onClick={e => { e.stopPropagation(); onHide(item.id) }} title="不感兴趣">×</button>}
        <div className="card-header">
          <span className="card-source">{item.source}</span>
          <span className="card-time">{item.publishedAt ? formatDate(item.publishedAt) : ''}</span>
          {isNew && <span className="card-new">新</span>}
          {followed && <span className="card-followed">关注</span>}
        </div>
        <h3 className="card-title">{displayTitle(item, lang)}</h3>
        {summary && <p className="card-summary">{summary}</p>}
        {item.keyPoints && item.keyPoints.length > 0 && (
          <div className="card-keypoints">
            {item.keyPoints.slice(0, 2).map((kp, i) => (
              <span key={i} className="card-kp">· {kp}</span>
            ))}
          </div>
        )}
        <div className="card-footer">
          <span className="card-category" style={{ backgroundColor: categoryColor(item.category) }}>
            {item.category}
          </span>
          {item.impact && item.impact !== 'medium' && (
            <span className={`card-impact card-impact-${item.impact}`}>
              {item.impact === 'high' ? '重要' : '短讯'}
            </span>
          )}
          <span className="card-domain">{getDomain(item.url)}</span>
          {item.source && sourceTrust(item.source).label === '可靠' && (
            <span className="card-trust" title={`${item.source} 为高可信信源`}>可信</span>
          )}
          {item.heat != null && item.heat > 1 && (
            <span className="card-heat">{item.heat} 家媒体报道</span>
          )}
          <button className={`card-bookmark${saved ? ' saved' : ''}`} onClick={toggleBookmark} aria-label={saved ? '取消保存' : '保存'}>
            <Bookmark size={12} />
          </button>
        </div>
      </div>
    </article>
  )
});
