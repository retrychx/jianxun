/** Phase 2+3: AI article analysis and category refinement. */

import { extractContent, analyzeWithDeepSeek, batchClassify } from '../analysis/deepseek.js'
import { likeEscape, type Env } from '../helpers.js'
import { loadMemory } from './memory.js'

/** Analyze recent high-score articles with enhanced DeepSeek prompt. */
export async function analyzeNewArticles(env: Env, limit = 10): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 0

  // 学习反馈：从记忆读热门实体（用户点击多），标题命中的文章优先分析
  let hotNames: string[] = []
  try {
    const mem = await loadMemory(env)
    hotNames = Object.entries(mem.entityHeat)
      .filter(([, v]) => v.clicks >= 2)
      .sort(([, a], [, b]) => b.clicks - a.clicks)
      .slice(0, 10)
      .map(([k]) => k)
  } catch {}

  let query: string
  let params: any[]
  if (hotNames.length) {
    const esc = hotNames.map(n => `%${likeEscape(n)}%`)
    const clauses = hotNames.map(() => "(title LIKE ? ESCAPE '\\')").join(' OR ')
    query = `SELECT id, url, title, description FROM news
      WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days')
      ORDER BY CASE WHEN ${clauses} THEN 1 ELSE 0 END DESC, score DESC LIMIT ?`
    params = [...esc, limit]
  } else {
    query = "SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days') ORDER BY score DESC LIMIT ?"
    params = [limit]
  }
  const rows = await env.DB.prepare(query).bind(...params).all<any>()
  let done = 0
  for (const row of (rows.results || [])) {
    await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
    try {
      // RSS description 足够长时跳过全文抓取（节省 6s/article）
      let extracted: string | null = null, pageTitle: string | null = null
      if (!row.description || row.description.length < 100) {
        const result = await extractContent(row.url)
        extracted = result.content
        pageTitle = result.title
      }
      const content = (extracted || row.description || row.title).slice(0, 2000)
      const result = await analyzeWithDeepSeek(row.title, content, apiKey, pageTitle)
      if (result) {
        await env.DB.prepare(
          `UPDATE news SET summary=?, entities=?, sentiment=?, category=?, content=COALESCE(?,content),
           analyzed_at=datetime('now'), analysis_detail=? WHERE id=?`
        ).bind(result.base.summary, JSON.stringify(result.base.entities), JSON.stringify(result.base.sentiment),
          result.base.category || '科技', extracted, JSON.stringify(result.detail), row.id).run()
        done++
      }
    } catch (e: any) { console.error('[analyze] article analysis failed:', e?.message) }
  }
  return done
}

/** DeepSeek batch reclassify low-confidence articles. */
export async function refineCategories(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { refined: 0 }
  const rows = await env.DB.prepare(
    "SELECT id, title FROM news WHERE category = '科技' AND score = 50 AND analyze_attempts > 0 ORDER BY RANDOM() LIMIT 40"
  ).all<any>()
  const batch = (rows.results || []); if (!batch.length) return { refined: 0 }
  let refined = 0
  for (let i = 0; i < batch.length; i += 10) {
    const chunk = batch.slice(i, i + 10)
    try {
      const results = await batchClassify(chunk.map(a => ({ id: a.id, title: a.title })), apiKey)
      for (const r of results) { if (r.index >= 0 && r.index < chunk.length && r.category && chunk[r.index].category !== r.category) { await env.DB.prepare('UPDATE news SET category = ? WHERE id = ?').bind(r.category, chunk[r.index].id).run(); refined++ } }
    } catch (e: any) { console.error('[analyze] article analysis failed:', e?.message) }
  }
  return { refined }
}
