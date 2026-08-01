import { useEffect, useState } from 'react'
import { Radar } from 'lucide-react'
import { SectorCard, type Sector } from './SectorCard'

export function SectorsView() {
  const [sectors, setSectors] = useState<Sector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true); setError(false)
    fetch('/api/news/sectors').then(r => r.json()).then(d => {
      if (d.sectors) setSectors(d.sectors)
    }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading) return (
    <div className="sectors-view">
      <div className="nv-header"><h2 className="nv-title">行业雷达</h2></div>
      {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 120, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  return (
    <div className="sectors-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">行业雷达</h2>
          <p className="nv-subtitle">7 天内科技赛道的竞争格局与热度走势</p>
        </div>
      </div>

      {error ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <p>赛道数据加载失败</p>
          <button className="load-more" onClick={load} style={{ marginTop: 12 }}>重试</button>
        </div>
      ) : sectors.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <Radar size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>暂无赛道数据</p>
        </div>
      ) : (
        sectors.map(s => <SectorCard key={s.key} sector={s} />)
      )}
    </div>
  )
}
