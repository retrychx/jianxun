// GET /api/news/briefing/updates — 今日叙事动态 + 升温实体
import { json } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  const { env } = context

  // 今日有更新的叙事
  const narrRows = await env.DB.prepare(`
    SELECT keyword, label, last_updated, article_ids, source_stats, summary
    FROM narratives
    WHERE status = 'active' AND last_updated >= datetime('now', '-24 hours')
    ORDER BY last_updated DESC LIMIT 10
  `).all<any>()
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

  // 升温实体：今日提及增长最快的实体
  const entityToday = await env.DB.prepare(`
    SELECT source as entity, COUNT(*) as cnt FROM news
    WHERE entities IS NOT NULL AND created_at >= datetime('now', '-1 day')
    GROUP BY source ORDER BY cnt DESC LIMIT 5
  `).all<any>()
  const risingSources = ((entityToday.results || []) as any[]).map(r => ({ name: r.entity, count: r.cnt }))

  return json({ updatedNarratives, risingSources })
}
