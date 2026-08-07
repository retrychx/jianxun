/** Phase: pre-generate research briefs for hot topics — agent-processed, user-instant. */

import { generateResearchReport } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

/** Pre-compute research for top active narratives. Stores as __research__ in narratives. */
export async function generateResearchBriefs(env: Env, signal?: AbortSignal) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { briefs: 0 }

  // Pick top narratives that aren't already researched
  const narratives = await env.DB.prepare(
    `SELECT keyword, label, summary, article_ids FROM narratives
     WHERE status = 'active' AND keyword NOT GLOB '__*'
     ORDER BY json_array_length(article_ids) DESC LIMIT 5`
  ).all<any>()
  if (!narratives.results?.length) return { briefs: 0 }

  let briefs = 0
  for (const n of (narratives.results as any[])) {
    const researchKey = `__research__${n.keyword.slice(0, 40)}`

    // Skip if already researched recently
    const existing = await env.DB.prepare(
      "SELECT last_updated FROM narratives WHERE keyword = ? AND last_updated > datetime('now', '-24 hours')"
    ).bind(researchKey).first<any>()
    if (existing) continue

    // Get article candidates from the narrative
    let ids: number[] = []
    try { ids = JSON.parse(n.article_ids) } catch {}
    if (ids.length < 3) continue

    const rows = await env.DB.prepare(
      `SELECT id, title, title_zh, summary, summary_zh, source, published_at FROM news
       WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY score DESC LIMIT 20`
    ).bind(...ids).all<any>()
    const articles = (rows.results || []).map(a => ({
      id: a.id, title: a.title, titleZh: a.title_zh || null,
      summary: a.summary || '', summaryZh: a.summary_zh || null,
      source: a.source, publishedAt: a.published_at,
    }))
    if (articles.length < 3) continue

    const report = await generateResearchReport(n.label || n.keyword, articles, apiKey, signal)
    if (!report || !report.sections.length) continue

    const reportText = JSON.stringify(report)
    const devs = JSON.stringify([{
      date: new Date().toISOString().slice(0, 10),
      text: `深度研究：${report.summary}`,
      articleCount: articles.length,
      sources: [...new Set(articles.map(a => a.source))],
    }])

    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
         VALUES (?,?,date('now'),datetime('now'),'active',?,?,?,?)`
      ).bind(researchKey, `📖 研究: ${report.title.slice(0, 40)}`, reportText.slice(0, 300), devs,
        JSON.stringify(ids), JSON.stringify({}),
      ).run()
      briefs++
    } catch {}
  }

  return { briefs }
}
