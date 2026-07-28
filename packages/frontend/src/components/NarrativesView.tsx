import { useState, useEffect, useRef, useCallback } from 'react'
import {
  GitBranch, ChevronRight, Clock, Hash, AlertTriangle,
  BookOpen, Flame, Radio, Globe, Newspaper, RefreshCw,
} from 'lucide-react'
import { getNarratives, type NarrativeSummary } from '../api'
import { decodeEntities } from '../utils'

interface Props {
  onNarrativeClick: (keyword: string, label?: string) => void
  onNewsClick: (id: number) => void
  onResearchCreate?: (keyword: string) => void
}

type Category = 'breaking' | 'debate' | 'research' | 'cross' | 'normal'

const CATEGORY_META: Record<Category, { label: string; icon: typeof Hash; color: string }> = {
  breaking: { label: '突发', icon: Flame, color: '#dc2626' },
  debate: { label: '争议', icon: AlertTriangle, color: '#d97706' },
  research: { label: '深度研究', icon: BookOpen, color: '#7c3aed' },
  cross: { label: '多源对比', icon: GitBranch, color: '#0891b2' },
  normal: { label: '追踪话题', icon: Radio, color: '#059669' },
}

function categorize(n: NarrativeSummary): Category {
  if (n.keyword.startsWith('__breaking__')) return 'breaking'
  if (n.keyword.startsWith('__debate__')) return 'debate'
  if (n.keyword.startsWith('__research__')) return 'research'
  if (n.keyword.startsWith('__cross__')) return 'cross'
  return 'normal'
}

function cleanLabel(label: string): string {
  return label
    .replace(/^__\w+__/, '')
    .replace(/^[🔴⚡📖📍]\s*/, '')
    .replace(/^(?:突发|争议|研究|多源对比:)\s*/, '')
    .trim()
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  const days = Math.floor(hrs / 24)
  return `${days} 天前`
}

