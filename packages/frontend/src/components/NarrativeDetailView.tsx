import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Bell, BellOff, BookOpen, Radio, Globe, Newspaper, Clock, ChevronRight, MapPin, Users, GitBranch, Lightbulb, TrendingUp, ExternalLink } from 'lucide-react'
import { decodeEntities } from '../utils'
import { getNarrative, type NarrativeDetail, type NarrativeEntity } from '../api'
import { NewsCard } from './NewsCard'

interface Props {
  keyword: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
  isFollowing?: (id: string) => boolean
  toggleFollow?: (name: string, type: 'entity' | 'category' | 'source' | 'narrative') => void
  onResearch?: (keyword: string, label: string) => void
  onNarrativeClick?: (keyword: string, label?: string) => void
}

type Lang = 'zh' | 'en'

const TYPE_LABELS: Record<string, string> = {
  person: '人物', company: '公司', product: '产品',
  technology: '技术', concept: '概念',
}

function narrTypeInfo(keyword: string): { label: string; color: string } | null {
  if (keyword.startsWith('__breaking__')) return { label: '突发', color: '#dc2626' }
  if (keyword.startsWith('__research__')) return { label: '研究', color: '#7c3aed' }
  if (keyword.startsWith('__debate__')) return { label: '争议', color: '#d97706' }
  if (keyword.startsWith('__cross__')) return { label: '多源', color: '#0891b2' }
  return null
}

function cleanNarrativeTitle(label: string): string {
  return label.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').replace(/^(?:突发|争议|研究|多源对比:)\s*/, '').trim()
}

