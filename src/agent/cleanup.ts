/**
 * 数据清理 + 系统健康度 — agent 周期性维护
 * 注意：不删除 articles（agent 训练数据 + 叙事引用）
 * 只清理 signals（增长最快）和深度归档叙事
 */
import type { Env } from '../helpers.js'
import { cacheDelete } from '../cache.js'

export async function cleanup(env: Env): Promise<{ archivedNarratives: number; deletedSignals: number }> {
  const result = { archivedNarratives: 0, deletedSignals: 0 }

  // 归档 30 天无更新的叙事（标记为 archived，数据保留）
  try {
    const arch = await env.DB.prepare(
      "UPDATE narratives SET status = 'archived' WHERE status = 'stale' AND last_updated < datetime('now', '-30 days')"
    ).run()
    result.archivedNarratives = arch.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] archive narratives:', e?.message) }

  // 清理 14 天前的信号（增长最快的数据，14天足够分析趋势）
  try {
    const sig = await env.DB.prepare(
      "DELETE FROM signals WHERE created_at < datetime('now', '-14 days')"
    ).run()
    result.deletedSignals = sig.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] delete signals:', e?.message) }

  cacheDelete('weekly').catch(() => {})

  return result
}

export async function systemHealth(env: Env): Promise<any> {
  const [articleCount, narrCount, signalCount, lastRun, errorCount] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM news").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM narratives WHERE status='active'").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM signals").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key='last_run'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key='agent_errors'").first<any>(),
  ])

  const errors = errorCount?.value ? (() => { try { return JSON.parse(errorCount.value) } catch { return [] } })() : []

  return {
    status: 'ok',
    articles: articleCount?.c || 0,
    activeNarratives: narrCount?.c || 0,
    totalSignals: signalCount?.c || 0,
    lastRun: lastRun?.value || null,
    recentErrors: (Array.isArray(errors) ? errors.slice(-5) : []),
  }
}

export async function recordError(env: Env, source: string, message: string): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key='agent_errors'").first<any>()
    const errors: any[] = row?.value ? JSON.parse(row.value) : []
    errors.push({ ts: new Date().toISOString(), source, message: message.slice(0, 200) })
    if (errors.length > 50) errors.splice(0, errors.length - 50)
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('agent_errors', ?)").bind(JSON.stringify(errors)).run()
  } catch {}
}
