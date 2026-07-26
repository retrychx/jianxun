/** Phase 1: Image fixing + Phase 10: Source health auto-tuning. */

import { extractContent } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

/** Fetch OG images for articles that have none. */
export async function fixMissingImages(env: Env) {
  const rows = await env.DB.prepare("SELECT id, url FROM news WHERE image IS NULL LIMIT 3").all()
  let imgFixed = 0
  await Promise.allSettled((rows.results || []).map(async (row: any) => {
    try { const { image } = await extractContent(row.url); if (image) { await env.DB.prepare('UPDATE news SET image = ? WHERE id = ?').bind(image, row.id).run(); imgFixed++ } } catch {}
  }))
  return { imgFixed }
}

/** Auto-adjust source weights based on fetch failure patterns. */
export async function tuneSourceWeights(env: Env) {
  const stats = await env.DB.prepare('SELECT * FROM source_stats').all<any>()
  const rows = (stats.results || []); if (!rows.length) return { tuned: 0 }
  let tuned = 0
  for (const row of rows) {
    const failCount = row.fail_count || 0; const source = row.source
    let newWeight = Math.max(0.1, 1.0 - failCount * 0.1)
    const existing = await env.DB.prepare('SELECT weight FROM source_weights WHERE source = ?').bind(source).first<any>()
    if (existing && Math.abs((existing.weight||1.0) - newWeight) < 0.05) {
      await env.DB.prepare('UPDATE source_weights SET consecutive_failures=?, total_fetches=total_fetches+1, last_adjusted=datetime(\'now\') WHERE source=?').bind(failCount, source).run()
      continue
    }
    await env.DB.prepare(
      `INSERT OR REPLACE INTO source_weights (source,weight,consecutive_failures,total_fetches,last_adjusted)
       VALUES (?,?,?,COALESCE((SELECT total_fetches FROM source_weights WHERE source=?),1),datetime('now'))`
    ).bind(source, newWeight, failCount, source).run()
    if (failCount === 0 && existing && (existing.weight||0.5) < 1.0) {
      await env.DB.prepare('UPDATE source_weights SET weight=? WHERE source=?').bind(Math.min(1.0, (existing.weight||0.5)+0.15), source).run()
    }
    tuned++
  }
  return { tuned }
}
