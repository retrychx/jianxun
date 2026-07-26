import { useEffect, useState } from 'react'
import { ChevronRight, Hash } from 'lucide-react'
import { getByEntity } from '../api'
import type { FollowItem } from '../hooks/useFollow'

interface Props {
  follows: FollowItem[]
  onEntityClick: (name: string) => void
}

interface Row {
  name: string
  count: number
}

// 「本周关注动态」：每个关注实体（≤3 个）近 7 天的报道数，点击进实体视图。
// 数据加载中、无关注实体或全部无报道时都整体隐藏。
export function FollowWeekly({ follows, onEntityClick }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    const entities = follows.filter(f => f.type === 'entity').slice(0, 3)
    if (!entities.length) { setRows(null); return }
    let cancelled = false
    const weekAgo = Date.now() - 7 * 86_400_000
    // entity 接口最多返回 30 条（按热度），本周计数在这个窗口内统计
    Promise.all(entities.map(async f => {
      try {
        const res = await getByEntity(f.name)
        const count = res.items.filter(i => i.publishedAt && new Date(i.publishedAt).getTime() >= weekAgo).length
        return { name: f.name, count }
      } catch {
        return { name: f.name, count: 0 }
      }
    })).then(r => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [follows])

  if (!rows) return null
  const active = rows.filter(r => r.count > 0)
  if (!active.length) return null

  return (
    <div className="bf-section follow-weekly">
      <div className="bf-section-title"><Hash size={13} /> 本周关注动态</div>
      <div className="follow-weekly-list">
        {active.map(r => (
          <button key={r.name} className="follow-weekly-row" onClick={() => onEntityClick(r.name)}>
            <span className="follow-weekly-name">{r.name}</span>
            <span className="follow-weekly-count">本周 {r.count} 条报道</span>
            <ChevronRight size={13} className="follow-weekly-arrow" />
          </button>
        ))}
      </div>
    </div>
  )
}
