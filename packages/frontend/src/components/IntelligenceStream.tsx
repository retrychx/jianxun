import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, Flame, Activity, Radar, ChevronRight } from 'lucide-react'
import type { NewsItem } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  items: NewsItem[]
  lang?: Lang
  onNewsClick: (id: number) => void
  onNarrativeClick?: (keyword: string) => void
  onSectorClick?: () => void
}

interface Signal { keyword: string; label: string; heat: number; sourceCount: number; articleCount: number }
interface HotNarr { keyword: string; label: string; sourceCount: number; articleCount: number }
interface Sector { key: string; label: string; articleCount: number; players: { name: string; count: number }[] }

type StreamItem =
  | { type: 'article'; id: number; title: string; source: string; category: string; heat: number; raw: NewsItem }
  | { type: 'signal'; keyword: string; label: string; sourceCount: number; articleCount: number }
  | { type: 'story'; keyword: string; label: string; sourceCount: number; articleCount: number }
  | { type: 'sector'; key: string; label: string; articleCount: number; players: { name: string; count: number }[] }

export function IntelligenceStream({ items, lang = 'zh', onNewsClick, onNarrativeClick, onSectorClick }: Props) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [hotNarrs, setHotNarrs] = useState<HotNarr[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])

  useEffect(() => {
    fetch('/api/news/signals').then(r => r.json()).then(d => {
      if (d.risingNarratives) setSignals(d.risingNarratives.slice(0, 4))
    }).catch(() => {})
    fetch('/api/news/narrative/heat').then(r => r.json()).then(d => {
      if (d.hottest) setHotNarrs(d.hottest.slice(0, 4))
    }).catch(() => {})
    fetch('/api/news/sectors').then(r => r.json()).then(d => {
      if (d.sectors) setSectors(d.sectors.slice(0, 3))
    }).catch(() => {})
  }, [])

  // 合并成统一情报流
  const stream = useMemo<StreamItem[]>(() => {
    const result: StreamItem[] = []
    const articles = items.slice(0, 10)

    // 交错插入信号/故事/赛道
    let sigIdx = 0, narrIdx = 0, secIdx = 0
    for (let i = 0; i < articles.length; i++) {
      result.push({ type: 'article', id: articles[i].id, title: articles[i].title, source: articles[i].source, category: articles[i].category, heat: articles[i].heat || 1, raw: articles[i] })
      // 每隔 2 篇文章插一个信号
      if ((i + 1) % 2 === 0 && sigIdx < signals.length) {
        const s = signals[sigIdx++]
        result.push({ type: 'signal', keyword: s.keyword, label: s.label, sourceCount: s.sourceCount, articleCount: s.articleCount })
      }
      // 每隔 3 篇文章插一个故事
      if ((i + 1) % 3 === 0 && narrIdx < hotNarrs.length) {
        const n = hotNarrs[narrIdx++]
        result.push({ type: 'story', keyword: n.keyword, label: n.label, sourceCount: n.sourceCount, articleCount: n.articleCount })
      }
      // 每隔 5 篇文章插一个赛道
      if ((i + 1) % 5 === 0 && secIdx < sectors.length) {
        const sc = sectors[secIdx++]
        result.push({ type: 'sector', key: sc.key, label: sc.label, articleCount: sc.articleCount, players: sc.players })
      }
    }
    // 剩余的补充到末尾
    while (sigIdx < signals.length) {
      const s = signals[sigIdx++]
      result.push({ type: 'signal', keyword: s.keyword, label: s.label, sourceCount: s.sourceCount, articleCount: s.articleCount })
    }
    while (narrIdx < hotNarrs.length) {
      const n = hotNarrs[narrIdx++]
      result.push({ type: 'story', keyword: n.keyword, label: n.label, sourceCount: n.sourceCount, articleCount: n.articleCount })
    }
    while (secIdx < sectors.length) {
      const sc = sectors[secIdx++]
      result.push({ type: 'sector', key: sc.key, label: sc.label, articleCount: sc.articleCount, players: sc.players })
    }
    return result
  }, [items, signals, hotNarrs, sectors])

  if (!stream.length) return null

  return (
    <div className="trending-panel">
      <div className="panel-header">
        <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
        <span className="panel-title">情报流</span>
        <span className="panel-subtitle">热文 · 信号 · 故事 · 赛道</span>
      </div>
      <div className="stream-list">
        {stream.map((item, i) => {
          if (item.type === 'article') {
            return (
              <div key={`a${item.id}`} className="trending-item" onClick={() => onNewsClick(item.id)}>
                <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
                <div className="trending-content">
                  <span className="trending-title">{displayTitle(item.raw, lang)}</span>
                  <span className="trending-meta">
                    <span>{item.source}</span>
                    <span className="trending-meta-dot">·</span>
                    <span>{item.category}</span>
                    {item.heat > 1 && <><span className="trending-meta-dot">·</span><span>{item.heat} 家媒体</span></>}
                  </span>
                </div>
              </div>
            )
          }
          if (item.type === 'signal') {
            return (
              <div key={`s${item.keyword}`} className="signal-card rising" onClick={() => onNarrativeClick?.(item.keyword)} style={{ cursor: onNarrativeClick ? 'pointer' : 'default' }}>
                <div className="signal-head">
                  <span className="signal-arrow up"><Activity size={13} /></span>
                  <span className="signal-tag">信号</span>
                  <span className="signal-label">{item.label}</span>
                </div>
                <div className="signal-meta"><span>{item.sourceCount} 个信源</span><span>{item.articleCount} 篇</span></div>
              </div>
            )
          }
          if (item.type === 'story') {
            return (
              <div key={`n${item.keyword}`} className="signal-card" onClick={() => onNarrativeClick?.(item.keyword)} style={{ cursor: onNarrativeClick ? 'pointer' : 'default' }}>
                <div className="signal-head">
                  <span className="signal-tag story"><Flame size={13} /></span>
                  <span className="signal-label">{item.label}</span>
                </div>
                <div className="signal-meta"><span>{item.sourceCount} 个信源</span><span>{item.articleCount} 篇</span></div>
              </div>
            )
          }
          // sector
          const maxPlayer = Math.max(1, ...item.players.map(p => p.count))
          return (
            <div key={`sc${item.key}`} className="signal-card sector" onClick={onSectorClick} style={{ cursor: onSectorClick ? 'pointer' : 'default' }}>
              <div className="signal-head">
                <span className="signal-tag sector-tag"><Radar size={13} /></span>
                <span className="signal-label">{item.label} <ChevronRight size={12} style={{ opacity: .4 }} /></span>
              </div>
              <div className="sector-mini-players">
                {item.players.slice(0, 3).map(p => (
                  <span key={p.name} className="sector-mini-player">
                    <span className="sector-mini-player-name">{p.name}</span>
                    <span className="sector-mini-player-bar"><span style={{ width: `${(p.count / maxPlayer) * 100}%` }} /></span>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
