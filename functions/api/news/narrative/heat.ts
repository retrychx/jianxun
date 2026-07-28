// GET /api/news/narrative/heat — 叙事热度 + 升温检测
import { json } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  const { env } = context

  // 所有活跃叙事，按最后更新时间排序
  const rows: any = await env.DB.prepare(`
    SELECT keyword, label, last_updated, first_seen, article_ids, developments, source_stats
    FROM narratives WHERE status = 'active'
    ORDER BY last_updated DESC LIMIT 30
  `).all()
  const narratives = ((rows.results || []) as any[]).map(n => {
    const ids: number[] = (() => { try { return JSON.parse(n.article_ids || '[]') } catch { return [] } })()
    const devs: any[] = (() => { try { return JSON.parse(n.developments || '[]') } catch { return [] } })()
    const srcs: Record<string, number> = (() => { try { return JSON.parse(n.source_stats || '{}') } catch { return {} } })()
    const daysRunning = Math.max(1, Math.round((Date.now() - new Date(n.first_seen).getTime()) / 86400000))
    const hoursSinceUpdate = Math.round((Date.now() - new Date(n.last_updated).getTime()) / 3600000)
    // 热度 = 信源数 × 0.4 + 进展数 × 0.3 + 文章数 × 0.2 + (24 - 小时数) × 0.1
    const heatScore = Math.round(
      Object.keys(srcs).length * 0.4 +
      devs.length * 0.3 +
      ids.length * 0.2 +
      Math.max(0, 24 - hoursSinceUpdate) * 0.1
    )
    return {
      keyword: n.keyword,
      label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
      heat: heatScore,
      articleCount: ids.length,
      developmentCount: devs.length,
      sourceCount: Object.keys(srcs).length,
      daysRunning,
      hoursSinceUpdate,
    }
  })

  // 升温最快：最近更新的排前面
  const heating = [...narratives].sort((a, b) => b.hoursSinceUpdate - a.hoursSinceUpdate ? a.hoursSinceUpdate - b.hoursSinceUpdate : b.heat - a.heat).slice(0, 8)
  const hottest = [...narratives].sort((a, b) => b.heat - a.heat).slice(0, 8)

  return json({ heating, hottest, total: narratives.length })
}
