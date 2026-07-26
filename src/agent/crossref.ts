/** Phase 5: Cross-source article comparison. */

import { crossRefAnalysis as deepseekCrossRef } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

export async function runCrossRefAnalysis(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { crossRefs: 0 }
  const rows = await env.DB.prepare(
    `SELECT id, title, title_norm, summary, source FROM news
     WHERE analyzed_at >= datetime('now', '-2 days') AND title_norm IS NOT NULL
     ORDER BY title_norm, score DESC`
  ).all<any>()
  const articles = (rows.results || []); if (articles.length < 4) return { crossRefs: 0 }

  const groups = new Map<string, any[]>()
  for (const a of articles) { const key = a.title_norm || a.title; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(a) }

  const multi: { source: string; title: string; summary: string }[][] = []
  for (const [, group] of groups) {
    const us = [...new Set(group.map((a: any) => a.source))]
    if (us.length >= 2) multi.push(group.map((a: any) => ({ source: a.source, title: a.title, summary: a.summary || '' })))
  }
  if (!multi.length) return { crossRefs: 0 }

  const results = await deepseekCrossRef(multi.slice(0,5), apiKey)
  if (!results) return { crossRefs: 0 }

  let stored = 0
  for (const ref of results) {
    const keyword = `__cross__${ref.keyword.slice(0,40)}`
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
         VALUES (?,?,date('now'),datetime('now'),'active',?,?,?,?)`
      ).bind(keyword, `📍 ${ref.keyword}`, ref.comparison.slice(0,300),
        JSON.stringify([{date:new Date().toISOString().slice(0,10),text:ref.comparison,articleCount:ref.sources.length,sources:ref.sources.map(s=>s.name)}]),
        JSON.stringify(ref.articleIds), JSON.stringify(Object.fromEntries(ref.sources.map(s=>[s.name,1])))).run()
      stored++
    } catch {}
  }
  return { crossRefs: stored }
}
