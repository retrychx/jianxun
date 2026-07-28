import { useEffect, useState } from 'react'
import { X, SearchX, MessageCircleQuestion, Globe, GitBranch, Newspaper, TrendingUp, Clock } from 'lucide-react'
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
  narratives: { keyword: string; label: string; articleCount: number }[]
}

export function SearchView({ results, query, searching, error, lang, onClear, onNewsClick, onAsk, onEntityClick, onNarrativeClick }: Props) {
  const [intel, setIntel] = useState<EntityIntelligence | null>(null)
  const [relatedNarratives, setRelatedNarratives] = useState<{ keyword: string; label: string; articleCount: number }[]>([])
  const [loadingIntel, setLoadingIntel] = useState(false)

  useEffect(() => {
    if (query.length < 2) { setIntel(null); setRelatedNarratives([]); return }

    // 并行获取实体情报 + 关联叙事
    setLoadingIntel(true)
    Promise.allSettled([
      fetch(`/api/news/entity/${encodeURIComponent(query)}/briefing`).then(r => r.ok ? r.json() : null),
      getNarratives().then(d => {
        const q = query.toLowerCase()
        return (d.narratives || []).filter(n =>
          (n.label || n.keyword || '').toLowerCase().includes(q)
        ).slice(0, 4).map(n => ({
          keyword: n.keyword,
          label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
          articleCount: n.articleCount,
        }))
      }),
    ]).then(([entityRes, narrRes]) => {
      if (entityRes.status === 'fulfilled' && entityRes.value) setIntel(entityRes.value)
      if (narrRes.status === 'fulfilled') setRelatedNarratives(narrRes.value)
    }).finally(() => setLoadingIntel(false))
  }, [query])

  if (query.length < 2) return (
    <div className="search-view"><div className="search-hint">输入至少 2 个字符开始搜索</div></div>
  )

  return (
    <div className="search-view">
      <button className="search-ask-link" onClick={() => onAsk(query)}>
        <MessageCircleQuestion size={13} /> 直接提问 →
      </button>
      <div className="search-header">
        <span className="search-query">「{query}」的搜索结果</span>
        <button className="search-clear" onClick={onClear} aria-label="清除搜索"><X size={14} /></button>
      </div>

      {/* ═══ 知识卡片：实体情报 ═══ */}
      {intel && intel.articleCount > 0 && (
        <div className="search-intel-card" onClick={() => onEntityClick?.(query)} style={{ cursor: onEntityClick ? 'pointer' : 'default' }}>
          <div className="search-intel-header">
            <span className="search-intel-title"><TrendingUp size={14} /> {intel.entity}</span>
            <span className="search-intel-badge">情报概览 →</span>
          </div>
          <div className="search-intel-stats">
            <span><Newspaper size={12} /> {intel.articleCount} 篇</span>
            <span><Globe size={12} /> {intel.sourceStats.length} 个信源</span>
            <span><Clock size={12} /> {intel.sentimentTrend.length} 天数据</span>
          </div>
          {intel.sourceStats.length > 0 && (
            <div className="search-intel-sources">
              {intel.sourceStats.slice(0, 5).map(s => (
                <span key={s.source} className="search-intel-source">{s.source}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 关联叙事 ═══ */}
      {relatedNarratives.length > 0 && (
        <div className="search-narr-section">
          <div className="search-narr-header"><GitBranch size={13} /> 关联故事</div>
          <div className="search-narr-list">
            {relatedNarratives.map(n => (
              <button key={n.keyword} className="search-narr-item" onClick={() => onNarrativeClick?.(n.keyword)}>
                <span className="search-narr-label">{n.label}</span>
                <span className="search-narr-meta">{n.articleCount} 篇</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 文章结果 ═══ */}
      {searching ? (
        <div className="search-hint">搜索中...</div>
      ) : error ? (
        <div className="search-hint">搜索失败，请稍后重试</div>
      ) : results.length === 0 && !intel && relatedNarratives.length === 0 ? (
        <div className="search-hint"><SearchX size={24} style={{ marginBottom: 8 }} /><p>没有找到相关新闻</p></div>
      ) : results.length > 0 ? (
        <div className="card-list" style={{ marginTop: 12 }}>
          <div className="search-results-label">相关报道</div>
          {results.map(item => (
            <NewsCard key={item.id} item={item} lang={lang} onClick={onNewsClick} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
