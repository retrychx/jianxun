/** Phase 9: Entity linking — canonicalize entity names across articles. */

import type { Env } from '../helpers.js'

export async function linkEntities(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT id, entities FROM news WHERE analyzed_at >= datetime('now', '-12 hours')
     AND entities IS NOT NULL ORDER BY score DESC LIMIT 100`
  ).all<any>()
  if (!rows.results?.length) return { linked: 0 }

  const rawEntities: { name: string; type: string; weight?: number; articleId: number }[] = []
  for (const r of rows.results) {
    try {
      const list = JSON.parse(r.entities)
      if (Array.isArray(list)) for (const e of list) { if (e?.name) rawEntities.push({ name: e.name, type: e.type || 'concept', weight: typeof e.weight === 'number' ? e.weight : undefined, articleId: r.id }) }
    } catch {}
  }

  const canonical = new Map<string, { canonical: string; type: string }>()
  // 先收集去重后的实体名列表，再遍历——避免在 for..of 遍历 canonical 时往里 set 新键
  // （JS Map 迭代会访问迭代期间新增的键，行为微妙且易错）。
  const norms = [...new Set(rawEntities.map(e => e.name.toLowerCase().trim()).filter(Boolean))]
  const typeOf = (norm: string): string => rawEntities.find(e => e.name.toLowerCase().trim() === norm)?.type || 'concept'
  for (const norm of norms) {
    if (canonical.has(norm)) continue
    let found = false
    for (const [existing, mapped] of canonical) {
      // 子串合并的短名守卫：短名 ≥3 字符、或含 CJK（'苹果' ⊂ '苹果公司' 是合法归一；
      // 而 'AI' ⊂ 'OpenAI'、'Go' ⊂ 'Google' 这类纯拉丁短缩写是误并，不走子串）。
      const short = norm.length <= existing.length ? norm : existing
      const legitShort = short.length >= 3 || /[㐀-鿿]/.test(short)
      if (legitShort && (norm.includes(existing) || existing.includes(norm))) { canonical.set(norm, { canonical: mapped.canonical, type: mapped.type }); found = true; break }
      const tA = new Set(norm.split(/[\s_-]+/)), tB = new Set(existing.split(/[\s_-]+/))
      let inter = 0; for (const t of tA) if (tB.has(t)) inter++
      if (inter / Math.max(tA.size+tB.size-inter,1) >= 0.6 && tA.size > 0 && tB.size > 0) { canonical.set(norm, { canonical: mapped.canonical, type: mapped.type }); found = true; break }
    }
    if (!found) canonical.set(norm, { canonical: rawEntities.find(e => e.name.toLowerCase().trim() === norm)?.name || norm, type: typeOf(norm) })
  }

  const now = new Date().toISOString()
  for (const [original, mapping] of canonical) {
    try {
      // 原子计数：ON CONFLICT 递增而非先 SELECT 再 REPLACE，避免并发运行时丢增量
      await env.DB.prepare(
        `INSERT INTO entity_links (original_name, canonical_name, entity_type, last_seen, article_count) VALUES (?,?,?,?,1)
         ON CONFLICT(original_name) DO UPDATE SET
           canonical_name = excluded.canonical_name,
           entity_type = excluded.entity_type,
           last_seen = excluded.last_seen,
           article_count = article_count + 1`
      ).bind(original, mapping.canonical, mapping.type, now).run()
    } catch {}
  }

  for (const articleId of [...new Set(rawEntities.map(e => e.articleId))]) {
    const article = rawEntities.filter(e => e.articleId === articleId)
    const seen = new Set<string>()
    // 保留 AI 分析产出的实体权重（此前固定写 0.5 会覆盖并扭曲热度排序）
    const deduped = article.map(e => ({ name: canonical.get(e.name.toLowerCase().trim())?.canonical || e.name, type: e.type, weight: typeof e.weight === 'number' ? e.weight : 0.5 }))
      .filter(e => { const k = e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    if (deduped.length) await env.DB.prepare('UPDATE news SET entities = ? WHERE id = ?').bind(JSON.stringify(deduped), articleId).run()
  }
  return { linked: canonical.size }
}
