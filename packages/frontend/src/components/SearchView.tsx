import { Search, X } from 'lucide-react'
import type { NewsItem } from '../api'

interface Props {
  results: NewsItem[]
  query: string
  onClear: () => void
  onNewsClick: (id: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#6b21a8', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#78716c',
}

export function SearchView({ results, query, onClear, onNewsClick }: Props) {
  return (
    <div className="search-view">
      <div className="search-header">
        <div className="search-input-wrap">
          <Search size={14} className="search-input-icon" />
          <input
            className="search-input"
            value={query}
            readOnly
            autoFocus
          />
          <button className="search-clear" onClick={onClear}>
            <X size={14} />
          </button>
        </div>
        <span className="search-count">{results.length} 条结果</span>
      </div>
      <div className="search-results">
        {results.map(item => (
          <article key={item.id} className="search-card" onClick={() => onNewsClick(item.id)}>
            <div className="search-meta">
              <span className="search-source">{item.source}</span>
              <span className="search-cat" style={{ backgroundColor: CATEGORY_COLORS[item.category] || '#78716c' }}>
                {item.category}
              </span>
            </div>
            <h3 className="search-title">{item.title}</h3>
            {item.summary && <p className="search-summary">{item.summary.slice(0, 200)}</p>}
          </article>
        ))}
      </div>
    </div>
  )
}
