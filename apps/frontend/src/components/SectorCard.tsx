interface SectorPlayer {
  name: string
  count: number
}

interface SectorHeat {
  date: string
  count: number
}

export interface Sector {
  key: string
  label: string
  articleCount: number
  sourceCount: number
  players: SectorPlayer[]
  heatTrend: SectorHeat[]
}

// 赛道卡片：NarrativesView 与 SectorsView 共用（原两份重复 JSX）
export function SectorCard({ sector }: { sector: Sector }) {
  const maxPlayer = Math.max(1, ...sector.players.map(p => p.count))
  const maxHeat = Math.max(1, ...sector.heatTrend.map(h => h.count))
  return (
    <div className="sector-card">
      <div className="sector-head">
        <span className="sector-label">{sector.label}</span>
        <span className="sector-meta">{sector.articleCount} 篇 · {sector.sourceCount} 个信源</span>
      </div>

      {/* 玩家分布 */}
      <div className="sector-players">
        {sector.players.map(p => (
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
      {sector.heatTrend.length > 1 && (
        <div className="sector-heat">
          {sector.heatTrend.map(h => (
            <div key={h.date} className="sector-heat-col" title={`${h.date}: ${h.count}篇`}>
              <div className="sector-heat-bar" style={{ height: `${(h.count / maxHeat) * 100}%` }} />
            </div>
          ))}
          <span className="sector-heat-days">
            {sector.heatTrend[0]?.date} ~ {sector.heatTrend[sector.heatTrend.length - 1]?.date}
          </span>
        </div>
      )}
    </div>
  )
}
