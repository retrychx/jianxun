import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Hash, Globe, TrendingUp, GitBranch, Newspaper, Clock, Smile, Frown, Meh, Coins, Package, UserCog, Scale, LineChart, Handshake, Pin } from 'lucide-react'
import type { NewsItem, NarrativeSummary } from '../api'
import { decodeEntities } from '../utils'
import { NewsCard } from './NewsCard'
import type { Lang } from '../utils'

interface EntityBriefing {
  entity: string
  articleCount: number
  sourceStats: { source: string; count: number }[]
  sentimentTrend: { date: string; positive: number; negative: number; neutral: number; total: number }[]
  narratives: { keyword: string; label: string; articleCount: number; summary: string }[]
  keyPeople: { name: string; count: number }[]
  events?: { type: string; title: string; date: string; detail: string }[]
  articles: NewsItem[]
}

const EVENT_META: Record<string, { label: string; icon: typeof Coins; color: string }> = {
  funding: { label: '融资', icon: Coins, color: '#047857' },
  product: { label: '产品', icon: Package, color: '#b45309' },
  exec: { label: '人事', icon: UserCog, color: '#7c3aed' },
  regulatory: { label: '监管', icon: Scale, color: '#dc2626' },
  financial: { label: '财务', icon: LineChart, color: '#1d4ed8' },
  partnership: { label: '合作', icon: Handshake, color: '#0891b2' },
  other: { label: '其他', icon: Pin, color: '#737373' },
}

interface Props {
  entity: string
  lang: Lang
  onBack: () => void
  onNewsClick: (id: number) => void
  onNarrativeClick?: (keyword: string) => void
  onEntityClick?: (name: string) => void
}

