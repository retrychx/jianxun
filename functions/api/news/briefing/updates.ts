// GET /api/news/briefing/updates — 今日叙事动态 + 升温实体
import { json, tryCatch } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
  const { env } = context

  // 今日有更新的叙事
  const narrRows: any = await env.DB.prepare(`
    SELECT keyword, label, last_updated, article_ids, source_stats, summary
    FROM narratives
    WHERE status = 'active' AND last_updated >= datetime('now', '-24 hours')
    ORDER BY last_updated DESC LIMIT 10
  `).all()
  const updatedNarratives = ((narrRows.results || []) as any[]).map(n => {
    const ids: number[] = (() => { try { return JSON.parse(n.article_ids || '[]') } catch { return [] } })()
    return {
      keyword: n.keyword,
      label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
      articleCount: ids.length,
      lastUpdated: n.last_updated,
      summary: (n.summary || '').slice(0, 80),
      sourceCount: Object.keys((() => { try { return JSON.parse(n.source_stats || '{}') } catch { return {} } })()).length,
    }
  })

  // 升温实体：今日提及最多的实体（此前误按 source 分组，实际返回的是"高产信源"）
  const entityToday: any = await env.DB.prepare(`
    SELECT entities FROM news
    WHERE entities IS NOT NULL AND entities != '' AND created_at >= datetime('now', '-1 day')
    LIMIT 300
  `).all()
  const entityCount = new Map<string, number>()
  for (const r of (entityToday.results || [])) {
    try {
      const parsed = typeof r.entities === 'string' ? JSON.parse(r.entities) : r.entities
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          const name = e?.name?.trim()
          if (name && name.length >= 2) entityCount.set(name, (entityCount.get(name) || 0) + 1)
        }
      }
    } catch {}
  }
  const risingSources = [...entityCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  return json({ updatedNarratives, risingSources })
  })
}
