import { cacheGet, cacheSet, CACHE_TTL } from '../cache.js'
import { tokenize } from '../tokenize.js'
import { mapNews, likeEscape, isoZ, type Env } from '../helpers.js'
import { RSS_SOURCES } from '../sources.js'

export async function listNews(env: Env, url: URL) {
  const category = url.searchParams.get('category')
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50') || 50))
  const offset = (page - 1) * pageSize
  const cacheKey = `list:${category && category !== '全部' ? category : 'all'}:${page}:${pageSize}`

  const cached = await cacheGet<any>(cacheKey)
  if (cached) return cached

  let query = 'SELECT n.*, COALESCE(sw.weight, 1.0) as source_weight FROM news n LEFT JOIN source_weights sw ON sw.source = n.source'
  let countQuery = 'SELECT COUNT(*) as total FROM news'
  const params: any[] = []
  const countParams: any[] = []

  if (category && category !== '全部') {
    query += ' WHERE n.category = ?'
    countQuery += ' WHERE category = ?'
    params.push(category); countParams.push(category)
  }
  query += ' ORDER BY (n.score * COALESCE(sw.weight, 1.0)) DESC, n.published_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const [items, totalResult] = await Promise.all([
    env.DB.prepare(query).bind(...params).all(),
    env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>(),
  ])
  const result = { items: (items.results as any[]).map(mapNews), total: totalResult?.total || 0, page, pageSize }
  await cacheSet(cacheKey, result, CACHE_TTL.list)
  return result
}

export async function trending(env: Env) {
  const cached = await cacheGet<any>('trending'); if (cached) return cached

  const rows = await env.DB.prepare(
    `SELECT id, title, title_norm, url, image, source, lang, description, published_at, category, score, summary, entities, sentiment, created_at
     FROM news WHERE published_at >= datetime('now', '-3 days')
     ORDER BY score DESC LIMIT 200`
  ).all<any>()
  const articles = (rows.results || []) as any[]

  // 解析实体，构建实体→来源 索引
  const entitySources = new Map<string, Set<string>>()
  const articleEntities = new Map<number, Set<string>>()

  for (const a of articles) {
    const entities = new Set<string>()
    if (a.entities) {
      try {
        const parsed = typeof a.entities === 'string' ? JSON.parse(a.entities) : a.entities
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            const name = e?.name?.trim().toLowerCase()
            if (name && name.length >= 2) {
              entities.add(name)
              if (!entitySources.has(name)) entitySources.set(name, new Set())
              entitySources.get(name)!.add(a.source || '')
            }
          }
        }
      } catch {}
    }
    articleEntities.set(a.id, entities)
  }

  // 热度：文章涉及的所有实体中，被最多来源覆盖的那个实体的来源数
  const heatMap = new Map<number, number>()
  for (const a of articles) {
    const entities = articleEntities.get(a.id) || new Set()
    let maxHeat = 0
    for (const entity of entities) {
      const count = entitySources.get(entity)?.size || 0
      maxHeat = Math.max(maxHeat, count)
    }
    heatMap.set(a.id, Math.max(maxHeat, 1))
  }

  // 去重 + 排序
  const seen = new Set<string>()
  const scored = articles
    .filter(a => { const k = a.title_norm || a.title; if (seen.has(k)) return false; seen.add(k); return true })
    .map(a => ({ ...mapNews(a), heat: heatMap.get(a.id) || 1, trendingScore: (a.score || 50) + 15 * (heatMap.get(a.id) || 1) }))
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, 30)

  const result = { items: scored }
  await cacheSet('trending', result, CACHE_TTL.trending)
  return result
}

export async function categories(env: Env) {
  { const cached = await cacheGet<any>('categories'); if (cached) return cached }
  const result = await env.DB.prepare('SELECT category as name, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC').all()
  const data = { categories: result.results }
  await cacheSet('categories', data, CACHE_TTL.categories)
  return data
}

export async function stats(env: Env) {
  { const cached = await cacheGet<any>('stats'); if (cached) return cached }
  const [total, today] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as total FROM news").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', 'start of day')").first<{ total: number }>(),
  ])
  const data = { total: total?.total || 0, today: today?.total || 0 }
  await cacheSet('stats', data, CACHE_TTL.stats)
  return data
}