export function EntityView({ entity, lang, onBack, onNewsClick, onNarrativeClick, onEntityClick }: Props) {
  const [briefing, setBriefing] = useState<EntityBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    fetch(`/api/news/entity/${encodeURIComponent(entity)}/briefing`).then(r => r.json()).then(d => {
      if (!cancelled) setBriefing(d)
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entity, reloadKey])

  if (loading) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 100, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  if (error || !briefing) return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>
      <div className="empty" style={{ marginTop: 40 }}>
        <Hash size={28} style={{ opacity: .3, marginBottom: 8 }} />
        <p>加载失败</p>
        <button style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-secondary)' }} onClick={() => setReloadKey(k => k + 1)}>重试</button>
      </div>
    </div>
  )

  const maxSrc = Math.max(...briefing.sourceStats.map(s => s.count), 1)
  const maxSent = Math.max(...briefing.sentimentTrend.map(s => s.total), 1)

  // 知识图谱·关联实体：与当前实体同现最多的其他实体（从相关报道的 entities 计算）
  const relatedEntities = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of briefing.articles || []) {
      const raw = a.entities
      if (!raw) continue
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            const n = e?.name?.trim()
            if (n && n.length >= 2 && n.toLowerCase() !== entity.toLowerCase()) {
              counts.set(n, (counts.get(n) || 0) + 1)
            }
          }
        }
      } catch {}
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count }))
  }, [briefing, entity])

  return (
    <div className="entity-view">
      <button className="browse-back" onClick={onBack}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /><span>返回</span></button>

      {/* ═══ Hero ═══ */}
      <div className="nd-hero" style={{ marginBottom: 20, paddingBottom: 16 }}>
        <h1 className="nd-hero-title">{briefing.entity}</h1>
        <div className="nd-cover-bar" style={{ marginTop: 10 }}>
          <div className="nd-cover-stat"><Newspaper size={14} /><span className="nd-cover-num">{briefing.articleCount}</span><span className="nd-cover-label">篇报道</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Globe size={14} /><span className="nd-cover-num">{briefing.sourceStats.length}</span><span className="nd-cover-label">个信源</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><GitBranch size={14} /><span className="nd-cover-num">{briefing.narratives.length}</span><span className="nd-cover-label">个故事</span></div>
          <div className="nd-cover-divider" />
          <div className="nd-cover-stat"><Clock size={14} /><span className="nd-cover-num">{briefing.sentimentTrend.length}</span><span className="nd-cover-label">天数据</span></div>
        </div>
      </div>

      {/* ═══ 情感趋势 ═══ */}
      {briefing.sentimentTrend.length > 1 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">情感走势</h3>
          <div className="eb-sent-chart">
            {briefing.sentimentTrend.map(day => (
              <div key={day.date} className="eb-sent-col" title={`${day.date} 正面${day.positive} 负面${day.negative} 中性${day.neutral}`}>
                <div className="eb-sent-bars">
                  <div className="eb-sent-bar positive" style={{ height: `${(day.positive / maxSent) * 100}%` }} />
                  <div className="eb-sent-bar negative" style={{ height: `${(day.negative / maxSent) * 100}%` }} />
                  <div className="eb-sent-bar neutral" style={{ height: `${(day.neutral / maxSent) * 100}%` }} />
                </div>
                <span className="eb-sent-label">{day.date.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="eb-sent-legend">
            <span><Smile size={12} style={{ color: '#059669' }} /> 正面</span>
            <span><Frown size={12} style={{ color: '#dc2626' }} /> 负面</span>
            <span><Meh size={12} style={{ color: '#a3a3a3' }} /> 中性</span>
          </div>
        </section>
      )}

      {/* ═══ 事件流 ═══ */}
      {briefing.events && briefing.events.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">事件动态</h3>
          <div className="eb-events">
            {briefing.events.map((ev, i) => {
              const meta = EVENT_META[ev.type] || EVENT_META.other
              const Icon = meta.icon
              return (
                <div key={i} className="eb-event">
                  <span className="eb-event-icon" style={{ color: meta.color }}><Icon size={15} /></span>
                  <div className="eb-event-body">
                    <div className="eb-event-title">{ev.title}</div>
                    {ev.detail && <div className="eb-event-detail">{ev.detail}</div>}
                    <div className="eb-event-meta">
                      <span className="eb-event-type" style={{ color: meta.color }}>{meta.label}</span>
                      {ev.date && <span>{ev.date}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══ 实体时间线：结构化事件 + 报道按日期合并（旧→新） ═══ */}
      {((briefing.events?.length || 0) > 0 || (briefing.articles?.length || 0) > 0) && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">时间线</h3>
          <div className="narr-timeline-v">
            {(() => {
              const evts = (briefing.events || []).map(e => ({ kind: 'event' as const, date: e.date || '', ev: e }))
              const arts = (briefing.articles || []).map(a => ({ kind: 'article' as const, date: (a.publishedAt || '').slice(0, 10), art: a }))
              const tl = [...evts, ...arts].filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
              return tl.map((x, idx) => (
                <div
                  key={idx}
                  className="tl-v-item"
                  role={x.kind === 'article' ? 'link' : undefined}
                  tabIndex={x.kind === 'article' ? 0 : undefined}
                  onClick={x.kind === 'article' ? () => onNewsClick(x.art.id) : undefined}
                  onKeyDown={x.kind === 'article' ? (e) => { if (e.key === 'Enter') onNewsClick(x.art.id) } : undefined}
                >
                  <div className={`tl-v-dot ${idx === tl.length - 1 ? 'active' : ''}`} />
                  {idx < tl.length - 1 && <div className="tl-v-line" />}
                  <div className="tl-v-body">
                    <div className="tl-v-meta">
                      <span className="tl-v-source">
                        {x.kind === 'event' ? (EVENT_META[x.ev.type]?.label || '事件') : (x.art.source || '')}
                      </span>
                      <span className="tl-v-time">{x.date}</span>
                    </div>
                    <div className="tl-v-title">
                      {x.kind === 'event' ? x.ev.title : decodeEntities(x.art.title || '')}
                    </div>
                  </div>
                </div>
              ))
            })()}
          </div>
        </section>
      )}

      {/* ═══ 信源覆盖 ═══ */}
      {briefing.sourceStats.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">信源覆盖</h3>
          <div className="nd-source-grid">
            {briefing.sourceStats.slice(0, 10).map(({ source, count }) => (
              <div key={source} className="nd-source-chip">
                <span className="nd-source-chip-name">{source}</span>
                <span className="nd-source-chip-bar"><span className="nd-source-chip-fill" style={{ width: `${(count / maxSrc) * 100}%` }} /></span>
                <span className="nd-source-chip-count">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 关联故事 ═══ */}
      {briefing.narratives.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关联故事</h3>
          <div className="nd-related-list">
            {briefing.narratives.map(n => (
              <button key={n.keyword} className={`nd-related-card ${onNarrativeClick ? 'clickable' : ''}`} onClick={() => onNarrativeClick?.(n.keyword)}>
                <div className="nd-related-top"><GitBranch size={14} className="nd-related-icon" /><span className="nd-related-label">{n.label}</span></div>
                <div className="nd-related-meta"><span>{n.articleCount} 篇</span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 关键人物 ═══ */}
      {briefing.keyPeople && briefing.keyPeople.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关键人物</h3>
          <div className="eb-people">
            {briefing.keyPeople.map(p => (
              <span key={p.name} className="eb-person-chip" onClick={() => onEntityClick?.(p.name)} style={{ cursor: 'pointer' }}>
                <span className="eb-person-name">{p.name}</span>
                <span className="eb-person-count">{p.count} 篇</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 关联实体（知识图谱） ═══ */}
      {relatedEntities.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 className="nd-section-title">关联实体 <span className="nd-section-sub">同现关系 · 点击查看</span></h3>
          <div className="nd-entity-strip" style={{ flexWrap: 'wrap' }}>
            {relatedEntities.map(re => (
              <span key={re.name} className="nd-entity-chip concept" onClick={() => onEntityClick?.(re.name)} style={{ cursor: 'pointer' }}>
                {re.name}
                <span className="nd-entity-chip-count" style={{ opacity: .6, marginLeft: 4 }}>{re.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ═══ 相关报道 ═══ */}
      <h3 className="nd-section-title">相关报道</h3>
      {briefing.articles.length === 0 ? (
        <div className="empty" style={{ marginTop: 20 }}><Hash size={28} style={{ opacity: .3 }} /><p>暂无相关报道</p></div>
      ) : (
        <div className="card-list">
          {briefing.articles.map((item, i) => (
            <div key={item.id} className="card-enter" style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}>
              <NewsCard item={item} lang={lang} onClick={onNewsClick} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
