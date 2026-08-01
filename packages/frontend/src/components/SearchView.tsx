import { useEffect, useRef, useState } from 'react'
import { X, SearchX, MessageCircleQuestion, Globe, GitBranch, Newspaper, TrendingUp, Clock, ChevronRight } from 'lucide-react'
import type { NewsItem } from '../api'
import { getNarratives } from '../api'
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
  onAsk: (q: string) => void
  onEntityClick?: (name: string) => void
  onNarrativeClick?: (keyword: string) => void
}

interface EntityIntelligence {
  entity: string
  articleCount: number
  sourceStats: { source: string; count: number }[]
  sentimentTrend: { date: string; total: number }[]
}

export function SearchView({ results, query, searching, error, lang, onClear, onNewsClick, onAsk, onEntityClick, onNarrativeClick }: Props) {
  const [intel, setIntel] = useState<EntityIntelligence | null>(null)
  const [relatedNarratives, setRelatedNarratives] = useState<{ keyword: string; label: string; articleCount: number }[]>([])
  const [showIntel, setShowIntel] = useState(true)

  // 竞态防护：输入 openai 后又改成 anthropic，旧查询的晚到响应不应覆盖新情报条
  const intelSeq = useRef(0)
  useEffect(() => {
    if (query.length < 2) { setIntel(null); setRelatedNarratives([]); return }
    setShowIntel(true)
    const seq = ++intelSeq.current
    Promise.allSettled([
      fetch(`/api/news/entity/${encodeURIComponent(query)}/briefing`).then(r => r.ok ? r.json() : null),
      getNarratives().then(d => {
        const q = query.toLowerCase()
        return (d.narratives || []).filter(n =>
          (n.label || n.keyword || '').toLowerCase().includes(q)
        ).slice(0, 5).map(n => ({
          keyword: n.keyword,
          label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
          articleCount: n.articleCount,
        }))
      }),
    ]).then(([entityRes, narrRes]) => {
      if (seq !== intelSeq.current) return
      if (entityRes.status === 'fulfilled' && entityRes.value) setIntel(entityRes.value)
      if (narrRes.status === 'fulfilled') setRelatedNarratives(narrRes.value)
    })
  }, [query])

  if (query.length < 2) return (
    <div className="search-view"><div className="search-hint">输入至少 2 个字符开始搜索</div></div>
  )

  const hasIntel = intel && intel.articleCount > 0 && showIntel

  return (
    <div className="search-view">
      <div className="search-header">
        <span className="search-query">「{query}」</span>
        <div className="search-header-actions">
          <button className="search-ask-link" onClick={() => onAsk(query)}>问问 AI</button>
          <button className="search-clear" onClick={onClear} aria-label="清除搜索"><X size={14} /></button>
        </div>
      </div>

      {/* ═══ 知识条：宽度极窄的实体情报入口 ═══ */}
      {intel && intel.articleCount > 0 && (
        <div className="search-intel-row" onClick={() => { if (showIntel) onEntityClick?.(query); else setShowIntel(true) }} style={{ cursor: 'pointer' }}>
          <TrendingUp size={14} />
          <span className="search-intel-row-text">{intel.entity}</span>
          <span className="search-intel-row-stats">{intel.articleCount} 篇 · {intel.sourceStats.length} 个信源</span>
          <ChevronRight size={14} className="search-intel-row-arrow" />
        </div>
      )}

      {/* ═══ 关联叙事紧凑横排 ═══ */}
      {relatedNarratives.length > 0 && (
        <div className="search-narr-strip">
          <span className="search-narr-strip-label"><GitBranch size={12} /></span>
          {relatedNarratives.map(n => (
            <button key={n.keyword} className="search-narr-chip" onClick={() => onNarrativeClick?.(n.keyword)}>
              {n.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ 文章结果 ═══ */}
      <div className="search-results-section">
        {searching ? (
          <div className="search-hint">搜索中...</div>
        ) : error ? (
          <div className="search-hint">搜索失败，请稍后重试</div>
        ) : results.length === 0 && !intel && relatedNarratives.length === 0 ? (
          <div className="search-hint"><SearchX size={24} style={{ marginBottom: 8 }} /><p>没有找到相关新闻</p></div>
        ) : results.length > 0 ? (
          <div className="card-list">
            {results.map((item, i) => (
              <div key={item.id} className="card-enter" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                <NewsCard item={item} lang={lang} onClick={onNewsClick} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
