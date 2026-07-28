import { useState, useEffect } from 'react'
import {
  GitBranch, ChevronRight, Clock, Hash, AlertTriangle,
  BookOpen, Flame, Radio, Globe, Newspaper,
} from 'lucide-react'
import { getNarratives, type NarrativeSummary } from '../api'
import { decodeEntities } from '../utils'

interface Props {
  onNarrativeClick: (keyword: string) => void
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

export function NarrativesView({ onNarrativeClick, onNewsClick, onResearchCreate }: Props) {
  const [narratives, setNarratives] = useState<NarrativeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showStale, setShowStale] = useState(false)

  useEffect(() => {
    let cancelled = false
    getNarratives().then(n => {
      if (!cancelled) { setNarratives(n.narratives); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="narratives-view">
        <div className="nv-header"><h2 className="nv-title">故事脉络</h2></div>
        {[1, 2, 3].map(i => (
          <div key={i} className="narr-story-card skeleton" style={{ height: 120, marginBottom: 10, borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    )
  }

  const active = narratives.filter(n => n.status === 'active')
  const stale = narratives.filter(n => n.status !== 'active')

  // Sort active: breaking first, then by lastUpdated desc
  active.sort((a, b) => {
    const catA = categorize(a), catB = categorize(b)
    const order: Category[] = ['breaking', 'debate', 'cross', 'research', 'normal']
    const diff = order.indexOf(catA) - order.indexOf(catB)
    if (diff !== 0) return diff
    return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  })
  stale.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

  if (!narratives.length) {
    return (
      <div className="narratives-view">
        <div className="nv-header"><h2 className="nv-title">故事脉络</h2></div>
        <div className="empty" style={{ marginTop: 40 }}>
          <Radio size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无追踪中的故事</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>
            Agent 将自动识别并追踪重要话题的进展
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="narratives-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">故事脉络</h2>
          <p className="nv-subtitle">追踪正在发生的重要话题，看它怎么演变</p>
        </div>
      </div>

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
            onClick={() => onNarrativeClick(n.keyword)}
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
                onClick={() => onNarrativeClick(n.keyword)}
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
    </div>
  )
}
