import Parser from 'rss-parser'
import { RSS_SOURCES, type RssSource } from './sources.js'
import { keywordClassify } from './classifier.js'
import type { D1Database } from '@cloudflare/workers-types'

const MAX_PER_SOURCE = 20

type FeedItem = {
  title?: string
  link?: string
  contentSnippet?: string
  content?: string
  pubDate?: string
  isoDate?: string
  'media:content'?: { $: { url: string } }
  'media:thumbnail'?: { $: { url: string } }
  enclosure?: { url: string; type: string }
}

const parser = new Parser({
  timeout: 15_000,
  headers: { 'User-Agent': 'Mozilla/5.0 NewsBot/1.0' },
  customFields: { item: ['media:content', 'media:thumbnail', 'enclosure'] },
})

function extractImage(item: FeedItem): string | null {
  const mc = item['media:content']; if (mc?.$?.url) return mc.$.url
  const mt = item['media:thumbnail']; if (mt?.$?.url) return mt.$.url
  const enc = item.enclosure; if (enc?.url && enc.type?.startsWith('image')) return enc.url
  const content = item.content || ''
  const m = content.match(/<img[^>]+src=["']([^"']+)["']/)
  return m?.[1] || null
}

export async function fetchAllRSS(DB: D1Database) {
  const all: { title: string; url: string; image: string | null; source: string; lang: string; description: string; publishedAt: Date | null; category: string; score: number }[] = []

  for (const source of RSS_SOURCES) {
    try {
      const items = await fetchOne(source, DB)
      all.push(...items)
    } catch (e) {
      console.warn(`[${source.name}] ${(e as Error).message}`)
    }
  }

  return all
}

async function fetchOne(source: RssSource, DB: D1Database) {
  const feed = await parser.parseURL(source.url)
  if (!feed.items?.length) return []

  const results: typeof all = []

  for (const item of feed.items as FeedItem[]) {
    if (results.length >= MAX_PER_SOURCE) break
    const title = item.title?.trim()
    const link = item.link?.trim()
    if (!title || !link) continue

    // Dedup
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

export async function saveArticles(DB: D1Database, articles: typeof all) {
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
