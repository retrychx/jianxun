import { useState, useEffect, useRef, useCallback } from 'react'
import { Newspaper, Sparkles, BarChart3, Tags, FileText, ExternalLink, X } from 'lucide-react'
import type { NewsDetail, EntityItem, NewsItem } from '../api'
import { getDetail, getByEntity } from '../api'
import type { FollowItem } from '../hooks/useFollow'
import { categoryColor } from '../constants'
import { formatFullDate } from '../utils'

interface Props {
  newsId: number | null
  onClose: () => void
  onEntityClick: (entity: string) => void
  onNewsClick: (id: number) => void
  isFollowing: (id: string) => boolean
  toggleFollow: (name: string, type: FollowItem['type']) => void
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

export function DetailPanel({ newsId, onClose, onEntityClick, onNewsClick, isFollowing, toggleFollow }: Props) {
  const [detail, setDetail] = useState<NewsDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [entityNews, setEntityNews] = useState<Map<string, NewsItem[]>>(new Map())
  const [entityError, setEntityError] = useState<string | null>(null)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  // Animate close: set closing → wait → call onClose
  const handleClose = useCallback(() => {
    if (closeTimer.current) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      onClose()
    }, 350)
  }, [onClose])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const loadDetail = useCallback((id: number) => {
    setLoading(true); setLoadError(false); setDetail(null)
    setEntityNews(new Map()); setEntityError(null); setExpandedEntity(null)
    getDetail(id)
      .then(setDetail)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!newsId) return
    // 重新打开时取消未完成的关闭定时器
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setClosing(false)
    loadDetail(newsId)
  }, [newsId, loadDetail])

  // Esc 关闭
  useEffect(() => {
    if (!newsId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newsId, handleClose])

  const fetchEntityNews = async (name: string) => {
    setEntityError(null)
    try {
      const res = await getByEntity(name)
      setEntityNews(prev => new Map(prev).set(name, res.items))
    } catch {
      setEntityError(name)
    }
  }

  const handleEntityClick = async (entity: EntityItem) => {
    const opening = expandedEntity !== entity.name
    setExpandedEntity(opening ? entity.name : null)
    if (opening && !entityNews.has(entity.name)) {
      await fetchEntityNews(entity.name)
    }
  }

  // Touch-to-close (drag down)，仅移动端底部抽屉启用
  const touchStart = useRef(0)
  const isMobileSheet = () => window.matchMedia('(max-width: 768px)').matches
  const onTouchStart = (e: React.TouchEvent) => {
    if (!isMobileSheet()) return
    touchStart.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!isMobileSheet()) return
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
        role="dialog"
        aria-modal="true"
        aria-label="新闻详情"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Handle */}
        <div className="sheet-handle-wrap">
          <div className="sheet-handle" />
          <button className="sheet-close" onClick={handleClose} aria-label="关闭">
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

        {/* Error */}
        {loadError && !loading && (
          <div className="sheet-loading">
            <p>详情加载失败</p>
            <button className="sheet-retry" onClick={() => loadDetail(newsId)}>重试</button>
          </div>
        )}

        {detail && !loading && !loadError && (
          <div className="sheet-content">
            {/* Image */}
            {detail.image && (
              <img className="sheet-image" src={detail.image} alt="" loading="lazy" />
            )}

            {/* Head */}
            <div className="sheet-section">
              <div className="sheet-source-row">
                <span className="sheet-source">{detail.source}</span>
                <span className="sheet-category" style={{ backgroundColor: categoryColor(detail.category) }}>
                  {detail.category}
                </span>
              </div>
              <h2 className="sheet-title">{detail.title}</h2>
              <div className="sheet-meta">
                <span>{formatFullDate(detail.publishedAt || detail.createdAt)}</span>
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
                      <div className="sheet-entity-row">
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
                        <button
                          className={`entity-follow ${isFollowing('entity:' + e.name) ? 'following' : ''}`}
                          onClick={(ev) => { ev.stopPropagation(); toggleFollow(e.name, 'entity') }}
                          title={isFollowing('entity:' + e.name) ? '取消关注' : '关注'}
                          aria-label={isFollowing('entity:' + e.name) ? `取消关注 ${e.name}` : `关注 ${e.name}`}
                        >
                          {isFollowing('entity:' + e.name) ? '✓' : '+'}
                        </button>
                      </div>
                      {expandedEntity === e.name && (
                        <div className="sheet-entity-dropdown">
                          {entityError === e.name ? (
                            <div className="sheet-entity-item" onClick={() => fetchEntityNews(e.name)}>加载失败，点击重试</div>
                          ) : !entityNews.has(e.name) ? (
                            <div className="sheet-entity-item">加载中...</div>
                          ) : (
                            <>
                              {(entityNews.get(e.name) || []).slice(0, 5).map(n => (
                                <div key={n.id} className="sheet-entity-item" onClick={() => onNewsClick(n.id)}>
                                  <span className="sheet-entity-item-source">{n.source}</span>
                                  <span className="sheet-entity-item-title">{n.title}</span>
                                </div>
                              ))}
                              {entityNews.has(e.name) && entityNews.get(e.name)!.length === 0 && (
                                <div className="sheet-entity-item">暂无相关报道</div>
                              )}
                              <button className="sheet-entity-more" onClick={() => onEntityClick(e.name)}>
                                查看全部相关报道
                              </button>
                            </>
                          )}
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
