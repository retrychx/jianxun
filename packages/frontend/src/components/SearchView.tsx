import { X, SearchX } from 'lucide-react'
import type { NewsItem } from '../api'
import { NewsCard } from './NewsCard'
import type { Lang } from '../utils'

interface Props {
  results: NewsItem[]
  query: string
  searching: boolean
  error: boolean
  lang: Lang
  onClear: () => void
  onNewsClick: (id: number) => void
}

export function SearchView({ results, query, searching, error, lang, onClear, onNewsClick }: Props) {
  return (
    <div className="search-view">
      <div className="search-header">
        <span className="search-query">「{query}」的搜索结果</span>
        <button className="search-clear" onClick={onClear} aria-label="清除搜索">
          <X size={14} />
        </button>
      </div>
      {query.length < 2 ? (
        <div className="search-hint">输入至少 2 个字符开始搜索</div>
      ) : searching ? (
        <div className="search-hint">搜索中...</div>
      ) : error ? (
        <div className="search-hint">搜索失败，请稍后重试</div>
      ) : results.length === 0 ? (
        <div className="search-hint">
          <SearchX size={24} style={{ marginBottom: 8 }} />
          <p>没有找到相关新闻</p>
        </div>
      ) : (
        <div className="card-list">
          {results.map(item => (
            <NewsCard key={item.id} item={item} lang={lang} onClick={onNewsClick} />
          ))}
        </div>
      )}
    </div>
  )
}
