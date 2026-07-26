import { useEffect, useState } from 'react'
import { Rss } from 'lucide-react'
import type { SourceHealth } from '../api'
import { getSources } from '../api'
import { formatDate } from '../utils'

export function SourcesView() {
  const [items, setItems] = useState<SourceHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSources()
      .then(res => { if (!cancelled) setItems(Array.isArray(res.items) ? res.items : []) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const sorted = [...items].sort((a, b) => (b.today ?? 0) - (a.today ?? 0))

  return (
    <div className="sources-view">
      <div className="briefing-header">
        <div className="briefing-title-row">
          <Rss size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <h2 className="briefing-title">信源健康度</h2>
        </div>
        {!loading && !error && <p className="briefing-subtitle">{sorted.length} 个信源 · 按今日产量排序</p>}
      </div>
      {loading ? (
        <div className="loading">加载中...</div>
      ) : error ? (
        <div className="empty">
          <Rss size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>加载失败，请稍后重试</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <Rss size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无信源数据</p>
        </div>
      ) : (
        <div className="sources-table-wrap">
          <table className="sources-table">
            <thead>
              <tr>
                <th>信源</th>
                <th>今日 / 总量</th>
                <th>权重</th>
                <th>最近成功</th>
                <th>最近失败</th>
                <th>失败数</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.name}>
                  <td className="sources-name">{s.name}</td>
                  <td className="sources-num">{s.today ?? 0} / {s.total ?? 0}</td>
                  <td className="sources-num">{s.weight ?? '—'}</td>
                  <td>{s.lastOk ? formatDate(s.lastOk) : '—'}</td>
                  <td>{s.lastError ? formatDate(s.lastError) : '—'}</td>
                  <td className={`sources-num${s.failCount > 0 ? ' sources-fail' : ''}`}>{s.failCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
