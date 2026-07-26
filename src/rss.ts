import { RSS_SOURCES, type RssSource } from './sources.js'
import { keywordClassify } from './classifier.js'
import { parseRSS, type RssItem } from './parse-rss.js'
import { extractContent } from './analysis.js'
import { normalizeTitle } from './title-norm.js'
import type { D1Database, ExecutionContext } from '@cloudflare/workers-types'

const DEFAULT_MAX = 20

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
    const title = item.title?.trim()
    const link = item.link?.trim()
    if (!title || !link || seen.has(link)) continue
    seen.add(link)

    const rawDesc = (item.contentSnippet || item.content || '').slice(0, 2000)
    const desc = rawDesc.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
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

export async function saveArticles(DB: D1Database, articles: any[], apiKey: string | undefined, ctx: ExecutionContext) {
  if (!articles.length) return 0
  let saved = 0
  const noImgUrls: string[] = []
  const aiBatch: any[] = []
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
      const a = chunk[j]
      if (!a.image) noImgUrls.push(a.url)
      // Collect low-confidence articles for AI refinement (unweighted score was a default guess)
      if (a.lowConfidence) aiBatch.push(a)
    }
  }
  // Background tasks must outlive the response, so attach them to the context
  const background: Promise<unknown>[] = []
  if (noImgUrls.length > 0) background.push(fetchMissingImages(DB, noImgUrls))
  if (apiKey && aiBatch.length > 0) background.push(refineCategories(DB, aiBatch.slice(0, 40), apiKey))
  if (background.length > 0) ctx.waitUntil(Promise.allSettled(background))
  return saved
}

async function refineCategories(DB: D1Database, articles: any[], apiKey: string) {
  const batchSize = 10
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize)
    try {
      const texts = batch.map((a, idx) => `[${idx}] ${a.title}`).join('\n')
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{
            role: 'system',
            content: '你是新闻分类助手。为每篇新闻分配一个分类：AI/科技/财经/国际/政治/健康/体育/娱乐/游戏/教育/社会。只返回JSON数组：[{"index":0,"category":"AI"},...]'
          }, {
            role: 'user',
            content: texts
          }],
          temperature: 0.05,
          max_tokens: 1024,
        }),
      })
      if (!res.ok) continue
      const data = await res.json() as any
      const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      if (!raw) continue
      const results = JSON.parse(raw) as { index: number; category: string }[]
      for (const r of results) {
        const idx = r.index
        if (idx >= 0 && idx < batch.length && r.category && batch[idx].category !== r.category) {
          await DB.prepare('UPDATE news SET category = ? WHERE url = ?').bind(r.category, batch[idx].url).run()
        }
      }
    } catch {}
  }
}

async function fetchMissingImages(DB: D1Database, urls: string[]) {
  const results = await Promise.allSettled(
    urls.slice(0, 15).map(async url => {
      const { image } = await extractContent(url)
      if (image) {
        await DB.prepare('UPDATE news SET image = ? WHERE url = ?').bind(image, url).run()
      }
    })
  )
}
