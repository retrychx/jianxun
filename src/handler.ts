import type { D1Database } from '@cloudflare/workers-types'
import { fetchAllRSS, saveArticles } from './rss.js'
import { extractContent, analyzeWithDeepSeek, titleSimilarity } from './analysis.js'

type Env = { DB: D1Database; DEEPSEEK_API_KEY?: string }

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
  return { items: (items.results as any[]).map(mapNews), total: totalResult?.total || 0, page, pageSize }
}

export async function trending(env: Env) {
  const items = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 30').all()
  return { items: (items.results as any[]).map(mapNews) }
}

export async function categories(env: Env) {
  const result = await env.DB.prepare('SELECT category as name, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC').all()
  return { categories: result.results }
}

export async function stats(env: Env) {
  const [total, today] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as total FROM news").first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', 'start of day')").first<{ total: number }>(),
  ])
  return { total: total?.total || 0, today: today?.total || 0 }
}

export async function fetchNews(env: Env) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles, env.DEEPSEEK_API_KEY)
  return { fetched: saved }
}

export async function detail(env: Env, id: number) {
  const row = await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first<any>()
  if (!row) return null
  const news = mapNews(row)

  const { content, image } = await extractContent(news.url)
  if (image && !news.image) {
    await env.DB.prepare('UPDATE news SET image = ? WHERE id = ?').bind(image, id).run()
    news.image = image
  }

  let summary = news.description?.slice(0, 200) + '...'
  let entities: any[] = []
  let sentiment: any = null

  if (env.DEEPSEEK_API_KEY && content) {
    const result = await analyzeWithDeepSeek(news.title, content, env.DEEPSEEK_API_KEY)
    if (result) {
      summary = result.summary; entities = result.entities; sentiment = result.sentiment
      if (result.category && result.category !== news.category) {
        news.category = result.category
        env.DB.prepare('UPDATE news SET category = ? WHERE id = ?').bind(result.category, id).run()
      }
    }
  }

  const words = tokenize(news.title)
  let related: any[] = []
  if (words.length) {
    const clauses = words.map((_: string, i: number) => `title LIKE ?`)
    const params = words.map((w: string) => `%${w}%`)
    const candidates = await env.DB.prepare(`SELECT * FROM news WHERE id != ? AND (${clauses.join(' OR ')}) ORDER BY score DESC LIMIT 10`).bind(id, ...params).all()
    related = (candidates.results as any[]).map(mapNews).map((n: any) => ({ ...n, sim: titleSimilarity(news.title, n.title) })).filter((n: any) => n.sim > 0.15).sort((a: any, b: any) => b.sim - a.sim).slice(0, 5)
    related.forEach((r: any) => delete r.sim)
  }

  return { ...news, analysis: { summary, entities, sentiment, content: content?.slice(0, 3000) || null }, related }
}

export async function topics(env: Env) {
  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const items = all.results as any[]
  const used = new Set<number>()
  const topics: { keyword: string; count: number; sources: string[]; items: any[] }[] = []

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
      topics.push({ keyword: words.slice(0, 3).join(' · '), count: cluster.length, sources: [...new Set(cluster.map(i => i.source))], items: cluster.slice(0, 5) })
    }
  }
  topics.sort((a, b) => b.count - a.count)
  return { topics: topics.slice(0, 15).map(t => ({ ...t, items: t.items.map(mapNews) })) }
}

export async function entitySearch(env: Env, name: string) {
  const items = await env.DB.prepare("SELECT * FROM news WHERE title LIKE ? OR description LIKE ? ORDER BY score DESC LIMIT 30").bind(`%${name}%`, `%${name}%`).all()
  return { items: (items.results as any[]).map(mapNews), entity: name }
}

export async function fixImages(env: Env) {
  const rows = await env.DB.prepare("SELECT id, url FROM news WHERE image IS NULL ORDER BY id DESC LIMIT 50").all()
  let updated = 0
  const results = await Promise.allSettled(
    (rows.results as any[]).map(async (row: any) => {
      const { image } = await extractContent(row.url)
      if (image) {
        await env.DB.prepare('UPDATE news SET image = ? WHERE id = ?').bind(image, row.id).run()
        return true
      }
      return false
    })
  )
  updated = results.filter(r => r.status === 'fulfilled' && r.value).length
  return { updated, total: (rows.results as any[]).length }
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
}