function daysBetween(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

const REFRESH_COOLDOWN = 300_000 // 5 秒…不对，5 分钟

export function NarrativesView({ onNarrativeClick, onNewsClick, onResearchCreate }: Props) {
  const [narratives, setNarratives] = useState<NarrativeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [showStale, setShowStale] = useState(false)
  const [pullDist, setPullDist] = useState(0)
  const [pullPhase, setPullPhase] = useState<'idle' | 'pulling' | 'ready'>('idle')
  const touchStartY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load narratives
  const load = useCallback(async () => {
    try {
      const n = await getNarratives()
      setNarratives(n.narratives)
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  // Pull-to-refresh touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY
      setPullPhase('idle')
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === 0) return
    const dist = e.touches[0].clientY - touchStartY.current
    if (dist > 0 && containerRef.current && containerRef.current.scrollTop <= 0) {
      const clamped = Math.min(dist * 0.4, 80) // resistance + cap
      setPullDist(clamped)
      setPullPhase(clamped > 50 ? 'ready' : 'pulling')
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    touchStartY.current = 0
    if (pullPhase === 'ready') {
      triggerRefresh()
    }
    setPullDist(0)
    setPullPhase('idle')
  }, [pullPhase])

  // Trigger narrative recomputation
  const triggerRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/news/narrative/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setRefreshMsg('计算完成')
        await load()
      } else if (data.remaining) {
        setRefreshMsg(`请 ${data.remaining} 秒后再试`)
      } else {
        setRefreshMsg(data.error || '刷新失败')
      }
    } catch {
      setRefreshMsg('请求失败')
    }
    setRefreshing(false)
    setTimeout(() => setRefreshMsg(null), 3000)
  }, [refreshing, load])

  if (loading) {
    return (
      <div className="narratives-view" ref={containerRef}>
        <div className="nv-header"><h2 className="nv-title">故事脉络</h2></div>
        {[1, 2, 3].map(i => (
          <div key={i} className="narr-story-card skeleton" style={{ height: 120, marginBottom: 10, borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    )
  }

  const active = narratives.filter(n => n.status === 'active')
  const stale = narratives.filter(n => n.status !== 'active')

  active.sort((a, b) => {
    const catA = categorize(a), catB = categorize(b)
    const order: Category[] = ['breaking', 'debate', 'cross', 'research', 'normal']
    const diff = order.indexOf(catA) - order.indexOf(catB)
    if (diff !== 0) return diff
    return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  })
  stale.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

  return (
    <div
      className="narratives-view"
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      {pullDist > 0 && (
        <div className="nv-pull-indicator" style={{ height: pullDist, opacity: Math.min(pullDist / 50, 1) }}>
          <RefreshCw size={16} className={`nv-pull-icon ${pullPhase === 'ready' ? 'ready' : ''}`} />
          <span>{pullPhase === 'ready' ? '松开刷新' : '下拉刷新故事'}</span>
        </div>
      )}

      {/* Header with refresh */}
      <div className="nv-header">
        <div>
          <h2 className="nv-title">故事脉络</h2>
          <p className="nv-subtitle">
            {narratives.length > 0
              ? `${active.length} 个追踪中 · ${narratives.length} 个故事`
              : '追踪正在发生的重要话题'}
          </p>
        </div>
        <button
          className={`nv-refresh-btn ${refreshing ? 'spinning' : ''}`}
          onClick={triggerRefresh}
          disabled={refreshing}
          title="立即刷新"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Refresh feedback */}
      {refreshMsg && <div className="nv-refresh-toast">{refreshMsg}</div>}

      {!narratives.length ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <Radio size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无追踪中的故事</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>
            Agent 将自动识别并追踪重要话题的进展
          </p>
        </div>
      ) : (
        <>
          {active.map(n => {
            const cat = categorize(n)
            const meta = CATEGORY_META[cat]
            const Icon = meta.icon
            const span = daysBetween(n.firstSeen, n.lastUpdated)
            const sourceCount = Object.keys(n.sourceStats).length

            return (
              <button
                key={n.keyword}
                className="narr-story-card"
                onClick={() => onNarrativeClick(n.keyword, n.label)}
              >
                <div className="nsc-top">
                  <span className="nsc-category" style={{ color: meta.color }}>
                    <Icon size={14} />
                    {meta.label}
                  </span>
                  <span className="nsc-coverage">
                    <Newspaper size={12} />
                    {sourceCount} 家媒体
                  </span>
                </div>

                <h3 className="nsc-title">{cleanLabel(n.label || n.keyword)}</h3>

                {n.summary && (
                  <p className="nsc-summary">{decodeEntities(n.summary)}</p>
                )}

                <div className="nsc-meta">
                  <span><Clock size={12} /> {timeAgo(n.lastUpdated)} 更新</span>
                  <span className="nsc-dot">·</span>
                  <span>持续 {span} 天</span>
                  <span className="nsc-dot">·</span>
                  <span>{n.articleCount} 篇报道</span>
                  <span className="nsc-arrow"><ChevronRight size={14} /></span>
                </div>
              </button>
            )
          })}

          {stale.length > 0 && (
            <details className="nv-stale" open={showStale}>
              <summary className="nv-stale-summary" onClick={e => { e.preventDefault(); setShowStale(!showStale) }}>
                <Clock size={14} />
                <span>已停滞 ({stale.length})</span>
                <ChevronRight size={14} className={`nv-chevron ${showStale ? 'open' : ''}`} />
              </summary>
              <div className="nv-stale-list">
                {stale.map(n => (
                  <button
                    key={n.keyword}
                    className="narr-story-card stale"
                    onClick={() => onNarrativeClick(n.keyword, n.label)}
                  >
                    <h3 className="nsc-title">{cleanLabel(n.label || n.keyword)}</h3>
                    <div className="nsc-meta">
                      <span>{n.articleCount} 篇</span>
                      <span className="nsc-dot">·</span>
                      <span>{Object.keys(n.sourceStats).length} 个来源</span>
                    </div>
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
