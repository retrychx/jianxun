import { RSS_SOURCES, type RssSource } from './sources.js'
import { keywordClassify } from './classifier.js'
import { parseRSS, type RssItem } from './parse-rss.js'
import { normalizeTitle } from './title-norm.js'
import type { D1Database } from '@cloudflare/workers-types'

const DEFAULT_MAX = 20

/** 解码 HTML 实体（RSS 原文常含 &#8217;、&amp; 等；源头解码，避免存库/生成文本带原始实体） */
function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
}

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
  const statUpdates: Promise<unknown>[] = []
  results.forEach((r, i) => {
    const name = RSS_SOURCES[i].name
    if (r.status === 'fulfilled') {
      all.push(...r.value)
      statUpdates.push(DB.prepare(
        "INSERT INTO source_stats (source, last_ok) VALUES (?, datetime('now')) ON CONFLICT(source) DO UPDATE SET last_ok = datetime('now'), last_error = NULL, fail_count = 0"
      ).bind(name).run())
    } else {
      statUpdates.push(DB.prepare(
        "INSERT INTO source_stats (source, last_error, fail_count) VALUES (?, datetime('now'), 1) ON CONFLICT(source) DO UPDATE SET last_error = datetime('now'), fail_count = fail_count + 1"
      ).bind(name).run())
    }
  })
  // Health stats must not break fetching
  await Promise.allSettled(statUpdates)
  // Age out stale failures: reset fail_count for sources whose last error was >7 days ago
  await DB.prepare("UPDATE source_stats SET fail_count = 0 WHERE last_error IS NOT NULL AND last_error < datetime('now', '-7 days')").run().catch(() => {})
  return all
}

async function fetchOne(source: RssSource, DB: D1Database) {
  const feed = await parseRSS(source.url)
  if (!feed.items.length) return []

  const maxItems = source.limit || DEFAULT_MAX
  const candidates: any[] = []
  const seen = new Set<string>()

  for (const item of feed.items) {
    if (candidates.length >= maxItems) break
    const title = decodeHtml(item.title?.trim() || '')
    const link = item.link?.trim()
    if (!title || !link || seen.has(link)) continue
    seen.add(link)

    const rawDesc = (item.contentSnippet || item.content || '').slice(0, 2000)
    const desc = decodeHtml(rawDesc.replace(/<[^>]+>/g, ''))
    const { category, score } = keywordClassify(title, desc, source.lang)

    candidates.push({
      title,
      titleNorm: normalizeTitle(title),
      url: link,
      image: extractImage(item),
      source: source.name,
      lang: source.lang,
      description: desc,
      publishedAt: item.isoDate ? new Date(item.isoDate) : null,
      category,
      // UGC/SEO-heavy sources get their keyword score discounted
      score: Math.round(score * (source.weight ?? 1)),
      // score=50 before weighting means the classifier made a default guess
      lowConfidence: score === 50,
    })
  }

  // Batch dedup: one IN query per chunk (D1 allows at most 100 bound params)
  const existing = new Set<string>()
  for (let i = 0; i < candidates.length; i += 100) {
    const urls = candidates.slice(i, i + 100).map(c => c.url)
    const rows = await DB.prepare(
      `SELECT url FROM news WHERE url IN (${urls.map(() => '?').join(',')})`
    ).bind(...urls).all()
    for (const row of rows.results as any[]) existing.add(row.url)
  }

  return candidates.filter(c => !existing.has(c.url))
}

export async function saveArticles(DB: D1Database, articles: any[]) {
  if (!articles.length) return 0
  let saved = 0
  // Chunked batch inserts (INSERT OR IGNORE survives duplicate URLs and same-title variants)
  for (let i = 0; i < articles.length; i += 100) {
    const chunk = articles.slice(i, i + 100)
    const results = await DB.batch(chunk.map(a => DB.prepare(
      'INSERT OR IGNORE INTO news (title, title_norm, url, image, source, lang, description, published_at, category, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      a.title, a.titleNorm, a.url, a.image, a.source, a.lang, a.description,
      a.publishedAt?.toISOString() || null, a.category, a.score
    )))
    for (let j = 0; j < results.length; j++) {
      if (!results[j].meta?.changes) continue
      saved++
    }
  }
  return saved
}