export async function search(env: Env, q: string) {
  if (!q || q.length < 2) return { items: [] }

  // FTS5: escape special chars, use prefix matching for partial words
  const ftsQuery = q.replace(/['"]/g, '').split(/\s+/).filter(Boolean).map(w => {
    // Asterisks at word boundaries for prefix matching
    const last = w[w.length - 1]
    return /[a-zA-Z0-9]/.test(last) ? w + '*' : w
  }).join(' ')

  try {
    const items = await env.DB.prepare(
      `SELECT n.* FROM news_fts f JOIN news n ON n.id = f.rowid
       WHERE news_fts MATCH ?
       ORDER BY rank, n.score DESC LIMIT 30`
    ).bind(ftsQuery).all()
    if (items.results?.length) {
      return { items: (items.results as any[]).map(mapNews), query: q }
    }
  } catch { /* FTS5 yielded no results or threw — fall through to LIKE */ }

  // Fallback: LIKE search (better for short CJK queries where FTS5
  // tokenchars produces many individual-character hits)
  const escaped = likeEscape(q)
  const items = await env.DB.prepare(
    "SELECT * FROM news WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' ORDER BY published_at DESC LIMIT 30"
  ).bind(`%${escaped}%`, `%${escaped}%`).all()
  return { items: (items.results as any[]).map(mapNews), query: q }
}

export async function entitySearch(env: Env, name: string) {
  const like = `%${likeEscape(name)}%`
  const items = await env.DB.prepare(
    "SELECT * FROM news WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR entities LIKE ? ESCAPE '\\' ORDER BY score DESC LIMIT 30"
  ).bind(like, like, like).all()
  return { items: (items.results as any[]).map(mapNews), entity: name }
}

export async function detail(env: Env, id: number) {
  const row = await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first<any>()
  if (!row) return null
  const news = mapNews(row)

  let summary = row.summary || (news.description ? news.description.slice(0, 200) + '...' : '')
  let entities: any[] = []
  let sentiment: any = null

  if (row.entities && row.sentiment && row.analyzed_at) {
    try { entities = JSON.parse(row.entities) } catch {}
    try { sentiment = JSON.parse(row.sentiment) } catch {}
    if (row.summary) summary = row.summary
  }

  // Parse analysis_detail (keyPoints, significance, controversy, impact)
  let analysisDetail: any = null
  if (row.analysis_detail) {
    try { analysisDetail = JSON.parse(row.analysis_detail) } catch {}
  }

  // Related articles：共享显著词匹配
  const words = [...new Set(tokenize(news.title))]
  let related: any[] = []
  if (words.length) {
    const likes = words.map(w => `%${w}%`)
    const clauses = words.map(() => `title LIKE ?`)
    const sumExpr = words.map(() => `(title LIKE ?)`).join(' + ')
    const candidates = await env.DB.prepare(
      `SELECT *, (${sumExpr}) AS mc FROM news WHERE id != ? AND (${clauses.join(' OR ')}) ORDER BY mc DESC, score DESC LIMIT 30`
    ).bind(...likes, id, ...likes).all()
    const wordSet = new Set(words.map(w => w.toLowerCase()))
    const COMMON = new Set(['after', 'about', 'other', 'their', 'there', 'which', 'would', 'could', 'should', 'these', 'those', 'being', 'through', 'between', 'because', 'before', 'while', 'where', 'says', 'said', 'report', 'reports', 'video', 'watch', 'first', 'still', 'never', 'every', 'comments', 'with', 'from', 'into', 'over', 'under', 'again', 'against', 'during', 'without', 'within'])
    const isSignificant = (w: string) => /[a-zA-Z]/.test(w) ? (w.length >= 5 && !COMMON.has(w)) : w.length >= 3
    related = (candidates.results as any[])
      .map((n: any) => {
        const shared = [...new Set(tokenize(n.title).map(w => w.toLowerCase()))].filter(w => wordSet.has(w) && !COMMON.has(w))
        const sig = shared.filter(isSignificant)
        return { n, shared, sig }
      })
      .filter(x => x.sig.length >= 1 || x.shared.filter(w => /[a-zA-Z]/.test(w) ? w.length >= 4 : w.length >= 3).length >= 2)
      .sort((a, b) => (b.sig.length + b.shared.length) - (a.sig.length + a.shared.length))
      .slice(0, 5)
      .map(x => mapNews(x.n))
  }

  return { ...news, analysis: { summary, entities, sentiment, content: row.content || null }, related, analysisDetail }
}

