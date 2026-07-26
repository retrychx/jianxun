/** Phase 2+3: AI article analysis and category refinement. */

import { extractContent, analyzeWithDeepSeek, fetchWithRetry } from '../analysis/deepseek.js'
import { DEEPSEEK_MODEL } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

/** Analyze recent high-score articles with enhanced DeepSeek prompt. */
export async function analyzeNewArticles(env: Env, limit = 6): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 0
  const rows = await env.DB.prepare(
    "SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days') ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<any>()
  let done = 0
  for (const row of (rows.results || [])) {
    await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
    try {
      const { content: extracted, title: pageTitle } = await extractContent(row.url)
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
    } catch {}
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
      const texts = chunk.map((a: any, idx: number) => `[${idx}] ${a.title}`).join('\n')
      const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: '你是新闻分类助手。为每篇新闻分配一个分类：AI/科技/财经/国际/政治/健康/体育/娱乐/游戏/教育/社会。只返回JSON数组：[{"index":0,"category":"AI"},...]' }, { role: 'user', content: texts }], temperature: 0.05, max_tokens: 1024 }),
      })
      if (!res?.ok) continue
      const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) continue
      const results = JSON.parse(raw) as { index: number; category: string }[]
      for (const r of results) { if (r.index >= 0 && r.index < chunk.length && r.category && chunk[r.index].category !== r.category) { await env.DB.prepare('UPDATE news SET category = ? WHERE id = ?').bind(r.category, chunk[r.index].id).run(); refined++ } }
    } catch {}
  }
  return { refined }
}
