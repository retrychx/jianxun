import { RSS_SOURCES, type RssSource } from './sources.js'
import { keywordClassify } from './classifier.js'
import { parseRSS, type RssItem } from './parse-rss.js'
import type { D1Database } from '@cloudflare/workers-types'

const MAX_PER_SOURCE = 20

function extractImage(item: RssItem): string | null {
  if (item.mediaContent) return item.mediaContent
  if (item.mediaThumbnail) return item.mediaThumbnail
  if (item.enclosureUrl && item.enclosureType?.startsWith('image')) return item.enclosureUrl
  if (item.content) {
    const m = item.content.match(/<img[^>]+src=["']([^"']+)["']/)
    if (m) return m[1]
  }
  return null
}

export async function fetchAllRSS(DB: D1Database) {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(source => fetchOne(source, DB))
  )

  const all: any[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}

async function fetchOne(source: RssSource, DB: D1Database) {
  const feed = await parseRSS(source.url)
  if (!feed.items.length) return []

  const results: any[] = []

  for (const item of feed.items) {
    if (results.length >= MAX_PER_SOURCE) break
    const title = item.title?.trim()
    const link = item.link?.trim()
    if (!title || !link) continue

    const existing = await DB.prepare('SELECT id FROM news WHERE url = ?').bind(link).first()
    if (existing) continue

    const desc = (item.contentSnippet || item.content || '').slice(0, 2000)
    const { category, score } = keywordClassify(title, desc, source.lang)

    results.push({
      title,
      url: link,
      image: extractImage(item),
      source: source.name,
      lang: source.lang,
      description: desc,
      publishedAt: item.isoDate ? new Date(item.isoDate) : null,
      category,
      score,
    })
  }

  return results
}

export async function saveArticles(DB: D1Database, articles: any[]) {
  if (!articles.length) return 0
  let saved = 0
  for (const a of articles) {
    try {
      await DB.prepare(
        'INSERT INTO news (title, url, image, source, lang, description, published_at, category, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        a.title, a.url, a.image, a.source, a.lang, a.description,
        a.publishedAt?.toISOString() || null, a.category, a.score
      ).run()
      saved++
    } catch (e) {
      // duplicate URL
    }
  }
  return saved
}
