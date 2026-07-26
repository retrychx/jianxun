import type { D1Database, KVNamespace, ExecutionContext } from '@cloudflare/workers-types'
import { fetchAllRSS, saveArticles } from './rss.js'
import { extractContent, analyzeWithDeepSeek, generateTopicLabels, titleSimilarity } from './analysis.js'

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

  // Try KV cache
  if (env.KV) {
    const cached = await cacheGet<any>(env.KV, cacheKey)
    if (cached) return cached
  }

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
  if (env.KV) await cacheSet(env.KV, cacheKey, result, CACHE_TTL.list)
  return result
}

export async function trending(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'trending'); if (cached) return cached }
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
  if (env.KV) await cacheSet(env.KV, 'trending', result, CACHE_TTL.trending)
  return result
}

export async function categories(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'categories'); if (cached) return cached }
  const result = await env.DB.prepare('SELECT category as name, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC').all()
  const data = { categories: result.results }
  if (env.KV) await cacheSet(env.KV, 'categories', data, CACHE_TTL.categories)
  return data
}

export async function stats(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'stats'); if (cached) return cached }
  const [total, today] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as total FROM news").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', 'start of day')").first<{ total: number }>(),
  ])
  const data = { total: total?.total || 0, today: today?.total || 0 }
  if (env.KV) await cacheSet(env.KV, 'stats', data, CACHE_TTL.stats)
  return data
}

export async function fetchNews(env: Env, ctx: ExecutionContext) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles, env.DEEPSEEK_API_KEY, ctx)
  // Invalidate caches: all `list:` pages plus derived endpoints
  if (env.KV && saved > 0) {
    try {
      const deletions: Promise<unknown>[] = []
      let cursor: string | undefined
      do {
        const page = await env.KV.list({ prefix: 'list:', cursor })
        for (const key of page.keys) deletions.push(env.KV.delete(key.name))
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      for (const key of ['trending', 'topics', 'stats', 'categories', 'briefing']) deletions.push(env.KV.delete(key))
      await Promise.allSettled(deletions)
    } catch {}
  }
  return { fetched: saved }
}

export async function detail(env: Env, id: number) {
  const row = await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first<any>()
  if (!row) return null
  const news = mapNews(row)

  let summary = row.summary || news.description?.slice(0, 200) + '...'
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
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'briefing'); if (cached) return cached }
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
  if (env.KV) await cacheSet(env.KV, 'briefing', payload, CACHE_TTL.briefing)
  return payload
}

export async function topics(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'topics'); if (cached) return cached }
  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const items = all.results as any[]
  const used = new Set<number>()
  const topics: any[] = []

  for (const item of items) {
    if (used.has(item.id)) continue
    const words = tokenize(item.title)
    if (!words.length) continue
    const cluster: any[] = [item]; used.add(item.id)
    for (const other of items) {
      if (used.has(other.id)) continue
      if (words.some((w: string) => other.title?.includes(w))) { cluster.push(other); used.add(other.id) }
    }
    if (cluster.length >= 2) {
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
  if (env.KV) await cacheSet(env.KV, 'topics', result, CACHE_TTL.topics)
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

// KV cache helpers
const CACHE_TTL = {
  list: 60, trending: 120, stats: 300, categories: 300, topics: 600, briefing: 300, detail: 3600,
}

async function cacheGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try { const val = await kv.get(key); return val ? JSON.parse(val) : null } catch { return null }
}

async function cacheSet(kv: KVNamespace, key: string, data: any, ttl: number) {
  try { await kv.put(key, JSON.stringify(data), { expirationTtl: ttl }) } catch {}
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
}

export { cacheGet, cacheSet, CACHE_TTL }