export function NarrativeDetailView({ keyword, lang, onBack, onNewsClick, isFollowing, toggleFollow, onResearch, onNarrativeClick }: Props) {
  const [narrative, setNarrative] = useState<NarrativeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null)
  const [showAllEntities, setShowAllEntities] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    getNarrative(keyword).then(n => {
      if (!cancelled) { setNarrative(n); setLoading(false) }
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [keyword])

  // Group developments by phase (day)
  const phases = useMemo(() => {
    if (!narrative) return []
    const groups = new Map<string, typeof narrative.developments>()
    for (const dev of narrative.developments) {
      const day = dev.date.slice(0, 10)
      if (!groups.has(day)) groups.set(day, [])
      groups.get(day)!.push(dev)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [narrative])

  // ── Entity evolution per phase ──
  const entityTimeline = useMemo(() => {
    if (!narrative?.articles.length) return []
    return phases.map(([day, devs]) => {
      // Find articles published near this phase date
      const phaseArticles = narrative.articles.filter(a => {
        const pa = (a.publishedAt || '').slice(0, 10)
        return pa === day || (devs.some(d => d.sources?.includes(a.source)))
      })
      // Extract entities from these articles
      const entityMap = new Map<string, { name: string; type: string; count: number }>()
      for (const a of phaseArticles) {
        let entities: any[] = []
        if (typeof a.entities === 'string') { try { entities = JSON.parse(a.entities) } catch {} }
        else if (Array.isArray(a.entities)) entities = a.entities
        for (const e of entities) {
          const name = e?.name?.trim()
          if (!name || name.length < 2) continue
          const key = name.toLowerCase()
          if (!entityMap.has(key)) entityMap.set(key, { name, type: e.type || 'concept', count: 0 })
          entityMap.get(key)!.count++
        }
      }
      const sorted = [...entityMap.values()].sort((a, b) => b.count - a.count)
      return { day, entities: sorted.slice(0, 6) }
    }).filter(p => p.entities.length > 0)
  }, [narrative, phases])

  // ── Source angle comparison ──
  const sourceAngles = useMemo(() => {
    if (!narrative?.articles.length) return []
    const sourceEntityTypes = new Map<string, Map<string, number>>()
    for (const a of narrative.articles) {
      const src = a.source
      if (!src) continue
      if (!sourceEntityTypes.has(src)) sourceEntityTypes.set(src, new Map())
      const typeMap = sourceEntityTypes.get(src)!
      let entities: any[] = []
      if (typeof a.entities === 'string') { try { entities = JSON.parse(a.entities) } catch {} }
      else if (Array.isArray(a.entities)) entities = a.entities
      for (const e of entities) {
        const t = e?.type || 'concept'
        typeMap.set(t, (typeMap.get(t) || 0) + 1)
      }
    }
    return [...sourceEntityTypes.entries()]
      .map(([source, types]) => {
        const sorted = [...types.entries()].sort((a, b) => b[1] - a[1])
        const dominantType = sorted[0]?.[0] || 'concept'
        return { source, dominantType, label: TYPE_LABELS[dominantType] || dominantType, types: Object.fromEntries(types) }
      })
      .sort((a, b) => {
        const countA = Object.values(a.types).reduce((s, v) => s + v, 0)
        const countB = Object.values(b.types).reduce((s, v) => s + v, 0)
        return countB - countA
      })
  }, [narrative])

  const followId = `narrative:${keyword}`
  const followed = isFollowing?.(followId) ?? false
  const typeInfo = narrTypeInfo(keyword)

  if (loading) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <div className="narr-detail-info">
            <div className="skeleton" style={{ height: 12, width: '30%', marginBottom: 6, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 22, width: '70%', borderRadius: 4 }} />
          </div>
        </div>
        <div className="narr-detail-skeleton" style={{ marginTop: 16 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 100, marginBottom: 12, borderRadius: 'var(--radius)' }} />)}
        </div>
      </div>
    )
  }

  if (error || !narrative) {
    return (
      <div className="narr-detail">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <h2 className="nd-hero-title" style={{ flex: 1 }}>故事未找到</h2>
        </div>
        <div className="empty" style={{ marginTop: 40 }}>
          <Radio size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>故事未找到</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>换个关键词试试，或在故事列表查看活跃话题</p>
        </div>
      </div>
    )
  }

  const sourceCount = Object.keys(narrative.sourceStats).length
  const sources = Object.entries(narrative.sourceStats).sort(([, a], [, b]) => b - a)
  const maxSourceCount = sources.length > 0 ? sources[0][1] : 0
  const today = new Date().toISOString().slice(0, 10)
  const daysRunning = Math.max(1, Math.round((new Date(today).getTime() - new Date(narrative.firstSeen).getTime()) / 86400000))

  return (
    <div className="narr-detail">
      {/* Hero */}
      <div className="nd-hero">
        <div className="narr-detail-top">
          <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <div className="narr-detail-info">
            <div className="narr-detail-meta">
              {typeInfo && (
                <span className="nd-type-badge" style={{ color: typeInfo.color, background: `${typeInfo.color}1a` }}>
                  {typeInfo.label}
                </span>
              )}
              <span className={`nd-status-badge ${narrative.status}`}>
                {narrative.status === 'active' ? '追踪中' : '已停滞'}
              </span>
            </div>
            <h1 className="nd-hero-title">{cleanNarrativeTitle(narrative.label || narrative.keyword)}</h1>
          </div>
          <div className="narr-detail-actions">
            {toggleFollow && (
              <button className="narr-action-btn" onClick={() => toggleFollow(keyword, 'narrative')} title={followed ? '取消关注' : '关注此叙事'}>
                {followed ? <BellOff size={16} /> : <Bell size={16} />}
              </button>
            )}
            {onResearch && (
              <button className="narr-action-btn" onClick={() => onResearch(keyword, narrative?.label || keyword)} title="深度研究">
                <BookOpen size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="nd-cover-bar">
          <div className="nd-cover-stat"><Globe size={14} /><span className="nd-cover-num">{sourceCount}</span><span className="nd-cover-label">家媒体</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Newspaper size={14} /><span className="nd-cover-num">{narrative.articleCount}</span><span className="nd-cover-label">篇报道</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><MapPin size={14} /><span className="nd-cover-num">{daysRunning}</span><span className="nd-cover-label">天</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Clock size={14} /><span className="nd-cover-num">{narrative.developmentCount}</span><span className="nd-cover-label">条进展</span></div>
        </div>

        {narrative.summary && <p className="nd-hero-summary">{decodeEntities(narrative.summary)}</p>}

        {/* 叙事前瞻 */}
        {narrative.outlook && (
          <div className="nd-outlook">
            <span className="nd-outlook-label">下一步关注</span>
            <span className="nd-outlook-text">{narrative.outlook}</span>
          </div>
        )}

        {/* Key entities */}
        {narrative.entities && narrative.entities.length > 0 && (
          <div className="nd-entity-strip">
            {(showAllEntities ? narrative.entities : narrative.entities.slice(0, 8)).map(e => (
              <span key={e.name} className={`nd-entity-chip ${e.type}`}>{e.name}</span>
            ))}
            {narrative.entities.length > 8 && (
              <button className="nd-entity-more" onClick={() => setShowAllEntities(!showAllEntities)}>
                {showAllEntities ? '收起' : `+${narrative.entities.length - 8}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ ① Entity Evolution Timeline ═══ */}
      {entityTimeline.length > 1 && (
        <section className="nd-et-section">
          <h3 className="nd-section-title">实体演变 <span className="nd-section-sub">各阶段的关键角色</span></h3>
          <div className="nd-et-track">
            {entityTimeline.map((phase, i) => (
              <div key={phase.day} className="nd-et-phase">
                <div className="nd-et-phase-top">
                  <span className="nd-et-day">{phase.day.slice(5)}</span>
                  {i < entityTimeline.length - 1 && <div className="nd-et-connector" />}
                </div>
                <div className="nd-et-entities">
                  {phase.entities.map(e => (
                    <span key={e.name} className={`nd-et-entity ${e.type}`}>
                      <span className="nd-et-entity-name">{e.name}</span>
                      <span className="nd-et-entity-type">{TYPE_LABELS[e.type] || e.type}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ ② Timeline ═══ */}
      {phases.length > 0 && (
        <section className="nd-timeline-section">
          <h3 className="nd-section-title">演变时间线</h3>
          <div className="nd-timeline">
            {phases.map(([day, devs], phaseIdx) => {
              const isExpanded = expandedPhase === day || phases.length <= 3 || phaseIdx >= phases.length - 2
              return (
                <div key={day} className={`nd-phase ${isExpanded ? '' : 'collapsed'}`}>
                  <button className="nd-phase-header" onClick={() => setExpandedPhase(isExpanded ? null : day)}>
                    <span className="nd-phase-date">{day}</span>
                    <span className="nd-phase-count">{devs.length} 条进展</span>
                    <ChevronRight size={14} className={`nd-phase-chevron ${isExpanded ? 'open' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="nd-phase-body">
                      {devs.map((dev, i) => (
                        <div key={i} className="nd-dev-item">
                          <div className="nd-dev-marker">
                            <div className={`nd-dev-dot ${phaseIdx === phases.length - 1 && i === devs.length - 1 ? 'latest' : ''}`} />
                            {i < devs.length - 1 && <div className="nd-dev-line" />}
                          </div>
                          <div className="nd-dev-body">
                            <p className="nd-dev-text">{decodeEntities(dev.text)}</p>
                            <div className="nd-dev-footer">
                              <span className="nd-dev-articles">{dev.articleCount} 篇报道</span>
                              {dev.sources?.length > 0 && (
                                <span className="nd-dev-sources"><Users size={11} />{dev.sources.slice(0, 4).join(' · ')}{dev.sources.length > 4 && ` +${dev.sources.length - 4}`}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══ ③ Source Angle Comparison ═══ */}
      {sourceAngles.length > 1 && (
        <section className="nd-sa-section">
          <h3 className="nd-section-title">信源视角 <span className="nd-section-sub">各媒体关注点不同</span></h3>
          <div className="nd-sa-grid">
            {sourceAngles.map(sa => {
              const total = Object.values(sa.types).reduce((s, v) => s + v, 0)
              return (
                <div key={sa.source} className="nd-sa-card">
                  <div className="nd-sa-header">
                    <span className="nd-sa-source">{sa.source}</span>
                    <span className="nd-sa-angle">{sa.label}</span>
                  </div>
                  <div className="nd-sa-bar">
                    {Object.entries(sa.types).map(([type, count]) => (
                      <div key={type} className={`nd-sa-bar-seg type-${type}`} style={{ width: `${(count / total) * 100}%` }} title={`${TYPE_LABELS[type] || type}: ${count}`} />
                    ))}
                  </div>
                  <div className="nd-sa-types">
                    {Object.entries(sa.types).slice(0, 3).map(([type, count]) => (
                      <span key={type} className="nd-sa-type">{TYPE_LABELS[type] || type} {count}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {phases[0]?.[1]?.[0]?.text && (
            <div className="nd-cr-summary" style={{ marginTop: 12 }}>
              <p>{decodeEntities(phases[0][1][0].text)}</p>
            </div>
          )}
        </section>
      )}

      {/* Source distribution */}
      {sources.length > 0 && (
        <section className="nd-sources-section">
          <h3 className="nd-section-title">信源覆盖</h3>
          <div className="nd-source-grid">
            {sources.slice(0, 12).map(([src, count]) => (
              <div key={src} className="nd-source-chip">
                <span className="nd-source-chip-name">{src}</span>
                <span className="nd-source-chip-bar"><span className="nd-source-chip-fill" style={{ width: `${(count / maxSourceCount) * 100}%` }} /></span>
                <span className="nd-source-chip-count">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ ④ Related Narratives ═══ */}
      {narrative.related && narrative.related.length > 0 && (
        <section className="nd-related-section">
          <h3 className="nd-section-title">关联故事</h3>
          <div className="nd-related-list">
            {narrative.related.map(r => (
              <button key={r.keyword} className={`nd-related-card ${onNarrativeClick ? 'clickable' : ''}`} onClick={() => onNarrativeClick?.(r.keyword)} disabled={!onNarrativeClick}>
                <div className="nd-related-top">
                  <GitBranch size={14} className="nd-related-icon" />
                  <span className="nd-related-label">{cleanNarrativeTitle(r.label)}</span>
                </div>
                <div className="nd-related-meta">
                  <span>{r.articleCount} 篇</span>
                  <span className="nsc-dot">·</span>
                  <span>关联度 {r.overlap}</span>
                </div>
                <ExternalLink size={12} className="nd-related-arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Related articles */}
      {narrative.articles.length > 0 && (
        <section className="nd-articles-section">
          <h3 className="nd-section-title">相关报道</h3>
          {narrative.articles.slice(0, 20).map(item => (
            <NewsCard key={item.id} item={item} lang={lang} onClick={onNewsClick} />
          ))}
        </section>
      )}
    </div>
  )
}
