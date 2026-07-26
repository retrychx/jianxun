import type { D1Database, KVNamespace, ExecutionContext } from '@cloudflare/workers-types'
import { fetchAllRSS, saveArticles } from './rss.js'
import { extractContent, analyzeWithDeepSeek, generateTopicLabels, generateDigest, translateBatch, generateStoryline, generateAnswer, titleSimilarity } from './analysis.js'
import { RSS_SOURCES } from './sources.js'

type Env = { DB: D1Database; KV?: KVNamespace; DEEPSEEK_API_KEY?: string; ADMIN_TOKEN?: string }

// Write endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.
// When ADMIN_TOKEN is not configured, all write endpoints stay closed.
export function requireAdmin(request: Request, env: Env): Response | null {
  const auth = request.headers.get('Authorization')
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

// Map snake_case DB fields to camelCase for frontend
function mapNews(row: any) {
  if (!row) return row
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    image: row.image,
    source: row.source,
    lang: row.lang,
    category: row.category,
    score: row.score,
    summary: row.summary,
    titleZh: row.title_zh || null,
    summaryZh: row.summary_zh || null,
    // 原始 entities JSON 字符串（不解析）：前端关注加权只需做包含匹配
    entities: row.entities || null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }
}

function tokenize(text: string): string[] {
  if (!text) return []
  const clean = text.replace(/[^\w一-鿿\s]/g, ' ')
  const words = clean.split(/\s+/).filter((w: string) => w.length > 1)
  const cn = clean.replace(/[a-zA-Z0-9]/g, '')
  for (let i = 0; i < cn.length - 1; i++) {
    const seg = cn.slice(i, i + 3)
    if (seg.length >= 2 && seg.trim()) words.push(seg)
  }
  return [...new Set(words)].filter((w: string) => w.length > 1)
}

// English stopwords excluded from fallback topic labels
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'how', 'why', 'what', 'is', 'in', 'on', 'for', 'with', 'and', 'or',
  'next', 'new', 'at', 'by', 'from', 'as', 'are', 'was', 'be', 'it', 'its', 'this', 'that', 'will',
  'can', 'not', 'but', 'if', 'so', 'into', 'over', 'about', 'after', 'via', 'vs', 'your', 'we',
  'their', 'has', 'have', 'do', 'does', 'get', 'may', 'now', 'more', 'most', 'all', 'also', 'just',
  'say', 'says', 'make', 'use', 'using', 'first', 'best', 'top', 'when', 'which', 'who',
])

// Fallback topic label: up to 3 meaningful keywords (stopwords filtered)
function fallbackLabel(words: string[]): string {
  const kept = words.filter(w => !STOPWORDS.has(w.toLowerCase()))
  return (kept.length ? kept : words).slice(0, 3).join(' · ')
}

export async function listNews(env: Env, url: URL) {
  const category = url.searchParams.get('category')
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50') || 50))
  const offset = (page - 1) * pageSize
  const cacheKey = `list:${category && category !== '全部' ? category : 'all'}:${page}:${pageSize}`

  // Try edge cache
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
  // Only articles from the last 3 days, so old high-score items don't stick forever.
  // heat = rows sharing the same normalized title; cross-source follow-ups boost ranking.
  const items = await env.DB.prepare(
    `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-3 days')
     ORDER BY (n.score + 6 * heat) DESC LIMIT 30`
  ).all()
  // Extra title_norm dedup guards legacy rows that predate the unique index
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

export async function fetchNews(env: Env, ctx: ExecutionContext) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles, env.DEEPSEEK_API_KEY, ctx)
  // Invalidate caches. Cache API 不支持按键名枚举：list:* 靠 60s TTL 自然过期，具名缓存主动失效
  if (saved > 0) {
    const deletions = ['trending', 'topics', 'stats', 'categories', 'briefing'].map(k => cacheDelete(k))
    await Promise.allSettled(deletions)
  }
  // Digest generation involves a 30s LLM call, so it runs after the response
  ctx.waitUntil(generateTodayDigest(env).catch(() => {}))
  return { fetched: saved }
}