export async function briefing(env: Env) {
  // Prefer agent-curated briefing if available
  try {
    const curated = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'briefing_curated'").first<any>()
    if (curated?.value) {
      const data = JSON.parse(curated.value)
      if (data?.items?.length) {
        const ids = data.items.map((i: any) => i.id)
        const rows = await env.DB.prepare(
          `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
           FROM news n WHERE n.id IN (${ids.map(() => '?').join(',')})`
        ).bind(...ids).all<any>()
        const byId = new Map((rows.results || []).map(r => [r.id, r]))
        const result = data.items.flatMap((cur: any) => {
          const row = byId.get(cur.id)
          if (!row) return []
          return [{ ...mapNews(row), heat: row.heat || 1, reason: cur.reason || '' }]
        })
        if (result.length >= 3) {
          const payload = { items: result }
          await cacheSet('briefing', payload, CACHE_TTL.briefing)
          return payload
        }
      }
    }
  } catch (e: any) { console.warn("[briefing] agent_meta error:", e?.message) }

  // Fallback: rule-based selection
  { const cached = await cacheGet<any>('briefing'); if (cached) return cached }
  let items = await env.DB.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n WHERE published_at >= datetime('now', '-48 hours')
     ORDER BY score DESC, published_at DESC LIMIT 50`
  ).all()
  if ((items.results?.length || 0) < 3) {
    items = await env.DB.prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
       FROM news n ORDER BY score DESC, published_at DESC LIMIT 50`
    ).all()
  }
  const bySource: Record<string, any[]> = {}
  for (const row of (items.results as any[])) { const s = row.source; if (!bySource[s]) bySource[s] = []; bySource[s].push(row) }
  const sel: any[] = []; const used = new Set<string>(); const srcs = Object.keys(bySource)
  while (sel.length < 7 && used.size < srcs.length) {
    for (const s of srcs) { if (used.has(s)) continue; const p = bySource[s]; if (!p.length) { used.add(s); continue }; const a = p.shift()!; if (sel.length >= 7) break; sel.push({ ...mapNews(a), heat: a.heat }); used.add(s) }
  }
  if (sel.length < 7) { for (const s of srcs) { for (const a of bySource[s] || []) { if (sel.length >= 7) break; if (!sel.find(n => n.id === a.id)) sel.push({ ...mapNews(a), heat: a.heat }) } } }
  const cats = await env.DB.prepare("SELECT category,COUNT(*) as c FROM news GROUP BY category ORDER BY c DESC").all()
  const top = (cats.results as any[]).slice(0,3).map((r:any) => r.category)
  const res = sel.slice(0,7).map((item,i) => {
    const hot = top.includes(item.category); const h = item.heat || 1
    const ha = Number.isFinite(item.publishedAt ? new Date(item.publishedAt).getTime() : NaN) ? Math.max(0,Math.round((Date.now()-new Date(item.publishedAt).getTime())/3600000)) : null
    let r = ''
    if (i===0) r = '今日头条 · ' + (hot ? item.category+'领域最受关注' : '多源报道热度最高')
    else if (h>=3) r = h+' 家媒体跟进 · '+item.category+'热点'
    else if (h===2) r = '2 家媒体报道 · '+item.category+'动向'
    else if (ha!==null && ha<=6) r = (ha<=1?'刚刚发布':ha+' 小时前')+' · '+item.category+'最新进展'
    else if (item.score>=70 && hot) r = item.category+'热点 · 热度持续上升'
    else if (item.score>=70) r = '高关注度 · 读者广泛讨论'
    else if (hot) r = item.category+'领域 · 近期焦点'
    else if (ha!==null && ha<=24) r = item.category+' · '+ha+' 小时前的进展'
    else r = item.category+'领域 · 信息增量'
    return { ...item, reason: r }
  })
  const payload = { items: res }
  await cacheSet('briefing', payload, CACHE_TTL.briefing)
  return payload
}

export async function sources(env: Env) {
  { const cached = await cacheGet<any>('sources'); if (cached) return cached }
  const [counts, stats] = await Promise.all([
    env.DB.prepare(
      "SELECT source, COUNT(*) as total, SUM(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 ELSE 0 END) as today FROM news GROUP BY source"
    ).all(),
    env.DB.prepare('SELECT * FROM source_stats').all(),
  ])
  const countMap = new Map((counts.results as any[]).map(r => [r.source, r]))
  const statMap = new Map((stats.results as any[]).map(r => [r.source, r]))
  const weightMap = new Map(RSS_SOURCES.map(s => [s.name, s.weight ?? 1]))
  const names = [...RSS_SOURCES.map(s => s.name), ...[...countMap.keys()].filter((n: string) => !weightMap.has(n))]
  const items = names.map((name: string) => ({
    name,
    weight: weightMap.get(name) ?? 1,
    total: countMap.get(name)?.total || 0,
    today: countMap.get(name)?.today || 0,
    lastOk: isoZ(statMap.get(name)?.last_ok),
    lastError: isoZ(statMap.get(name)?.last_error),
    failCount: statMap.get(name)?.fail_count || 0,
  }))
  const result = { items }
  await cacheSet('sources', result, CACHE_TTL.sources)
  return result
}
