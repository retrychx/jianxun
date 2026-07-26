/** Phase 9: Entity linking — canonicalize entity names across articles. */

import type { Env } from '../helpers.js'

export async function linkEntities(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT id, entities FROM news WHERE analyzed_at >= datetime('now', '-12 hours')
     AND entities IS NOT NULL ORDER BY score DESC LIMIT 100`
  ).all<any>()
  if (!rows.results?.length) return { linked: 0 }

  const rawEntities: { name: string; type: string; articleId: number }[] = []
  for (const r of rows.results) {
    try {
      const list = JSON.parse(r.entities)
      if (Array.isArray(list)) for (const e of list) { if (e?.name) rawEntities.push({ name: e.name, type: e.type || 'concept', articleId: r.id }) }
    } catch {}
  }

  const canonical = new Map<string, { canonical: string; type: string }>()
  for (const e of rawEntities) {
    const norm = e.name.toLowerCase().trim()
    if (canonical.has(norm)) continue
    let found = false
    for (const [existing, mapped] of canonical) {
      if (norm.includes(existing) || existing.includes(norm)) { canonical.set(norm, { canonical: mapped.canonical, type: mapped.type || e.type }); found = true; break }
      const tA = new Set(norm.split(/[\s_-]+/)), tB = new Set(existing.split(/[\s_-]+/))
      let inter = 0; for (const t of tA) if (tB.has(t)) inter++
      if (inter / Math.max(tA.size+tB.size-inter,1) >= 0.6 && tA.size > 0 && tB.size > 0) { canonical.set(norm, { canonical: mapped.canonical, type: mapped.type || e.type }); found = true; break }
    }
    if (!found) canonical.set(norm, { canonical: e.name, type: e.type })
  }

  const now = new Date().toISOString()
  for (const [original, mapping] of canonical) {
    try {
      const existing = await env.DB.prepare('SELECT article_count FROM entity_links WHERE original_name = ?').bind(original).first<any>()
      await env.DB.prepare('INSERT OR REPLACE INTO entity_links (original_name, canonical_name, entity_type, last_seen, article_count) VALUES (?,?,?,?,?)')
        .bind(original, mapping.canonical, mapping.type, now, existing ? (existing.article_count||0)+1 : 1).run()
    } catch {}
  }

  for (const articleId of [...new Set(rawEntities.map(e => e.articleId))]) {
    const article = rawEntities.filter(e => e.articleId === articleId)
    const seen = new Set<string>()
    const deduped = article.map(e => ({ name: canonical.get(e.name.toLowerCase().trim())?.canonical || e.name, type: e.type, weight: 0.5 }))
      .filter(e => { const k = e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    if (deduped.length) await env.DB.prepare('UPDATE news SET entities = ? WHERE id = ?').bind(JSON.stringify(deduped), articleId).run()
  }
  return { linked: canonical.size }
}