// Generate at most one digest per CST day, once the day has enough new articles.
export async function generateTodayDigest(env: Env): Promise<'exists' | 'insufficient' | 'failed' | 'generated'> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 'failed'
  const dateRow = await env.DB.prepare("SELECT date('now', '+8 hours') as d").first<{ d: string }>()
  const date = dateRow?.d
  if (!date) return 'failed'
  const existing = await env.DB.prepare('SELECT id FROM digests WHERE date = ?').bind(date).first()
  if (existing) return 'exists'
  // "Today" in UTC+8 starts at date('now','+8 hours') 00:00, i.e. that date minus 8h in UTC
  const todayCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM news WHERE created_at >= datetime(date('now', '+8 hours'), '-8 hours')"
  ).first<{ n: number }>()
  if ((todayCount?.n || 0) < 10) return 'insufficient'
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.title, n.summary, n.category, n.source,
       (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-24 hours')
     ORDER BY n.score DESC LIMIT 30`
  ).all()
  const digest = await generateDigest(candidates.results as any[], apiKey)
  if (!digest) return 'failed'
  await env.DB.prepare('INSERT INTO digests (date, intro, items, extra) VALUES (?, ?, ?, ?)')
    .bind(date, digest.intro, JSON.stringify(digest.items), digest.extra ? JSON.stringify(digest.extra) : null).run()
  await Promise.allSettled([cacheDelete('digest'), cacheDelete('digests')])
  return 'generated'
}

// Admin/debug：内联跑一次日报生成，返回各阶段诊断（不写库）
export async function debugDigest(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { stage: 'no-api-key' }
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.title, n.summary, n.category, n.source,
       (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-24 hours')
     ORDER BY n.score DESC LIMIT 30`
  ).all()
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: '你是中文科技日报主编。从候选新闻中挑出今天最重要的 5-8 条做成日报。只返回 JSON：{"intro":"≤120字","items":[{"news_id":数字,"why":"≤30字","category":"分类"}],"extra":{"news_id":数字,"why":"≤30字"}或null}。news_id 必须来自候选列表。' },
        { role: 'user', content: (candidates.results as any[]).slice(0, 30).map(c => `[${c.id}] ${c.title}（${c.source}/${c.category}）\n${(c.summary || '').slice(0, 200)}`).join('\n\n') }
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  })
  const text = await res.text()
  let parsed: any = null
  try {
    const data = JSON.parse(text)
    const raw = data.choices?.[0]?.message?.content || ''
    parsed = { finishReason: data.choices?.[0]?.finish_reason, contentHead: raw.slice(0, 600), contentTail: raw.slice(-300) }
  } catch { parsed = { nonJsonResponse: text.slice(0, 600) } }
  return { stage: 'llm', httpStatus: res.status, candidateCount: candidates.results?.length, ...parsed }
}

export async function digest(env: Env, date: string | null) {
  const cacheKey = date ? `digest:${date}` : 'digest'
  { const cached = await cacheGet<any>(cacheKey); if (cached) return cached }
  const row = date
    ? await env.DB.prepare('SELECT * FROM digests WHERE date = ?').bind(date).first<any>()
    : await env.DB.prepare('SELECT * FROM digests ORDER BY date DESC, id DESC LIMIT 1').first<any>()
  if (!row) return null

  let items: any[] = []
  let extra: any = null
  try { items = JSON.parse(row.items) } catch {}
  try { extra = row.extra ? JSON.parse(row.extra) : null } catch {}
  if (!Array.isArray(items)) items = []

  // Join digest entries with news rows; deleted articles are skipped
  const ids = [...items.map(i => i.news_id), extra?.news_id].filter(id => Number.isInteger(id))
  const byId = new Map<number, any>()
  if (ids.length) {
    const rows = await env.DB.prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
       FROM news n WHERE n.id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all()
    for (const r of rows.results as any[]) byId.set(r.id, r)
  }

  const result = {
    date: row.date as string,
    intro: row.intro as string,
    items: items.flatMap((it: any) => {
      const n = byId.get(it.news_id)
      if (!n) return []
      return [{
        id: n.id, title: n.title, titleZh: n.title_zh || null,
        why: it.why || '', category: it.category || n.category,
        source: n.source, heat: n.heat || 1,
      }]
    }),
    extra: (() => {
      const n = extra && byId.get(extra.news_id)
      return n ? { id: n.id, title: n.title, titleZh: n.title_zh || null, why: extra.why || '' } : null
    })(),
  }
  await cacheSet(cacheKey, result, CACHE_TTL.digest)
  return result
}

