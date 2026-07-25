import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { fetchAllRSS, saveArticles } from './rss.js'
import { extractContent, analyzeWithDeepSeek, titleSimilarity } from './analysis.js'

type Env = { DB: D1Database; KV?: KVNamespace; DEEPSEEK_API_KEY?: string }

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

export async function listNews(env: Env, url: URL) {
  const category = url.searchParams.get('category')
  const page = parseInt(url.searchParams.get('page') || '1')
  const pageSize = parseInt(url.searchParams.get('pageSize') || '50')
  const offset = (page - 1) * pageSize
  const cacheKey = category && category !== '全部' ? 'list:' + category : 'list:all'

  // Try KV cache
  if (env.KV && page === 1 && pageSize <= 50) {
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
  if (env.KV && page === 1) cacheSet(env.KV, cacheKey, result, CACHE_TTL.list)
  return result
}

export async function trending(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'trending'); if (cached) return cached }
  const items = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 30').all()
  const result = { items: (items.results as any[]).map(mapNews) }
  if (env.KV) cacheSet(env.KV, 'trending', result, CACHE_TTL.trending)
  return result
}

export async function categories(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'categories'); if (cached) return cached }
  const result = await env.DB.prepare('SELECT category as name, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC').all()
  const data = { categories: result.results }
  if (env.KV) cacheSet(env.KV, 'categories', data, CACHE_TTL.categories)
  return data
}

export async function stats(env: Env) {
  if (env.KV) { const cached = await cacheGet<any>(env.KV, 'stats'); if (cached) return cached }
  const [total, today] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as total FROM news").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', 'start of day')").first<{ total: number }>(),
  ])
  const data = { total: total?.total || 0, today: today?.total || 0 }
  if (env.KV) cacheSet(env.KV, 'stats', data, CACHE_TTL.stats)
  return data
}

export async function fetchNews(env: Env) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles, env.DEEPSEEK_API_KEY)
  // Invalidate caches
  if (env.KV && saved > 0) {
    env.KV.delete('list:all').catch(() => {})
    env.KV.delete('trending').catch(() => {})
    env.KV.delete('topics').catch(() => {})
    env.KV.delete('stats').catch(() => {})
    env.KV.delete('categories').catch(() => {})
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
  if (row.entities && row.sentiment && row.analyzed_at && row.analyzed_at !== 'failed') {
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

  return { ...news, analysis: { summary, entities, sentiment, content: null }, related }
}
export async function briefing(env: Env) {
  // Select top 7 articles: diverse sources, recent, high-scoring
  const items = await env.DB.prepare(
    "SELECT * FROM news ORDER BY score DESC, published_at DESC LIMIT 50"
  ).all()

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
      selected.push(mapNews(article))
      usedSources.add(s)
    }
  }

  // Fill remaining from any source
  if (selected.length < 7) {
    for (const s of sources) {
      for (const article of bySource[s] || []) {
        if (selected.length >= 7) break
        if (!selected.find(n => n.id === article.id)) {
          selected.push(mapNews(article))
        }
      }
    }
  }

  // Generate reasons
  const topics = await env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC"
  ).all()
  const topCats = (topics.results as any[]).slice(0, 3).map((r: any) => r.category)

  const result = selected.slice(0, 7).map((item, i) => {
    let reason = ''
    const isTrending = item.score >= 65
    const isHotCat = topCats.includes(item.category)

    if (i === 0) reason = '今日头条 · ' + (isHotCat ? `${item.category}领域最受关注` : '多源报道')
    else if (isTrending && isHotCat) reason = `${item.category}热点 · 同类报道较多`
    else if (item.score >= 70) reason = '高关注度 · 读者广泛讨论'
    else if (item.category === 'AI') reason = 'AI 赛道 · 持续受关注'
    else if (item.score >= 60) reason = `${item.category} · 值得关注`
    else reason = `${item.category}领域 · 信息增量`

    return { ...item, reason }
  })

  return { items: result }
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
      const bestItem = cluster.sort((a: any, b: any) => (b.summary?.length || 0) - (a.summary?.length || 0))[0]
      const narrative = bestItem?.summary
        ? bestItem.summary.slice(0, 300)
        : (cluster[0]?.description || '').slice(0, 200) + '...'

      topics.push({
        keyword: words.slice(0, 3).join(' · '),
        count: cluster.length,
        sources: [...new Set(cluster.map(i => i.source))],
        sourcePerspectives,
        dateRange,
        narrative: narrative.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        items: cluster.slice(0, 5),
      })
    }
  }
  topics.sort((a, b) => b.count - a.count)
  const result = { topics: topics.slice(0, 15).map((t: any) => ({ ...t, items: t.items.map(mapNews) })) }
  if (env.KV) cacheSet(env.KV, 'topics', result, CACHE_TTL.topics)
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
  'ScienceDaily': '科学', 'Space.com': '科学', 'MIT Tech Review': 'AI',
  'NPR': '综合', 'BBC Tech': '综合',
}

export async function entitySearch(env: Env, name: string) {
  const items = await env.DB.prepare("SELECT * FROM news WHERE title LIKE ? OR description LIKE ? ORDER BY score DESC LIMIT 30").bind(`%${name}%`, `%${name}%`).all()
  return { items: (items.results as any[]).map(mapNews), entity: name }
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
  // AI analysis (up to 3 articles)
  const aiRows = await env.DB.prepare("SELECT id, title, description FROM news WHERE analyzed_at IS NULL ORDER BY RANDOM() LIMIT 3").all()
  let aiDone = 0
  const apiKey = env.DEEPSEEK_API_KEY
  if (apiKey && aiRows.results.length > 0) {
    for (const row of (aiRows.results as any[])) {
      try {
        const content = (row.description || row.title).slice(0, 2000)
        const result = await analyzeWithDeepSeek(row.title, content, apiKey)
        if (result) {
          await env.DB.prepare("UPDATE news SET summary=?, entities=?, sentiment=?, category=?, analyzed_at=datetime('now') WHERE id=?")
            .bind(result.summary, JSON.stringify(result.entities), JSON.stringify(result.sentiment), result.category || '科技', row.id).run()
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
  list: 60, trending: 120, stats: 300, categories: 300, topics: 600, detail: 3600,
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