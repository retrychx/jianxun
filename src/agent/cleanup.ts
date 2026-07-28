/**
 * 数据清理 + 系统健康度 — agent 周期性维护
 */
import type { Env } from '../helpers.js'
import { cacheDelete } from '../cache.js'

/** 清理过期数据：30 天前的文章 + 14 天前的叙事 + 7 天前的信号 */
export async function cleanup(env: Env): Promise<{ deletedArticles: number; archivedNarratives: number; deletedSignals: number }> {
  const result = { deletedArticles: 0, archivedNarratives: 0, deletedSignals: 0 }

  // 清理 30 天前的旧文章
  try {
    const del = await env.DB.prepare(
      "DELETE FROM news WHERE created_at < datetime('now', '-30 days')"
    ).run()
    result.deletedArticles = del.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] delete articles:', e?.message) }

  // 归档 14 天无更新的叙事
  try {
    const arch = await env.DB.prepare(
      "UPDATE narratives SET status = 'archived' WHERE status = 'stale' AND last_updated < datetime('now', '-14 days')"
    ).run()
    result.archivedNarratives = arch.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] archive narratives:', e?.message) }

  // 清理 7 天前的信号
  try {
    const sig = await env.DB.prepare(
      "DELETE FROM signals WHERE created_at < datetime('now', '-7 days')"
    ).run()
    result.deletedSignals = sig.meta.changes || 0
  } catch (e: any) { console.error('[cleanup] delete signals:', e?.message) }

  // 清理缓存
  cacheDelete('weekly').catch(() => {})

  return result
}

/** 系统健康检查 */
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

/** 记录系统错误 */
export async function recordError(env: Env, source: string, message: string): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key='agent_errors'").first<any>()
    const errors: any[] = row?.value ? JSON.parse(row.value) : []
    errors.push({ ts: new Date().toISOString(), source, message: message.slice(0, 200) })
    if (errors.length > 50) errors.splice(0, errors.length - 50)
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('agent_errors', ?)").bind(JSON.stringify(errors)).run()
  } catch {}
}
