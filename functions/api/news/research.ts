import { json, rateLimit, clientIp } from '../../../src/handler'
import { generateResearchReport } from '../../../src/analysis/deepseek.js'
import { tokenize } from '../../../src/tokenize.js'
import { likeEscape } from '../../../src/helpers.js'

// GET /api/news/research?q=xxx
// Three-phase deep research:
//   1. Token search → articles (broad match)
//   2. Entity/narrative expansion → more context
//   3. DeepSeek multi-chapter report generation

export async function onRequestGet(context: any) {
  const { request, env } = context
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') || '').trim()

  if (query.length < 2 || query.length > 80) {
    return json({ error: '问题长度需在 2-80 字之间' }, 400)
  }

  // 付费 LLM 端点限流：未命中缓存时同步调 DeepSeek，无限流可被大量唯一 q 绕过缓存烧钱
  if (!(await rateLimit(env, `research:${clientIp(request)}`, 10, 60))) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429)
  }

  // Check if agent pre-computed research for a matching topic
  const matchedNarr = await env.DB.prepare(
    "SELECT keyword, summary, developments FROM narratives WHERE keyword LIKE ? AND status = 'active' ORDER BY last_updated DESC LIMIT 1"
  ).bind(`__research__%${likeEscape(query.slice(0, 20))}%`).first<any>()
  if (matchedNarr?.summary) {
    try {
      const report = JSON.parse(matchedNarr.summary)
      if (report?.sections?.length) {
        const devs = matchedNarr.developments ? JSON.parse(matchedNarr.developments) : []
        return json({ report, refs: [], candidateCount: 0, source: 'agent' })
      }
    } catch {}
  }

  const cacheKey = `research:${query}`
  const { cacheGet, cacheSet, CACHE_TTL } = await import('../../../src/cache.js')
  const cached = await cacheGet<any>(cacheKey)
  if (cached) return json(cached)

  // ── Phase 1: Token search (broad match, more candidates than ask) ──
  const STOP = new Set(['本周','这周','上周','最近','今天','昨天','什么','怎么','为什么','如何','哪些','哪个','了','的','有','新闻','报道','一下'])
  const latin = query.match(/[A-Za-z0-9][A-Za-z0-9+.#-]{1,}/g) || []
  const cnSegs = tokenize(query.replace(/[A-Za-z0-9]+/g, ' '))
  let tokens = [...new Set([...latin, ...cnSegs])]
    .map(t => t.trim()).filter(Boolean)
    .filter(t => !STOP.has(t))
    .slice(0, 8)
  if (!tokens.length) tokens = [query]

  const esc = tokens.map(t => likeEscape(t))
  const clauses = tokens.map(() => "(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR entities LIKE ? ESCAPE '\\')").join(' OR ')
  const params = esc.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`])

  const rows = await env.DB.prepare(
    `SELECT id, title, title_zh, summary, summary_zh, source, published_at, entities FROM news
     WHERE published_at >= datetime('now', '-30 days')
       AND (${clauses})
     ORDER BY score DESC LIMIT 100`
  ).bind(...params).all<any>()
  let candidates = (rows.results || [])
    .map(r => {
      const hay = `${r.title || ''} ${r.summary || ''} ${r.entities || ''}`.toLowerCase()
      const hits = tokens.filter(t => hay.includes(t.toLowerCase())).length
      return { ...r, hits }
    })
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)

  // ── Phase 2: Expand via entity/narrative context ──
  // Find narratives matching the query
  const narratives = await env.DB.prepare(
    `SELECT keyword, article_ids FROM narratives WHERE status = 'active' AND (keyword LIKE ? OR label LIKE ?) LIMIT 5`
  ).bind(`%${likeEscape(query)}%`, `%${likeEscape(query)}%`).all<any>()
  const seenIds = new Set(candidates.map(c => c.id))

  for (const n of (narratives.results || [])) {
    try {
      const ids: number[] = JSON.parse(n.article_ids)
      const idsToFetch = ids.filter(id => !seenIds.has(id)).slice(0, 5)
      if (idsToFetch.length) {
        const extra = await env.DB.prepare(
          `SELECT id, title, title_zh, summary, summary_zh, source, published_at FROM news WHERE id IN (${idsToFetch.map(() => '?').join(',')})`
        ).bind(...idsToFetch).all<any>()
        for (const a of (extra.results || [])) { candidates.push(a); seenIds.add(a.id) }
      }
    } catch {}
  }

  // Expand via entity mentions
  const entityMatch = latin.length ? `%${likeEscape(latin[0] || '')}%` : null
  if (entityMatch) {
    const linked = await env.DB.prepare(
      "SELECT original_name, canonical_name FROM entity_links WHERE original_name LIKE ? OR canonical_name LIKE ? LIMIT 20"
    ).bind(entityMatch, entityMatch).all<any>()
    for (const e of (linked.results || [])) {
      const like = `%${likeEscape(String(e.canonical_name || e.original_name || ''))}%`
      // 截断排除列表：seenIds 会随候选增长，D1 绑定参数上限 100，超了查询直接失败
      const excludeIds = [...seenIds].slice(0, 60)
      const extra = await env.DB.prepare(
        `SELECT id, title, title_zh, summary, summary_zh, source, published_at FROM news WHERE entities LIKE ? AND id NOT IN (${excludeIds.map(() => '?').join(',')}) ORDER BY score DESC LIMIT 3`
      ).bind(like, ...excludeIds).all<any>()
      for (const a of (extra.results || [])) { if (!seenIds.has(a.id)) { candidates.push(a); seenIds.add(a.id) } }
    }
  }

  candidates = candidates.slice(0, 40)
  if (candidates.length < 3) return json({ report: null })

  // ── Phase 3: Generate research report ──
  const report = await generateResearchReport(
    query,
    candidates.map(c => ({
      id: c.id, title: c.title, titleZh: c.title_zh || null,
      summary: c.summary || '', summaryZh: c.summary_zh || null,
      source: c.source, publishedAt: c.published_at,
    })),
    env.DEEPSEEK_API_KEY,
  )

  if (!report) return json({ report: null })

  // Build ref lookup for frontend
  const refs = [...new Set(report.sections.flatMap(s => s.refs))].map(i => {
    const c = candidates[i]
    if (!c) return null
    return { ref: i, id: c.id, title: c.title, titleZh: c.title_zh || null, source: c.source }
  }).filter(Boolean)

  const result = { report, refs, candidateCount: candidates.length }
  await cacheSet(cacheKey, result, CACHE_TTL.ask)
  return json(result)
}
