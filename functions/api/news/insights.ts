// GET /api/news/insights — 读者统计：点击数据 → 可读洞察
import { json, tryCatch } from '../../../src/handler'
import { cacheGet, cacheSet, CACHE_TTL } from '../../../src/cache.js'

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
    const { env } = context
    const cached = await cacheGet<any>('insights')
    if (cached) return json(cached)

    const [entityRows, srcRows, articleRows, risingRows] = await Promise.all([
      // 近 7 天点击最多的实体
      env.DB.prepare(
        `SELECT target_id, COUNT(*) as cnt FROM signals
         WHERE target_type = 'entity' AND created_at >= datetime('now', '-7 days')
         GROUP BY target_id ORDER BY cnt DESC LIMIT 10`,
      ).all<any>(),
      // 近 7 天点击最多的来源
      env.DB.prepare(
        `SELECT source, SUM(click_count) as clicks FROM news
         WHERE created_at >= datetime('now', '-7 days') AND click_count > 0
         GROUP BY source ORDER BY clicks DESC LIMIT 8`,
      ).all<any>(),
      // 近 7 天点击最多的文章
      env.DB.prepare(
        `SELECT id, title, source, click_count FROM news
         WHERE click_count > 0 AND created_at >= datetime('now', '-7 days')
         ORDER BY click_count DESC, score DESC LIMIT 10`,
      ).all<any>(),
      // 24h 内点击最多的实体（升温）
      env.DB.prepare(
        `SELECT target_id, COUNT(*) as cnt FROM signals
         WHERE target_type = 'entity' AND created_at >= datetime('now', '-1 day')
         GROUP BY target_id ORDER BY cnt DESC LIMIT 8`,
      ).all<any>(),
    ])

    const payload = {
      topEntities: ((entityRows.results || []) as any[]).map(r => ({ name: r.target_id, count: r.cnt })),
      topSources: ((srcRows.results || []) as any[]).map(r => ({ name: r.source, clicks: r.clicks })),
      mostRead: ((articleRows.results || []) as any[]).map(r => ({ id: r.id, title: r.title, source: r.source, clicks: r.click_count })),
      risingEntities: ((risingRows.results || []) as any[]).map(r => ({ name: r.target_id, count: r.cnt })),
    }
    await cacheSet('insights', payload, CACHE_TTL.briefing)
    return json(payload)
  })
}
