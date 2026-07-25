import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { D1Database } from '@cloudflare/workers-types'
import { RSS_SOURCES } from '../src/sources.js'
import { fetchAllRSS, saveArticles } from '../src/rss.js'
import { keywordClassify } from '../src/classifier.js'
import { extractContent, analyzeWithDeepSeek, titleSimilarity } from '../src/analysis.js'

type Bindings = { DB: D1Database; DEEPSEEK_API_KEY?: string }

const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors())

// ─── News list ───
app.get('/api/news', async (c) => {
  const category = c.req.query('category')
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = parseInt(c.req.query('pageSize') || '50')
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

  query += ' ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const [items, totalResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>(),
  ])

  return c.json({ items: items.results, total: totalResult?.total || 0, page, pageSize })
})

// ─── Trending ───
app.get('/api/news/trending', async (c) => {
  const items = await c.env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 30').all()
  return c.json({ items: items.results })
})

// ─── Categories ───
app.get('/api/news/categories', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT category, COUNT(*) as count FROM news GROUP BY category ORDER BY count DESC'
  ).all()
  return c.json({ categories: result.results })
})

// ─── Stats ───
app.get('/api/news/stats', async (c) => {
  const [total, today] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as total FROM news').first<{ total: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as total FROM news WHERE created_at >= datetime('now', 'start of day')").first<{ total: number }>(),
  ])
  return c.json({ total: total?.total || 0, today: today?.total || 0 })
})

// ─── Topics (clustering) ───
app.get('/api/news/topics', async (c) => {
  const all = await c.env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const items = all.results as any[]
  const used = new Set<number>()
  const topics: { keyword: string; count: number; sources: string[]; items: any[] }[] = []

  for (const item of items) {
    if (used.has(item.id)) continue
    const words = tokenizeSimple(item.title)
    if (!words.length) continue
    const cluster: any[] = [item]
    used.add(item.id)

    for (const other of items) {
      if (used.has(other.id)) continue
      if (words.some((w: string) => other.title?.includes(w))) {
        cluster.push(other)
        used.add(other.id)
      }
    }

    if (cluster.length >= 2) {
      topics.push({
        keyword: words.slice(0, 3).join(' · '),
        count: cluster.length,
        sources: [...new Set(cluster.map(i => i.source))],
        items: cluster.slice(0, 5),
      })
    }
  }

  topics.sort((a, b) => b.count - a.count)
  return c.json({ topics: topics.slice(0, 15) })
})

function tokenizeSimple(text: string): string[] {
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

// ─── Detail + Analysis ───
app.get('/api/news/:id/detail', async (c) => {
  const id = parseInt(c.req.param('id'))
  const news = await c.env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(id).first<any>()
  if (!news) return c.json({ message: 'Not Found' }, 404)

  // Extract content + image (lazy)
  const { content, image } = await extractContent(news.url)
  if (image && !news.image) {
    await c.env.DB.prepare('UPDATE news SET image = ? WHERE id = ?').bind(image, id).run()
    news.image = image
  }

  // Try AI analysis
  let summary = news.description?.slice(0, 200) + '...'
  let entities: any[] = []
  let sentiment: any = null

  const apiKey = c.env.DEEPSEEK_API_KEY
  if (apiKey && content) {
    const result = await analyzeWithDeepSeek(news.title, content, apiKey)
    if (result) {
      summary = result.summary
      entities = result.entities
      sentiment = result.sentiment
    }
  }

  // Related articles
  const words = tokenizeSimple(news.title)
  let related: any[] = []
  if (words.length) {
    const clauses = words.map((_: string, i: number) => `title LIKE ?`)
    const params = words.map((w: string) => `%${w}%`)
    const candidates = await c.env.DB.prepare(
      `SELECT * FROM news WHERE id != ? AND (${clauses.join(' OR ')}) ORDER BY score DESC LIMIT 10`
    ).bind(id, ...params).all()

    related = (candidates.results as any[])
      .map((n: any) => ({ ...n, sim: titleSimilarity(news.title, n.title) }))
      .filter((n: any) => n.sim > 0.15)
      .sort((a: any, b: any) => b.sim - a.sim)
      .slice(0, 5)
    related.forEach((r: any) => delete r.sim)
  }

  return c.json({
    ...news,
    analysis: { summary, entities, sentiment, content: content?.slice(0, 3000) || null },
    related,
  })
})

// ─── Entity search ───
app.get('/api/news/entity/:name', async (c) => {
  const name = c.req.param('name')
  const items = await c.env.DB.prepare(
    'SELECT * FROM news WHERE title LIKE ? OR description LIKE ? ORDER BY score DESC LIMIT 30'
  ).bind(`%${name}%`, `%${name}%`).all()
  return c.json({ items: items.results, entity: name })
})

// ─── Fetch RSS ───
app.get('/api/news/fetch', async (c) => {
  const articles = await fetchAllRSS(c.env.DB)
  const saved = await saveArticles(c.env.DB, articles)
  return c.json({ fetched: saved })
})

// ─── Hello ───
app.get('/api/hello', (c) => {
  return c.json({ messages: [{ id: 1, text: 'Hello from 简讯!', timestamp: new Date().toISOString() }] })
})

// Export for Cloudflare Pages
export default {
  fetch: app.fetch,
}
