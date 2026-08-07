import { cacheGet, cacheSet, CACHE_TTL } from '../cache.js'
import { tokenize } from '../tokenize.js'
import { mapNews, likeEscape, isoZ, type Env } from '../helpers.js'
import { RSS_SOURCES } from '../sources.js'
import { META, metaGetJSON } from '../db.js'

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
  // 时间衰减排序：高分新文章靠前，旧文章自然下沉
  // formula: score / (1 + hours_old × 0.05) + 点击量 × 0.1（数据驱动：读者点击多的加权）
  // 加 30 天窗口：时衰减后 30 天前的文章分数≈0，不可能进前 50，提前过滤缩小计算排序集
  query += ' AND n.published_at >= datetime(\'now\', \'-30 days\')'
  query += " ORDER BY (n.score * COALESCE(sw.weight, 1.0)) / (1 + CAST((julianday('now') - julianday(n.published_at)) * 24 AS INTEGER) * 0.05) + COALESCE(n.click_count, 0) * 0.1 DESC LIMIT ? OFFSET ?"
  params.push(pageSize, offset)

  // COUNT 单独缓存（按分类，300s）：避免每次冷命中都全表 COUNT
  const totalKey = `news_total:${category && category !== '全部' ? category : 'all'}`
  let total = await cacheGet<number>(totalKey)
  if (total == null) {
    const totalResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()
    total = totalResult?.total || 0
    await cacheSet(totalKey, total, 300)
  }

  const items = await env.DB.prepare(query).bind(...params).all()
  const result = { items: (items.results as any[]).map(mapNews), total, page, pageSize }
  await cacheSet(cacheKey, result, CACHE_TTL.list)
  return result
}

export async function trending(env: Env) {
  const cached = await cacheGet<any>('trending'); if (cached) return cached

  const rows = await env.DB.prepare(
    `SELECT id, title, title_norm, url, image, source, lang, description, published_at, category, score, summary, entities, sentiment, created_at, click_count
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
    .map(a => {
      const heat = heatMap.get(a.id) || 1
      // 数据驱动：读者点击多的实体/文章加权
      return { ...mapNews(a), heat, trendingScore: (a.score || 50) + 25 * heat + (a.click_count || 0) * 0.5 }
    })
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
    // "今日"按北京时区（+8h）的零点算，否则北京时间早上看到"今日 0 篇"
    env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', '+8 hours', 'start of day')").first<{ total: number }>(),
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
    "SELECT * FROM news WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR entities LIKE ? ESCAPE '\\' ORDER BY published_at DESC LIMIT 30"
  ).bind(like, like, like).all()
  return { items: (items.results as any[]).map(mapNews), entity: name }
}

export async function detail(env: Env, id: number) {
  // 详情页是高频读路径，此前完全无缓存——补上（CACHE_TTL.detail 之前是死配置）
  const cacheKey = `detail:${id}`
  { const cached = await cacheGet<any>(cacheKey); if (cached) return cached }

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
  // 截断词数：该查询每个词会绑定 2 个参数（sumExpr + OR 子句）+ id 共 2N+1 个，
  // 超过 D1 的 100 绑定参数上限会导致查询失败。
  const words = [...new Set(tokenize(news.title))].slice(0, 20)
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

  const result = { ...news, analysis: { summary, entities, sentiment, content: row.content || null }, related, analysisDetail }
  await cacheSet(cacheKey, result, CACHE_TTL.detail)
  return result
}

export async function briefing(env: Env) {
  // Prefer agent-curated briefing if available
  try {
    const curated = await metaGetJSON<{ items: { id: number; reason?: string }[] }>(env, META.briefingCurated)
    if (curated?.items?.length) {
      const ids = curated.items.map((i: any) => i.id)
      const rows = await env.DB.prepare(
        `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
         FROM news n WHERE n.id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all<any>()
      const byId = new Map((rows.results || []).map(r => [r.id, r]))
      const result = curated.items.flatMap((cur: any) => {
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
  const cached = await cacheGet<any>('sources'); if (cached) return cached
  const [counts, stats, cats] = await Promise.all([
    env.DB.prepare("SELECT source, COUNT(*) as total, SUM(CASE WHEN created_at >= datetime('now', '+8 hours', 'start of day') THEN 1 ELSE 0 END) as today FROM news GROUP BY source").all(),
    env.DB.prepare('SELECT * FROM source_stats').all(),
    env.DB.prepare("SELECT source, category, COUNT(*) as c FROM news WHERE category IS NOT NULL GROUP BY source, category").all(),
  ])
  const countMap = new Map((counts.results as any[]).map(r => [r.source, r]))
  const statMap = new Map((stats.results as any[]).map(r => [r.source, r]))
  const weightMap = new Map(RSS_SOURCES.map(s => [s.name, s.weight ?? 1]))
  // 计算每个源的类别分布
  const sourceCats = new Map<string, { category: string; count: number }[]>()
  const catRows = (cats.results || []) as any[]
  for (const r of catRows) {
    if (!sourceCats.has(r.source)) sourceCats.set(r.source, [])
    sourceCats.get(r.source)!.push({ category: r.category, count: r.c })
  }
  // 计算每个源的近期实体焦点（加 LIMIT 防止 7 天全量扫描；高分文章已能代表实体焦点）
  const recentRows = await env.DB.prepare(
    `SELECT source, entities FROM news WHERE entities IS NOT NULL AND entities != '' AND created_at >= datetime('now', '-7 days')
     ORDER BY score DESC LIMIT 1000`
  ).all<any>()
  const sourceEntities = new Map<string, Map<string, number>>()
  for (const row of (recentRows.results || [])) {
    const src = row.source; if (!src) continue
    if (!sourceEntities.has(src)) sourceEntities.set(src, new Map())
    const emap = sourceEntities.get(src)!
    try {
      const parsed = typeof row.entities === 'string' ? JSON.parse(row.entities) : row.entities
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          const name = e?.name?.trim()
          if (name && name.length >= 2) emap.set(name, (emap.get(name) || 0) + 1)
        }
      }
    } catch {}
  }
  const names = [...RSS_SOURCES.map(s => s.name), ...[...countMap.keys()].filter((n: string) => !weightMap.has(n))]
  const items = names.map((name: string) => {
    const emap = sourceEntities.get(name)
    const topEntities = emap ? [...emap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => ({ name: e[0], count: e[1] })) : []
    const srcCats = sourceCats.get(name) || []
    const topCats = srcCats.sort((a, b) => b.count - a.count).slice(0, 3).map(c => c.category)
    return {
      name,
      weight: weightMap.get(name) ?? 1,
      total: countMap.get(name)?.total || 0,
      today: countMap.get(name)?.today || 0,
      lastOk: isoZ(statMap.get(name)?.last_ok),
      lastError: isoZ(statMap.get(name)?.last_error),
      failCount: statMap.get(name)?.fail_count || 0,
      topEntities,
      topCategories: topCats,
    }
  })
  const result = { items }
  await cacheSet('sources', result, CACHE_TTL.sources)
  return result
}
