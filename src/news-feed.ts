import { cacheGet, cacheSet, CACHE_TTL } from './cache.js'
import { tokenize } from './tokenize.js'
import { mapNews, likeEscape, isoZ, type Env } from './helpers.js'
import { RSS_SOURCES } from './sources.js'

export async function listNews(env: Env, url: URL) {
  const category = url.searchParams.get('category')
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50') || 50))
  const offset = (page - 1) * pageSize
  const cacheKey = `list:${category && category !== '全部' ? category : 'all'}:${page}:${pageSize}`

  const cached = await cacheGet<any>(cacheKey)
  if (cached) return cached

  let query = 'SELECT * FROM news'
  let countQuery = 'SELECT COUNT(*) as total FROM news'
  const params: any[] = []
  const countParams: any[] = []

  if (category && category !== '全部') {
    query += ' WHERE category = ?'
    countQuery += ' WHERE category = ?'
    params.push(category); countParams.push(category)
  }
  query += ' ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?'
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
  { const cached = await cacheGet<any>('trending'); if (cached) return cached }
  const items = await env.DB.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-3 days')
     ORDER BY (n.score + 6 * heat) DESC LIMIT 30`
  ).all()
  const seen = new Set<string>()
  const deduped = (items.results as any[]).filter((row: any) => {
    const key = row.title_norm || row.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const result = { items: deduped.map((row: any) => ({ ...mapNews(row), heat: row.heat })) }
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

  return { ...news, analysis: { summary, entities, sentiment, content: row.content || null }, related }
}

export async function briefing(env: Env) {
  { const cached = await cacheGet<any>('briefing'); if (cached) return cached }
  let items = await env.DB.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-48 hours')
     ORDER BY score DESC, published_at DESC LIMIT 50`
  ).all()
  if ((items.results?.length || 0) < 3) {
    items = await env.DB.prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
       FROM news n
       ORDER BY score DESC, published_at DESC LIMIT 50`
    ).all()
  }

  const bySource: Record<string, any[]> = {}
  for (const row of (items.results as any[])) {
    const s = row.source
    if (!bySource[s]) bySource[s] = []
    bySource[s].push(row)
  }

  const selected: any[] = []
  const usedSources = new Set<string>()
  const sources = Object.keys(bySource)

  while (selected.length < 7 && usedSources.size < sources.length) {
    for (const s of sources) {
      if (usedSources.has(s)) continue
      const pool = bySource[s]
      if (!pool.length) { usedSources.add(s); continue }
      const article = pool.shift()!
      if (selected.length >= 7) break
      selected.push({ ...mapNews(article), heat: article.heat })
      usedSources.add(s)
    }
  }

  if (selected.length < 7) {
    for (const s of sources) {
      for (const article of bySource[s] || []) {
        if (selected.length >= 7) break
        if (!selected.find(n => n.id === article.id)) {
          selected.push({ ...mapNews(article), heat: article.heat })
        }
      }
    }
  }

  const topics = await env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC"
  ).all()
  const topCats = (topics.results as any[]).slice(0, 3).map((r: any) => r.category)

  const result = selected.slice(0, 7).map((item, i) => {
    const isHotCat = topCats.includes(item.category)
    const heat = item.heat || 1
    const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN
    const hoursAgo = Number.isFinite(publishedAt) ? Math.max(0, Math.round((Date.now() - publishedAt) / 3_600_000)) : null

    let reason = ''
    if (i === 0) reason = '今日头条 · ' + (isHotCat ? `${item.category}领域最受关注` : '多源报道热度最高')
    else if (heat >= 3) reason = `${heat} 家媒体跟进 · ${item.category}热点`
    else if (heat === 2) reason = `2 家媒体报道 · ${item.category}动向`
    else if (hoursAgo !== null && hoursAgo <= 6) reason = `${hoursAgo <= 1 ? '刚刚发布' : hoursAgo + ' 小时前'} · ${item.category}最新进展`
    else if (item.score >= 70 && isHotCat) reason = `${item.category}热点 · 热度持续上升`
    else if (item.score >= 70) reason = '高关注度 · 读者广泛讨论'
    else if (isHotCat) reason = `${item.category}领域 · 近期焦点`
    else if (hoursAgo !== null && hoursAgo <= 24) reason = `${item.category} · ${hoursAgo} 小时前的进展`
    else reason = `${item.category}领域 · 信息增量`

    return { ...item, reason }
  })

  const payload = { items: result }
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
