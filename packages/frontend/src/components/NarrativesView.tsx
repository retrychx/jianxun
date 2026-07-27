import { useState, useEffect } from 'react'
import { GitBranch, ChevronRight, Clock, Hash, AlertTriangle, BookOpen, Flame } from 'lucide-react'
import { getNarratives, getNarrativesTimeline, type NarrativeSummary } from '../api'
import { formatDate } from '../utils'

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
  normal: { label: '追踪话题', icon: Clock, color: '#059669' },
}

function categorize(n: NarrativeSummary): Category {
  if (n.keyword.startsWith('__breaking__')) return 'breaking'
  if (n.keyword.startsWith('__debate__')) return 'debate'
  if (n.keyword.startsWith('__research__')) return 'research'
  if (n.keyword.startsWith('__cross__')) return 'cross'
  return 'normal'
}

function cleanLabel(label: string): string {
  return label.replace(/^[🔴⚡📖📍]\s*(?:突发|争议|研究|多源对比:)\s*/, '').replace(/^__\w+__/, '')
}

export function NarrativesView({ onNarrativeClick, onNewsClick, onResearchCreate }: Props) {
  const [narratives, setNarratives] = useState<NarrativeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'narratives' | 'timeline'>('narratives')

  useEffect(() => {
    let cancelled = false
    getNarratives().then(n => { if (!cancelled) { setNarratives(n.narratives); setLoading(false) } }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="narratives-view">
        <div className="nv-header"><h2 className="nv-title">叙事</h2></div>
        {[1, 2, 3].map(i => <div key={i} className="narr-card skeleton" style={{ height: 80, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
      </div>
    )
  }

  // Group by category
  const grouped = new Map<Category, NarrativeSummary[]>()
  for (const n of narratives) {
    const cat = categorize(n)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(n)
  }
  const order: Category[] = ['breaking', 'research', 'debate', 'cross', 'normal']

  if (!narratives.length) {
    return (
      <div className="narratives-view">
        <div className="nv-header"><h2 className="nv-title">叙事</h2></div>
        <div className="empty" style={{ marginTop: 40 }}>
          <GitBranch size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无叙事</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>Agent 将自动追踪话题进展</p>
        </div>
      </div>
    )
  }

  return (
    <div className="narratives-view">
      <div className="nv-header">
        <h2 className="nv-title">叙事</h2>
        <span className="nv-sub">{narratives.length} 个</span>
      </div>

      {order.map(cat => {
        const items = grouped.get(cat)
        if (!items?.length) return null
        const meta = CATEGORY_META[cat]
        const Icon = meta.icon
        return (
          <div key={cat} className="nv-section" style={{ marginBottom: 16 }}>
            <div className="nv-section-header" style={{ borderLeft: `3px solid ${meta.color}`, paddingLeft: 10, marginBottom: 8 }}>
              <Icon size={14} style={{ color: meta.color }} />
              <span className="nv-section-label">{meta.label}</span>
              <span className="nv-sub">{items.length}</span>
            </div>
            <div className="nv-list">
              {items.map((n, i) => {
                const isResearch = cat === 'research'
                return (
                  <div key={n.keyword} className="narr-card-wrap">
                    <button className="narr-card" onClick={() => onNarrativeClick(n.keyword)} style={{ animationDelay: `${i * 40}ms` }}>
                      <div className="narr-card-top">
                        <span className={`narr-status narr-${n.status}`}>{n.status === 'active' ? '追踪中' : '已停滞'}</span>
                        <ChevronRight size={14} className="narr-chevron" />
                      </div>
                      <div className="narr-card-label">{cleanLabel(n.label || n.keyword)}</div>
                      {n.summary && <div className="narr-card-summary">{n.summary}</div>}
                      <div className="narr-card-meta">
                        <span>{n.articleCount} 篇</span>
                        <span>{n.developmentCount} 条</span>
                        <span>{Object.keys(n.sourceStats).length} 个来源</span>
                      </div>
                    </button>
                    {isResearch && onResearchCreate && (
                      <button className="narr-view-btn" onClick={() => onResearchCreate(n.keyword)}>查看研究报告</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
