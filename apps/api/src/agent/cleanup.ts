/**
 * 数据清理 + 系统健康度 — agent 周期性维护
 * 注意：不删除 articles（agent 训练数据 + 叙事引用）
 * 只清理 signals（增长最快）和深度归档叙事
 */
import { decodeHtml, type Env } from '../helpers.js'
import { cacheDelete } from '../cache.js'
import { CONFIG } from './config.js'
import { META, metaGet, metaGetJSON, metaSetJSON } from '../db.js'

export async function cleanup(env: Env): Promise<{ archivedNarratives: number; deletedSignals: number }> {
  const result = { archivedNarratives: 0, deletedSignals: 0 }

  // 归档长期无更新的叙事（阈值与 CONFIG.narrative.archiveDays 一致，避免多套数字漂移）
  try {
    const arch = await env.DB.prepare(
      "UPDATE narratives SET status = 'archived' WHERE status = 'stale' AND last_updated < datetime('now', ?)"
    ).bind(`-${CONFIG.narrative.archiveDays} days`).run()
    result.archivedNarratives = arch.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] archive narratives:', e?.message) }

  // 清理 14 天前的信号（增长最快的数据，14天足够分析趋势）
  try {
    const sig = await env.DB.prepare(
      "DELETE FROM signals WHERE created_at < datetime('now', '-14 days')"
    ).run()
    result.deletedSignals = sig.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] delete signals:', e?.message) }

  // 清理限流表的过期行（rateLimit 只计数不删除，避免无限增长）
  try {
    await env.DB.prepare(
      "DELETE FROM rate_limits WHERE created_at < datetime('now', '-2 days')"
    ).run()
  } catch (e: any) { console.error('[cleanup] delete rate_limits:', e?.message) }

  // 解码历史遗留的 HTML 实体（RSS 解码修复前存下的 &#8217; 等，分批处理）
  try { await cleanupEntities(env) } catch (e: any) { console.error('[cleanup] entities:', e?.message) }

  cacheDelete('weekly').catch(() => {})

  return result
}

/** 分批解码 news / narratives 里的 HTML 实体，清理历史遗留数据 */
export async function cleanupEntities(env: Env): Promise<number> {
  let fixed = 0
  const newsRows = await env.DB.prepare(
    "SELECT id, title, description, summary FROM news WHERE title LIKE '%&#%' OR description LIKE '%&#%' OR summary LIKE '%&#%' LIMIT 200",
  ).all<any>()
  for (const r of (newsRows.results || [])) {
    await env.DB.prepare('UPDATE news SET title=?, description=?, summary=? WHERE id=?')
      .bind(r.title ? decodeHtml(r.title) : null, r.description ? decodeHtml(r.description) : null, r.summary ? decodeHtml(r.summary) : null, r.id).run()
    fixed++
  }
  const narrRows = await env.DB.prepare(
    "SELECT id, label, keyword, summary, developments FROM narratives WHERE label LIKE '%&#%' OR keyword LIKE '%&#%' OR summary LIKE '%&#%' OR developments LIKE '%&#%' LIMIT 100",
  ).all<any>()
  for (const r of (narrRows.results || [])) {
    await env.DB.prepare('UPDATE narratives SET label=?, summary=?, developments=? WHERE id=?')
      .bind(r.label ? decodeHtml(r.label) : null, r.summary ? decodeHtml(r.summary) : null, r.developments ? decodeHtml(r.developments) : r.developments, r.id).run()
    fixed++
  }
  return fixed
}

export async function systemHealth(env: Env): Promise<any> {
  const [articleCount, narrCount, signalCount, lastRun, errorCount] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM news").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM narratives WHERE status='active'").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM signals").first<any>(),
    metaGet(env, META.lastRun),
    metaGetJSON<any[]>(env, META.agentErrors),
  ])

  const errors = errorCount ?? []

  return {
    status: 'ok',
    articles: articleCount?.c || 0,
    activeNarratives: narrCount?.c || 0,
    totalSignals: signalCount?.c || 0,
    lastRun,
    recentErrors: (Array.isArray(errors) ? errors.slice(-5) : []),
  }
}

export async function recordError(env: Env, source: string, message: string): Promise<void> {
  try {
    const errors: any[] = (await metaGetJSON(env, META.agentErrors)) ?? []
    errors.push({ ts: new Date().toISOString(), source, message: message.slice(0, 200) })
    if (errors.length > 50) errors.splice(0, errors.length - 50)
    await metaSetJSON(env, META.agentErrors, errors)
  } catch {}
}
