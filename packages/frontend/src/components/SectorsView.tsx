import { useEffect, useState } from 'react'
import { Radar, Newspaper, TrendingUp } from 'lucide-react'

interface Sector {
  key: string
  label: string
  articleCount: number
  sourceCount: number
  players: { name: string; count: number }[]
  heatTrend: { date: string; count: number }[]
}

export function SectorsView() {
  const [sectors, setSectors] = useState<Sector[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/news/sectors').then(r => r.json()).then(d => {
      if (d.sectors) setSectors(d.sectors)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="sectors-view">
      <div className="nv-header"><h2 className="nv-title">行业雷达</h2></div>
      {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 120, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  const maxPlayer = Math.max(1, ...sectors.flatMap(s => s.players.map(p => p.count)))
  const maxHeat = Math.max(1, ...sectors.flatMap(s => s.heatTrend.map(h => h.count)))

  return (
    <div className="sectors-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">行业雷达</h2>
          <p className="nv-subtitle">7 天内科技赛道的竞争格局与热度走势</p>
        </div>
      </div>

      {sectors.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <Radar size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>暂无赛道数据</p>
        </div>
      ) : (
        sectors.map(s => (
          <div key={s.key} className="sector-card">
            <div className="sector-head">
              <span className="sector-label">{s.label}</span>
              <span className="sector-meta">{s.articleCount} 篇 · {s.sourceCount} 个信源</span>
            </div>

            {/* 玩家分布 */}
            <div className="sector-players">
              {s.players.map(p => (
                <div key={p.name} className="sector-player">
                  <span className="sector-player-name">{p.name}</span>
                  <span className="sector-player-bar">
                    <span className="sector-player-fill" style={{ width: `${(p.count / maxPlayer) * 100}%` }} />
                  </span>
                  <span className="sector-player-count">{p.count}</span>
                </div>
              ))}
            </div>

            {/* 热度走势 */}
            {s.heatTrend.length > 1 && (
              <div className="sector-heat">
                {s.heatTrend.map(h => (
                  <div key={h.date} className="sector-heat-col" title={`${h.date}: ${h.count}篇`}>
                    <div className="sector-heat-bar" style={{ height: `${(h.count / maxHeat) * 100}%` }} />
                  </div>
                ))}
                <span className="sector-heat-days">
                  {s.heatTrend[0]?.date} ~ {s.heatTrend[s.heatTrend.length - 1]?.date}
                </span>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
