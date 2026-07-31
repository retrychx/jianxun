import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, ChevronDown, GitBranch, Radar, ExternalLink } from 'lucide-react'
import type { NewsItem } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  items: NewsItem[]
  lang?: Lang
  onNewsClick: (id: number) => void
  onNarrativeClick?: (keyword: string) => void
  onSectorClick?: () => void
}

interface Signal { keyword: string; label: string; sourceCount: number; articleCount: number }
interface Sector { key: string; label: string; articleCount: number; players: { name: string; count: number }[] }

function articleEntityNames(item: NewsItem): string[] {
  const names: string[] = []
  try {
    const parsed = typeof item.entities === 'string' ? JSON.parse(item.entities) : item.entities
    if (Array.isArray(parsed)) {
      for (const e of parsed) {
        if (e?.name) names.push(String(e.name).toLowerCase())
      }
    }
  } catch {}
  if (item.title) names.push(item.title.toLowerCase())
  return names
}

export function IntelligenceStream({ items, lang = 'zh', onNewsClick, onNarrativeClick, onSectorClick }: Props) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/news/signals').then(r => r.json()).then(d => {
      if (d.risingNarratives) setSignals(d.risingNarratives.slice(0, 6))
    }).catch(() => {})
    fetch('/api/news/sectors').then(r => r.json()).then(d => {
      if (d.sectors) setSectors(d.sectors.slice(0, 4))
    }).catch(() => {})
  }, [])

  // 每篇文章的关联情报
  const relatedMap = useMemo(() => {
    const map = new Map<number, { signals: Signal[]; sectors: Sector[] }>()
    for (const item of items.slice(0, 10)) {
      const names = articleEntityNames(item)
      const matchedSignals = signals.filter(s => {
        const label = s.label.toLowerCase()
        return names.some(n => label.includes(n) || n.includes(label))
      })
      const matchedSectors = sectors.filter(sc => {
        const text = names.join(' ')
        return sc.players.some(p => text.includes(p.name.toLowerCase()))
      })
      map.set(item.id, { signals: matchedSignals, sectors: matchedSectors })
    }
    return map
  }, [items, signals, sectors])

  if (!items.length) return null

  return (
    <div className="trending-panel">
      <div className="panel-header">
        <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
        <span className="panel-title">情报流</span>
        <span className="panel-subtitle">点开看关联叙事</span>
      </div>
      <div className="stream-list">
        {items.slice(0, 10).map((item, i) => {
          const isExpanded = expandedId === item.id
          const related = relatedMap.get(item.id)
          const hasRelated = related && (related.signals.length > 0 || related.sectors.length > 0)
          return (
            <div key={item.id} className="stream-item">
              <div className="trending-item" onClick={() => {
                // 有点开情报时展开，否则打开文章
                if (hasRelated) setExpandedId(isExpanded ? null : item.id)
                else onNewsClick(item.id)
              }}>
                <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
                <div className="trending-content">
                  <span className="trending-title">{displayTitle(item, lang)}</span>
                  <span className="trending-meta">
                    <span>{item.source}</span>
                    <span className="trending-meta-dot">·</span>
                    <span>{item.category}</span>
                    {item.heat != null && item.heat > 1 && <><span className="trending-meta-dot">·</span><span>{item.heat} 家媒体</span></>}
                  </span>
                </div>
                {hasRelated && (
                  <ChevronDown size={14} className={`stream-chevron${isExpanded ? ' open' : ''}`} />
                )}
              </div>

              {/* 展开的情报面板 */}
              {isExpanded && related && (
                <div className="stream-expand">
                  {related.signals.slice(0, 1).map(s => (
                    <button key={s.keyword} className="stream-expand-link" onClick={() => onNarrativeClick?.(s.keyword)}>
                      <GitBranch size={12} />
                      <span className="stream-expand-label">关联叙事</span>
                      <span className="stream-expand-value">{s.label}</span>
                      <span className="stream-expand-meta">{s.sourceCount} 信源</span>
                    </button>
                  ))}
                  {related.sectors.slice(0, 1).map(sc => {
                    const maxPlayer = Math.max(1, ...sc.players.map(p => p.count))
                    return (
                      <button key={sc.key} className="stream-expand-link sector" onClick={onSectorClick}>
                        <Radar size={12} />
                        <span className="stream-expand-label">赛道</span>
                        <span className="stream-expand-value">{sc.label}</span>
                        <span className="stream-expand-players">
                          {sc.players.slice(0, 2).map(p => (
                            <span key={p.name} className="stream-expand-player">{p.name}</span>
                          ))}
                        </span>
                      </button>
                    )
                  })}
                  <button className="stream-expand-article" onClick={() => onNewsClick(item.id)}>
                    <ExternalLink size={11} /> 查看原文
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
