import { Sparkles } from 'lucide-react'
import type { BriefingItem } from '../api'

interface Props {
  items: BriefingItem[]
  onNewsClick: (id: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#6b21a8', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#78716c',
}

export function BriefingView({ items, onNewsClick }: Props) {
  if (!items.length) return null

  return (
    <div className="briefing-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Sparkles size={18} className="briefing-icon" />
          <h2 className="briefing-title">今日简报</h2>
        </div>
        <p className="briefing-subtitle">
          今日 {items.length} 篇精选 · 从 {new Set(items.map(i => i.source)).size} 个来源中推荐
        </p>
      </div>
      <div className="briefing-list">
        {items.map((item, i) => (
          <article key={item.id} className="briefing-card" onClick={() => onNewsClick(item.id)}>
            <div className="briefing-rank">
              <span className="briefing-num">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="briefing-body">
              <div className="briefing-meta">
                <span className="briefing-source">{item.source}</span>
                <span className="briefing-cat" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>
                  {item.category}
                </span>
              </div>
              <h3 className="briefing-title">{item.title}</h3>
              <div className="briefing-reason">
                <span className="briefing-reason-dot" />
                {item.reason}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
