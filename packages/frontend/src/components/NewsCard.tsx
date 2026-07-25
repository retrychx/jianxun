import { memo, useState } from 'react'
import type { NewsItem } from '../api'

interface Props {
  item: NewsItem
  onClick?: (e: React.MouseEvent) => void
})

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#b91c1c', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#737373',
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  AI: 'linear-gradient(135deg, #b91c1c, #7f1d1d)',
  科技: 'linear-gradient(135deg, #1d4ed8, #1e3a8a)',
  财经: 'linear-gradient(135deg, #047857, #064e3b)',
  国际: 'linear-gradient(135deg, #b91c1c, #7f1d1d)',
  政治: 'linear-gradient(135deg, #9a3412, #7c2d12)',
  社会: 'linear-gradient(135deg, #9a3412, #7c2d12)',
  体育: 'linear-gradient(135deg, #166534, #14532d)',
  娱乐: 'linear-gradient(135deg, #a16207, #854d0e)',
  游戏: 'linear-gradient(135deg, #115e59, #134e4a)',
  健康: 'linear-gradient(135deg, #9d174d, #831843)',
  教育: 'linear-gradient(135deg, #3f6212, #365314)',
  其他: 'linear-gradient(135deg, #57534e, #44403c)',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ` ${time}`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) + ` ${time}`
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

const NewsCard = memo(function NewsCard({ item, onClick }: Props) {
  const [imgError, setImgError] = useState(false)

  return (
    <article className="news-card" onClick={onClick}>
      {item.image && !imgError && (
        <div className="card-image-wrap">
          <img
            className="card-image"
            src={item.image}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
          />
        </div>
      )}
      {!item.image && (
        <div className="card-image-wrap">
          <div className="card-img-placeholder" style={{ background: CATEGORY_GRADIENTS[item.category] || 'linear-gradient(135deg, #57534e, #44403c)' }}>
            <span className="card-placeholder-source">{item.source.slice(0, 2)}</span>
          </div>
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
          <span className="card-category" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>
            {item.category}
          </span>
          <span className="card-domain">{getDomain(item.url)}</span>
        </div>
      </div>
    </article>
  )
}
