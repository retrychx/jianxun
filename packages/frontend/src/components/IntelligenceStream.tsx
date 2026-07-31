import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, Flame, Activity, Radar, ChevronRight, GitBranch } from 'lucide-react'
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

// 从文章实体中提取名称（小写集合）
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
  // 也把标题纳入匹配
  if (item.title) names.push(item.title.toLowerCase())
  return names
}

export function IntelligenceStream({ items, lang = 'zh', onNewsClick, onNarrativeClick, onSectorClick }: Props) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])

  useEffect(() => {
    fetch('/api/news/signals').then(r => r.json()).then(d => {
      if (d.risingNarratives) setSignals(d.risingNarratives.slice(0, 6))
    }).catch(() => {})
    fetch('/api/news/sectors').then(r => r.json()).then(d => {
      if (d.sectors) setSectors(d.sectors.slice(0, 4))
    }).catch(() => {})
  }, [])

  // 为每篇文章计算关联信号和赛道（基于实体/标题匹配）
  const stream = useMemo(() => {
    return items.slice(0, 10).map(item => {
      const names = articleEntityNames(item)

      // 匹配信号：叙事标签含文章实体名 或 文章实体含叙事标签词
      const relatedSignals = signals.filter(s => {
        const label = s.label.toLowerCase()
        return names.some(n => label.includes(n) || n.includes(label))
      })

      // 匹配赛道：赛道关键词命中文章标题/实体
      const relatedSectors = sectors.filter(sc => {
        const text = names.join(' ')
        return sc.players.some(p => text.includes(p.name.toLowerCase()))
      })

      return { item, relatedSignals, relatedSectors }
    })
  }, [items, signals, sectors])

  if (!stream.length) return null

  return (
    <div className="trending-panel">
      <div className="panel-header">
        <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
        <span className="panel-title">情报流</span>
        <span className="panel-subtitle">热文 · 关联叙事 · 赛道</span>
      </div>
      <div className="stream-list">
        {stream.map(({ item, relatedSignals, relatedSectors }, i) => (
          <div key={item.id} className="stream-block">
            {/* 热文行 */}
            <div className="trending-item" onClick={() => onNewsClick(item.id)}>
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
            </div>

            {/* 关联叙事 + 赛道 */}
            {(relatedSignals.length > 0 || relatedSectors.length > 0) && (
              <div className="stream-links">
                {relatedSignals.slice(0, 1).map(s => (
                  <button key={s.keyword} className="stream-link" onClick={() => onNarrativeClick?.(s.keyword)}>
                    <GitBranch size={11} />
                    <span>关联叙事：{s.label}</span>
                    <span className="stream-link-meta">{s.sourceCount} 信源</span>
                  </button>
                ))}
                {relatedSectors.slice(0, 1).map(sc => (
                  <button key={sc.key} className="stream-link sector" onClick={onSectorClick}>
                    <Radar size={11} />
                    <span>赛道：{sc.label}</span>
                    <ChevronRight size={11} className="stream-link-arrow" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
