/** Phase 8: Breaking news detection. */

import { signalEvent } from '../cache.js'
import type { Env } from '../helpers.js'

export async function detectBreakingNews(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, source, analysis_detail FROM news
     WHERE analyzed_at >= datetime('now', '-6 hours') AND analysis_detail IS NOT NULL
     ORDER BY score DESC LIMIT 30`
  ).all<any>()
  const articles = (rows.results || [])
  const highSig: any[] = []
  for (const a of articles) {
    try { const d = JSON.parse(a.analysis_detail); if (d.impact === 'high' || d.significance) highSig.push({ ...a, _detail: d }) } catch (e: any) { console.error('[breaking] narrative insert failed:', e?.message) }
  }
  if (highSig.length < 2) return { breaking: 0 }

  const groups = new Map<string, any[]>()
  for (const a of highSig) {
    const key = (a.title || '').slice(0,30).toLowerCase().replace(/[^\w一-鿿]/g,'')
    if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(a)
  }

  let brokeCount = 0
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const sources = [...new Set(group.map((a: any) => a.source))]
    if (sources.length < 2) continue
    // 去重前缀必须与入库 keyword 的前缀长度一致（同为 40 字符）。
    // 若此处取 30、入库取 40，前 30 字符相同但 31-40 不同的突发事件会被误判为重复。
    const titlePrefix = group[0].title.slice(0,40).replace(/[%_\\]/g, '\\$&')
    const existing = await env.DB.prepare("SELECT id FROM narratives WHERE keyword LIKE ? ESCAPE '\\' AND status='active' LIMIT 1").bind(`__breaking__${titlePrefix}%`).first<any>()
    if (existing) continue

    const keyword = `__breaking__${group[0].title.slice(0,40)}`
    const summary = group.map((a: any) => a._detail?.significance || '').filter(Boolean).join('；').slice(0,300)
    const ids = group.map((a: any) => a.id)

    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
         VALUES (?,?,date('now'),datetime('now'),'active',?,'[]',?,?)`
      ).bind(keyword, `🔴 突发: ${group[0].title.slice(0,40)}`, summary||`${sources.join('/')} 同时报道该事件`, JSON.stringify(ids), JSON.stringify(Object.fromEntries(sources.map(s=>[s, group.filter((a:any)=>a.source===s).length])))).run()
      signalEvent('breaking', { title: group[0].title.slice(0,80), sources, significance: summary.slice(0,100), articleCount: group.length }).catch(() => {})
      brokeCount++
    } catch (e: any) { console.error('[breaking] narrative insert failed:', e?.message) }
  }
  return { breaking: brokeCount }
}
