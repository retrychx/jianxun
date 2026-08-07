/** Phase 4: English→Chinese batch translation. */

import { translateBatch } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

export async function translateMissing(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { translated: 0 }
  const rows = await env.DB.prepare(
    "SELECT id, title, summary, description FROM news WHERE lang = 'en' AND title_zh IS NULL ORDER BY score DESC LIMIT 10"
  ).all<any>()
  if (!rows.results?.length) return { translated: 0 }
  const translated = await translateBatch(
    (rows.results as any[]).map(r => ({ id: r.id, title: r.title, summary: r.summary || r.description || '' })), apiKey
  )
  if (!translated) return { translated: 0 }
  let n = 0
  for (const t of translated) {
    await env.DB.prepare('UPDATE news SET title_zh = ?, summary_zh = ? WHERE id = ?').bind(t.title_zh, t.summary_zh || null, t.id).run(); n++
  }
  return { translated: n }
}
