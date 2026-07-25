import { useState, useEffect, useRef, useCallback } from 'react'
import { Newspaper, Sparkles, BarChart3, Tags, Link2, FileText, ExternalLink, X, Maximize2 } from 'lucide-react'
import type { NewsDetail, EntityItem, NewsItem } from '../api'
import { getDetail, getByEntity } from '../api'

interface Props {
  newsId: number | null
  onClose: () => void
  onEntityClick: (entity: string) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  AI: '#b91c1c', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#737373',
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#b91c1c', company: '#047857', product: '#b45309',
  technology: '#737373', concept: '#737373',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: '人物', company: '公司', product: '产品',
  technology: '技术', concept: '概念',
}

const SENTIMENT_LABELS: Record<string, { label: string; color: string }> = {
  positive: { label: '正面', color: '#059669' },
  negative: { label: '负面', color: '#dc2626' },
  neutral: { label: '中性', color: '#737373' },
  mixed: { label: '混合', color: '#b45309' },
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function DetailPanel({ newsId, onClose, onEntityClick }: Props) {
  const [detail, setDetail] = useState<NewsDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [entityNews, setEntityNews] = useState<Map<string, NewsItem[]>>(new Map())
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Animate close: set closing → wait → call onClose
  const handleClose = useCallback(() => {
    setClosing(true)
    setTimeout(() => onClose(), 350)
  }, [onClose])

  useEffect(() => {
    if (!newsId) return
    setClosing(false)
    setLoading(true); setDetail(null); setEntityNews(new Map())
    getDetail(newsId).then(setDetail).finally(() => setLoading(false))
  }, [newsId])

  const handleEntityClick = async (entity: EntityItem) => {
    setExpandedEntity(prev => prev === entity.name ? null : entity.name)
    if (!entityNews.has(entity.name)) {
      const res = await getByEntity(entity.name)
      setEntityNews(prev => new Map(prev).set(entity.name, res.items))
    }
    onEntityClick(entity.name)
  }

  // Touch-to-close (drag down)
  const touchStart = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientY }
  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - touchStart.current
    if (diff > 80) handleClose()
  }

  if (!newsId) return null

  const sentiment = detail?.analysis?.sentiment
  const sentConfig = sentiment ? SENTIMENT_LABELS[sentiment.label] : null

  return (
    <>
      <div className="sheet-overlay" onClick={handleClose} />
      <div
        className={`sheet-panel${closing ? ' closing' : ''}`}
        ref={panelRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Handle */}
        <div className="sheet-handle-wrap">
          <div className="sheet-handle" />
          <button className="sheet-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="sheet-loading">
            <div className="sheet-loading-spinner" />
            <p>分析中...</p>
          </div>
        )}

        {detail && !loading && (
          <div className="sheet-content">
            {/* Image */}
            {detail.image && (
              <img className="sheet-image" src={detail.image} alt="" loading="lazy" />
            )}

            {/* Head */}
            <div className="sheet-section">
              <div className="sheet-source-row">
                <span className="sheet-source">{detail.source}</span>
                <span className="sheet-category" style={{ backgroundColor: CATEGORY_COLORS[detail.category] || '#737373' }}>
                  {detail.category}
                </span>
              </div>
              <h2 className="sheet-title">{detail.title}</h2>
              <div className="sheet-meta">
                <span>{formatDate(detail.publishedAt || detail.createdAt)}</span>
                <span className="sheet-meta-dot">·</span>
                <a href={detail.url} target="_blank" rel="noopener noreferrer" className="sheet-link">
                  查看原文 <ExternalLink size={11} />
                </a>
              </div>
            </div>

            {/* AI Summary */}
            {detail.analysis.summary && (
              <div className="sheet-section">
                <div className="sheet-label">
                  <Sparkles size={13} />
                  摘要
                </div>
                <p className="sheet-summary">{detail.analysis.summary}</p>
              </div>
            )}

            {/* Sentiment */}
            {sentiment && (
              <div className="sheet-section">
                <div className="sheet-label">
                  <BarChart3 size={13} />
                  报道角度
                </div>
                <div className="sheet-sentiment">
                  <div className="sheet-sentiment-track">
                    <div className="sheet-sentiment-fill s-positive" style={{ width: `${sentiment.scores.positive * 100}%` }} />
                    <div className="sheet-sentiment-fill s-neutral" style={{ width: `${sentiment.scores.neutral * 100}%` }} />
                    <div className="sheet-sentiment-fill s-negative" style={{ width: `${sentiment.scores.negative * 100}%` }} />
                  </div>
                  {sentConfig && (
                    <span className="sheet-sentiment-label" style={{ color: sentConfig.color }}>
                      {sentConfig.label}
                    </span>
                  )}
                </div>
                {sentiment.perspective && (
                  <p className="sheet-perspective">{sentiment.perspective}</p>
                )}
              </div>
            )}

            {/* Entities */}
            {detail.analysis.entities.length > 0 && (
              <div className="sheet-section">
                <div className="sheet-label">
                  <Tags size={13} />
                  关联
                </div>
                <div className="sheet-entity-list">
                  {detail.analysis.entities.map((e, i) => (
                    <div key={i} className="sheet-entity-group">
                      <button
                        className="sheet-entity-tag"
                        style={{ borderColor: ENTITY_TYPE_COLORS[e.type] || '#737373' }}
                        onClick={() => handleEntityClick(e)}
                      >
                        <span className="sheet-entity-name">{e.name}</span>
                        <span className="sheet-entity-type" style={{ color: ENTITY_TYPE_COLORS[e.type] }}>
                          {ENTITY_TYPE_LABELS[e.type] || e.type}
                        </span>
                      </button>
                      {expandedEntity === e.name && entityNews.get(e.name) && (
                        <div className="sheet-entity-dropdown">
                          {entityNews.get(e.name)!.slice(0, 5).map(n => (
                            <div key={n.id} className="sheet-entity-item">
                              <span className="sheet-entity-item-source">{n.source}</span>
                              <span className="sheet-entity-item-title">{n.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Multi-source */}
            {detail.related.length > 0 && (
              <div className="sheet-section">
                <div className="sheet-label">
                  <Newspaper size={13} />
                  其他来源 · {detail.related.length}
                </div>
                <div className="sheet-related">
                  {detail.related.map(r => (
                    <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="sheet-related-item">
                      <span className="sheet-related-source">{r.source}</span>
                      <span className="sheet-related-title">{r.title}</span>
                      <ExternalLink size={11} className="sheet-related-arrow" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Full text */}
            {detail.analysis.content && (
              <div className="sheet-section">
                <div className="sheet-label">
                  <FileText size={13} />
                  正文预览
                </div>
                <p className="sheet-text">{detail.analysis.content}</p>
                <a href={detail.url} target="_blank" rel="noopener noreferrer" className="sheet-readmore">
                  阅读全文 <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
