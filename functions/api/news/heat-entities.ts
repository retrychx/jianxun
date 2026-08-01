// GET /api/news/heat-entities — 近 7 天点击最多的实体（供前端 feed 个性化加权）
import { json, tryCatch } from '../../../src/handler'
import { cacheGet, cacheSet, CACHE_TTL } from '../../../src/cache.js'

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
    const { env } = context
    const cached = await cacheGet<any>('heat_entities')
    if (cached) return json(cached)

    const rows: any = await env.DB.prepare(`
      SELECT target_id, COUNT(*) as cnt FROM signals
      WHERE target_type = 'entity' AND created_at >= datetime('now', '-7 days')
      GROUP BY target_id ORDER BY cnt DESC LIMIT 20
    `).all()

    const payload = {
      entities: ((rows.results || []) as any[]).map(r => ({ name: r.target_id, count: r.cnt })),
    }
    await cacheSet('heat_entities', payload, CACHE_TTL.briefing)
    return json(payload)
  })
}
