/** Phase 1: Image fixing + Phase 10: Source health auto-tuning. */

import { extractContent } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

/** Fetch OG images for articles that have none. */
export async function fixMissingImages(env: Env) {
  // image_attempts 防止对同一批抓不到的图反复 fetch（每次尝试 +1，≥3 后不再选入）
  const rows = await env.DB.prepare("SELECT id, url FROM news WHERE image IS NULL AND image_attempts < 3 LIMIT 3").all()
  let imgFixed = 0
  await Promise.allSettled((rows.results || []).map(async (row: any) => {
    try {
      const { image } = await extractContent(row.url)
      await env.DB.prepare('UPDATE news SET image = COALESCE(?, image), image_attempts = image_attempts + 1 WHERE id = ?').bind(image, row.id).run()
      if (image) imgFixed++
    } catch {}
  }))
  return { imgFixed }
}

/** Auto-adjust source weights based on failure patterns + user engagement. */
export async function tuneSourceWeights(env: Env) {
  const stats = await env.DB.prepare('SELECT * FROM source_stats').all<any>()
  const rows = (stats.results || []); if (!rows.length) return { tuned: 0 }
  let tuned = 0

  // 计算每个源的点击率（最近 7 天）
  const ctrRows = await env.DB.prepare(`
    SELECT n.source,
           COUNT(*) as total_articles,
           SUM(n.click_count) as total_clicks
    FROM news n
    WHERE n.created_at >= datetime('now', '-7 days')
    GROUP BY n.source
  `).all<any>()
  const ctrMap = new Map<string, { total: number; clicks: number }>()
  for (const r of (ctrRows.results || [])) {
    ctrMap.set(r.source, { total: r.total_articles || 0, clicks: r.total_clicks || 0 })
  }

  for (const row of rows) {
    const failCount = row.fail_count || 0; const source = row.source
    const existing = await env.DB.prepare('SELECT weight FROM source_weights WHERE source = ?').bind(source).first<any>()
    const baseWeight = existing?.weight ?? 1.0
    // 单次计算权重——此前"失败惩罚→点击率修正→再独立恢复一次"的双调整，
    // 会把低点击源的权重又抬回去（恢复分支覆盖了降权结果）。恢复并进同一计算。
    let newWeight = Math.max(0.1, 1.0 - failCount * 0.1)
    // 失败为 0 的稳定源缓慢恢复（封顶 1.0，基于现有权重判断是否低于 1.0）
    if (failCount === 0 && baseWeight < 1.0) newWeight = Math.min(1.0, newWeight + 0.15)
    // 点击率修正：高于平均的源加权
    const sig = ctrMap.get(source)
    if (sig && sig.total > 0) {
      const ctr = sig.clicks / sig.total
      if (ctr > 0.5) newWeight = Math.min(1.5, newWeight + 0.15)   // 高点击 → 加权
      else if (ctr < 0.05) newWeight = Math.max(0.1, newWeight - 0.1)  // 低点击 → 降权
    }
    if (existing && Math.abs((existing.weight||1.0) - newWeight) < 0.05) {
      await env.DB.prepare('UPDATE source_weights SET consecutive_failures=?, total_fetches=total_fetches+1, last_adjusted=datetime(\'now\') WHERE source=?').bind(failCount, source).run()
      continue
    }
    await env.DB.prepare(
      `INSERT OR REPLACE INTO source_weights (source,weight,consecutive_failures,total_fetches,last_adjusted)
       VALUES (?,?,?,COALESCE((SELECT total_fetches FROM source_weights WHERE source=?),1),datetime('now'))`
    ).bind(source, newWeight, failCount, source).run()
    tuned++
  }
  return { tuned }
}