export async function digests(env: Env) {
  { const cached = await cacheGet<any>('digests'); if (cached) return cached }
  const rows = await env.DB.prepare('SELECT date FROM digests ORDER BY date DESC').all()
  const result = { dates: (rows.results as any[]).map(r => r.date) }
  await cacheSet('digests', result, CACHE_TTL.digests)
  return result
}

export async function topic(env: Env, name: string) {
  const cacheKey = `topic:${name}`
  { const cached = await cacheGet<any>(cacheKey); if (cached) return cached }

  // Same clustering as /topics; fall back to a plain title LIKE search
  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const hit = clusterNews(all.results as any[]).find(c =>
    c.words.some(w => w === name || w.includes(name) || name.includes(w)) ||
    fallbackLabel(c.words).includes(name)
  )
  let clusterItems: any[]
  let keyword: string, label: string
  if (hit) {
    clusterItems = hit.items
    keyword = hit.words.slice(0, 3).join(' · ')
    label = fallbackLabel(hit.words)
  } else {
    const rows = await env.DB.prepare('SELECT * FROM news WHERE title LIKE ? ORDER BY published_at DESC LIMIT 20').bind(`%${name}%`).all()
    if (!rows.results.length) return null
    clusterItems = rows.results as any[]
    keyword = name
    label = name
  }

  // Storyline from the 10 highest-scoring articles in the cluster
  const top = clusterItems.slice().sort((a: any, b: any) => (b.score || 0) - (a.score || 0)).slice(0, 10)
  const storyline = await generateStoryline(
    top.map((i: any) => ({ title: i.title, summary: i.summary || i.description || '' })),
    env.DEEPSEEK_API_KEY
  )

  // Articles in chronological order
  const timeline = clusterItems.slice()
    .sort((a: any, b: any) => (a.published_at || '9999').localeCompare(b.published_at || '9999'))
    .map(mapNews)

  // Dominant sentiment label per source (rows without cached sentiment are skipped)
  const bySource = new Map<string, { count: number; labels: Map<string, number> }>()
  for (const r of clusterItems) {
    const entry = bySource.get(r.source) || { count: 0, labels: new Map<string, number>() }
    bySource.set(r.source, entry)
    entry.count++
    if (!r.sentiment) continue
    try {
      const label = JSON.parse(r.sentiment)?.label
      if (label) entry.labels.set(label, (entry.labels.get(label) || 0) + 1)
    } catch {}
  }
  const perspectives = [...bySource.entries()].map(([source, e]) => ({
    source,
    label: e.labels.size ? [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
    count: e.count,
  }))

  const result = { keyword, label, storyline, timeline, perspectives }
  await cacheSet(cacheKey, result, CACHE_TTL.topic)
  return result
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
  // Configured sources first (in sources.ts order), then any legacy DB-only sources
  const names = [...RSS_SOURCES.map(s => s.name), ...[...countMap.keys()].filter((n: string) => !weightMap.has(n))]
  const items = names.map((name: string) => ({
    name,
    weight: weightMap.get(name) ?? 1,
    total: countMap.get(name)?.total || 0,
    today: countMap.get(name)?.today || 0,
    lastOk: statMap.get(name)?.last_ok || null,
    lastError: statMap.get(name)?.last_error || null,
    failCount: statMap.get(name)?.fail_count || 0,
  }))
  const result = { items }
  await cacheSet('sources', result, CACHE_TTL.sources)
  return result
}

export async function weekly(env: Env) {
  { const cached = await cacheGet<any>('weekly'); if (cached) return cached }
  const rows = await env.DB.prepare(
    "SELECT * FROM news WHERE created_at >= datetime('now', '-7 days') ORDER BY score DESC"
  ).all()
  const items = rows.results as any[]

  // Count entity mentions across cached AI analyses
  const entityCount = new Map<string, number>()
  for (const r of items) {
    if (!r.entities) continue
    try {
      const list = JSON.parse(r.entities)
      if (!Array.isArray(list)) continue
      for (const e of list) {
        if (e?.name) entityCount.set(e.name, (entityCount.get(e.name) || 0) + 1)
      }
    } catch {}
  }
  const topEntities = [...entityCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Top 5 topic clusters of the week, AI-labeled like /topics with keyword fallback
  const clusters = clusterNews(items.slice(0, 80)).sort((a, b) => b.items.length - a.items.length).slice(0, 5)
  const aiLabels = await generateTopicLabels(clusters.map(c => c.items.slice(0, 3).map(i => i.title)), env.DEEPSEEK_API_KEY)
  const topTopics = clusters.map((c, i) => ({ label: aiLabels?.[i] || fallbackLabel(c.words), count: c.items.length }))

  const result = { totalNew: items.length, topEntities, topTopics }
  await cacheSet('weekly', result, CACHE_TTL.weekly)
  return result
}

// Translate the 10 highest-scoring untranslated English articles and write back title_zh/summary_zh
export async function translateMissing(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { translated: 0 }
  const rows = await env.DB.prepare(
    "SELECT id, title, summary, description FROM news WHERE lang = 'en' AND title_zh IS NULL ORDER BY score DESC LIMIT 10"
  ).all()
  if (!rows.results.length) return { translated: 0 }
  const translated = await translateBatch(
    (rows.results as any[]).map(r => ({ id: r.id, title: r.title, summary: r.summary || r.description || '' })),
    apiKey
  )
  if (!translated) return { translated: 0 }
  let n = 0
  for (const t of translated) {
    await env.DB.prepare('UPDATE news SET title_zh = ?, summary_zh = ? WHERE id = ?')
      .bind(t.title_zh, t.summary_zh || null, t.id).run()
    n++
  }
  return { translated: n }
}

export async function detail(env: Env, id: number) {
  const row = await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first<any>()
  if (!row) return null
  const news = mapNews(row)

  let summary = row.summary || (news.description ? news.description.slice(0, 200) + '...' : '')
  let entities: any[] = []
  let sentiment: any = null

  // Parse cached AI analysis
  if (row.entities && row.sentiment && row.analyzed_at) {
    try { entities = JSON.parse(row.entities) } catch {}
    try { sentiment = JSON.parse(row.sentiment) } catch {}
    if (row.summary) summary = row.summary
  }

  // Related articles
  const words = tokenize(news.title)
  let related: any[] = []
  if (words.length) {
    const clauses = words.map((_: string, i: number) => `title LIKE ?`)
    const params = words.map((w: string) => `%${w}%`)
    const candidates = await env.DB.prepare(`SELECT * FROM news WHERE id != ? AND (${clauses.join(' OR ')}) ORDER BY score DESC LIMIT 10`).bind(id, ...params).all()
    related = (candidates.results as any[]).map(mapNews).map((n: any) => ({ ...n, sim: titleSimilarity(news.title, n.title) })).filter((n: any) => n.sim > 0.15).sort((a: any, b: any) => b.sim - a.sim).slice(0, 5)
    related.forEach((r: any) => delete r.sim)
  }

  return { ...news, analysis: { summary, entities, sentiment, content: row.content || null }, related }
}
export async function briefing(env: Env) {
  { const cached = await cacheGet<any>('briefing'); if (cached) return cached }
  // Select top 7 articles: diverse sources, recent, high-scoring
  // Prefer the last 48 hours; fall back to all-time if too few fresh articles.
  // heat = rows sharing the same normalized title (roughly how many outlets followed up).
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

  // Dedup by source: pick best article from each source, then fill remaining slots
  const bySource: Record<string, any[]> = {}
  for (const row of (items.results as any[])) {
    const s = row.source
    if (!bySource[s]) bySource[s] = []
    bySource[s].push(row)
  }

  const selected: any[] = []
  const usedSources = new Set<string>()
  const sources = Object.keys(bySource)

  // Round-robin: pick best from each source
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

  // Fill remaining from any source
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

  // Generate reasons: rotate templates driven by follow-up count, recency and category
  const topics = await env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC"
  ).all()
  const topCats = (topics.results as any[]).slice(0, 3).map((r: any) => r.category)

  const result = selected.slice(0, 7).map((item, i) => {
    const isHotCat = topCats.includes(item.category)
    const heat = item.heat || 1 // counts the article itself, so 2+ means multiple outlets
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

// Greedy title-keyword clustering shared by /topics, /topic and /weekly:
// seed with an unused article's keywords, then absorb every article whose title
// contains one of them. Only clusters of 2+ articles are returned.
function clusterNews(items: any[]): { words: string[]; items: any[] }[] {
  const used = new Set<number>()
  const clusters: { words: string[]; items: any[] }[] = []
  for (const item of items) {
    if (used.has(item.id)) continue
    const words = tokenize(item.title)
    if (!words.length) continue
    const cluster: any[] = [item]; used.add(item.id)
    for (const other of items) {
      if (used.has(other.id)) continue
      if (words.some((w: string) => other.title?.includes(w))) { cluster.push(other); used.add(other.id) }
    }
    if (cluster.length >= 2) clusters.push({ words, items: cluster })
  }
  return clusters
}

export async function topics(env: Env) {
  { const cached = await cacheGet<any>('topics'); if (cached) return cached }
  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const items = all.results as any[]
  const topics: any[] = []

  for (const { words, items: cluster } of clusterNews(items)) {
    {
      // Date range
      const dates = cluster.map(i => i.published_at).filter(Boolean).sort()
      const dateRange = dates.length >= 2 ? dates[0].slice(0, 10) + ' ~ ' + dates[dates.length - 1].slice(0, 10) : dates[0]?.slice(0, 10) || ''
      // Source perspectives
      const sourcePerspectives = [...new Set(cluster.map(i => i.source))].map(s => ({
        name: s,
        angle: PERSPECTIVES[s] || '综合'
      }))
      // Narrative summary (use AI summary if available, otherwise use description of best article)
      // Cluster is still in score order here; top titles feed the AI labeler
      const topTitles = cluster.slice(0, 3).map(i => i.title)
      const bestItem = cluster.sort((a: any, b: any) => (b.summary?.length || 0) - (a.summary?.length || 0))[0]
      const narrative = bestItem?.summary
        ? bestItem.summary.slice(0, 300)
        : (cluster[0]?.description || '').slice(0, 200) + '...'

      topics.push({
        keyword: words.slice(0, 3).join(' · '),
        label: fallbackLabel(words),
        count: cluster.length,
        sources: [...new Set(cluster.map(i => i.source))],
        sourcePerspectives,
        dateRange,
        narrative: narrative.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        items: cluster.slice(0, 5),
        topTitles,
      })
    }
  }
  topics.sort((a, b) => b.count - a.count)
  const top = topics.slice(0, 15)
  // One AI call labels every cluster; each cluster keeps its keyword label as fallback
  const aiLabels = await generateTopicLabels(top.map(t => t.topTitles), env.DEEPSEEK_API_KEY)
  const result = {
    topics: top.map((t: any, i: number) => {
      const { topTitles, ...rest } = t
      return { ...rest, label: aiLabels?.[i] || t.label, items: t.items.map(mapNews) }
    })
  }
  await cacheSet('topics', result, CACHE_TTL.topics)
  return result
}

const PERSPECTIVES: Record<string, string> = {
  '36氪': '商业', '少数派': '效率', '爱范儿': '消费',
  '量子位': 'AI', '钛媒体': '产业', '雷锋网': '技术',
  '品玩': '趋势', 'Solidot': '开源', 'V2EX 热榜': '社区',
  '开源中国': '开源', '投资界': '创投', '中国新闻网': '综合',
  '美团技术': '工程', 'Hacker News': '社区', 'GitHub Trending': '开源',
  'TechCrunch': '创投', 'The Verge': '消费', 'Ars Technica': '深度',
  'Wired': '文化', 'Engadget': '消费', 'Dev.to': '社区',
  'Android Central': '消费', 'New Scientist': '科学',
  'ScienceDaily': '科学', 'Space.com': '科学', 'MIT Tech Review': 'AI', '机器之心': 'AI', 'arXiv AI': '研究', 'arXiv Robot': '研究', 'OpenAI': 'AI',
  'NPR': '综合', 'BBC Tech': '综合',
}

export async function search(env: Env, q: string) {
  if (!q || q.length < 2) return { items: [] }
  const items = await env.DB.prepare(
    "SELECT * FROM news WHERE title LIKE ? OR description LIKE ? ORDER BY published_at DESC LIMIT 30"
  ).bind(`%${q}%`, `%${q}%`).all()
  return { items: (items.results as any[]).map(mapNews), query: q }
}

export async function entitySearch(env: Env, name: string) {
  const like = `%${name}%`
  const items = await env.DB.prepare(
    "SELECT * FROM news WHERE title LIKE ? OR description LIKE ? OR entities LIKE ? ORDER BY score DESC LIMIT 30"
  ).bind(like, like, like).all()
  return { items: (items.results as any[]).map(mapNews), entity: name }
}

// 问答搜索：近 7 天相关报道 → DeepSeek 综合回答（[n] 引用候选）。
// 返回完整 Response（参数非法要回 400，与 requireAdmin 一样直接构造响应）。
export async function ask(env: Env, q: string): Promise<Response> {
  const query = (q || '').trim()
  if (query.length < 2 || query.length > 60) return json({ error: '问题长度需在 2-60 字之间' }, 400)

  const cacheKey = `ask:${query}`
  { const cached = await cacheGet<any>(cacheKey); if (cached) return json(cached) }

  // 分词检索：拉丁词单独提取（防止与 CJK 粘连成复合词被停用词误杀），CJK 滑窗短段去停用词
  const ASK_STOP = new Set([
    '本周', '这周', '上周', '最近', '今天', '昨天', '什么', '怎么', '怎么样', '怎样', '为什么', '为啥',
    '如何', '哪些', '哪里', '哪个', '了', '的', '有', '有什么', '新动向', '动向', '消息', '新闻', '报道', '一下', '发生',
  ])
  const latin = query.match(/[A-Za-z0-9][A-Za-z0-9+.#-]{1,}/g) || []
  const cnSegs = tokenize(query.replace(/[A-Za-z0-9]+/g, ' '))
  let tokens = [...new Set([...latin, ...cnSegs])]
    .map(t => t.trim()).filter(Boolean)
    .filter(t => !ASK_STOP.has(t) && !(t.length <= 3 && [...ASK_STOP].some(s => s.length >= 2 && t.includes(s))))
    .slice(0, 6)
  if (!tokens.length) tokens = [query]

  const clauses = tokens.map(() => '(title LIKE ? OR summary LIKE ? OR entities LIKE ?)').join(' OR ')
  const params = tokens.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`])
  const rows = await env.DB.prepare(
    `SELECT id, title, title_zh, summary, summary_zh, source, published_at, entities FROM news
     WHERE published_at >= datetime('now', '-7 days')
       AND (${clauses})
     ORDER BY score DESC LIMIT 40`
  ).bind(...params).all()

  // 命中词数优先，其次分数
  const ranked = (rows.results as any[])
    .map(r => {
      const hay = `${r.title || ''} ${r.summary || ''} ${r.entities || ''}`.toLowerCase()
      const hits = tokens.filter(t => hay.includes(t.toLowerCase())).length
      return { ...r, hits }
    })
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 12)
  const candidates = ranked

  if (!candidates.length) {
    const empty = { answer: null, refs: [] }
    await cacheSet(cacheKey, empty, CACHE_TTL.ask)
    return json(empty)
  }

  const answer = await generateAnswer(
    query,
    candidates.map(c => ({
      id: c.id, title: c.title, titleZh: c.title_zh || null,
      summary: c.summary || null, summaryZh: c.summary_zh || null,
      source: c.source, publishedAt: c.published_at,
    })),
    env.DEEPSEEK_API_KEY
  )

  // LLM 失败不缓存（下次重试）；refs 映射回候选文章，ref 保留原候选下标供前端对齐 [n]
  if (!answer) return json({ answer: null, refs: [] })
  const refs = answer.refs.map(i => {
    const c = candidates[i]
    return { ref: i, id: c.id, title: c.title, titleZh: c.title_zh || null, source: c.source }
  })
  const result = { answer: answer.answer, refs }
  await cacheSet(cacheKey, result, CACHE_TTL.ask)
  return json(result)
}

// Validate the body of POST /api/news/:id/detail. Returns an error message or null.
export function validateAnalysisBody(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object'
  const { summary, entities, sentiment, category } = body
  if (summary !== undefined && typeof summary !== 'string') return 'summary must be a string'
  if (entities !== undefined && (!Array.isArray(entities) || entities.some(e => typeof e !== 'string'))) return 'entities must be a string array'
  if (sentiment !== undefined && !['positive', 'neutral', 'negative'].includes(sentiment)) return 'sentiment must be positive|neutral|negative'
  if (category !== undefined && typeof category !== 'string') return 'category must be a string'
  return null
}

export async function saveAnalysis(env: Env, id: number, body: any) {
  try {
    const { summary, category, entities, sentiment } = body
    await env.DB.prepare(
      "UPDATE news SET summary=?, entities=?, sentiment=?, category=COALESCE(?,category), analyzed_at=datetime('now') WHERE id=?"
    ).bind(summary || null, JSON.stringify(entities || []), JSON.stringify(sentiment || {}), category || null, id).run()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export async function fixImages(env: Env) {
  // Fetch missing images (max 3)
  const imgRows = await env.DB.prepare("SELECT id, url FROM news WHERE image IS NULL LIMIT 3").all()
  let imgFixed = 0
  await Promise.allSettled(
    (imgRows.results as any[]).map(async (row: any) => {
      try {
        const { image } = await extractContent(row.url)
        if (image) { await env.DB.prepare('UPDATE news SET image = ? WHERE id = ?').bind(image, row.id).run(); imgFixed++ }
      } catch {}
    })
  )
  // AI analysis (up to 3 articles, skip ones that already failed 3 times)
  const aiRows = await env.DB.prepare("SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 ORDER BY RANDOM() LIMIT 3").all()
  let aiDone = 0
  const apiKey = env.DEEPSEEK_API_KEY
  if (apiKey && aiRows.results.length > 0) {
    for (const row of (aiRows.results as any[])) {
      // Count every attempt so unanalyzable articles don't get retried forever
      await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
      try {
        const { content: extracted } = await extractContent(row.url)
        const content = (extracted || row.description || row.title).slice(0, 2000)
        const result = await analyzeWithDeepSeek(row.title, content, apiKey)
        if (result) {
          await env.DB.prepare("UPDATE news SET summary=?, entities=?, sentiment=?, category=?, content=COALESCE(?, content), analyzed_at=datetime('now') WHERE id=?")
            .bind(result.summary, JSON.stringify(result.entities), JSON.stringify(result.sentiment), result.category || '科技', extracted, row.id).run()
          aiDone++
        }
      } catch (e: any) {
        console.error('AI analysis failed:', e.message)
      }
    }
  }
  return { imgFixed, aiDone }
}

// Edge cache helpers（Cache API：按边缘节点缓存，零绑定配置；TTL 由 Cache-Control 控制）
const CACHE_TTL = {
  list: 60, trending: 120, stats: 300, categories: 300, topics: 600, briefing: 300, detail: 3600,
  digest: 600, digests: 600, topic: 600, sources: 300, weekly: 3600, ask: 3600,
}

const cacheReq = (key: string) => new Request(`https://jianxun-cache.internal/${encodeURIComponent(key)}`)

// DOM lib 的 caches: CacheStorage 没有 default，运行时 Workers 保证存在
const edgeCache = () => (caches as unknown as { default: Cache }).default

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const res = await edgeCache().match(cacheReq(key))
    return res ? ((await res.json()) as T) : null
  } catch { return null }
}

async function cacheSet(key: string, data: any, ttl: number) {
  try {
    await edgeCache().put(cacheReq(key), new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
    }))
  } catch {}
}

async function cacheDelete(key: string) {
  try { await edgeCache().delete(cacheReq(key)) } catch {}
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
}

export { cacheGet, cacheSet, CACHE_TTL }