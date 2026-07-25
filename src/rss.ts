import { RSS_SOURCES, type RssSource } from './sources.js'
import { keywordClassify } from './classifier.js'
import { parseRSS, type RssItem } from './parse-rss.js'
import { extractContent, analyzeWithDeepSeek } from './analysis.js'
import type { D1Database } from '@cloudflare/workers-types'

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
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}

async function fetchOne(source: RssSource, DB: D1Database) {
  const feed = await parseRSS(source.url)
  if (!feed.items.length) return []

  const maxItems = source.limit || DEFAULT_MAX
  const results: any[] = []

  for (const item of feed.items) {
    if (results.length >= maxItems) break
    const title = item.title?.trim()
    const link = item.link?.trim()
    if (!title || !link) continue

    const existing = await DB.prepare('SELECT id FROM news WHERE url = ?').bind(link).first()
    if (existing) continue

    const rawDesc = (item.contentSnippet || item.content || '').slice(0, 2000)
    const desc = rawDesc.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
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

export async function saveArticles(DB: D1Database, articles: any[], apiKey?: string) {
  if (!articles.length) return 0
  let saved = 0
  const noImgUrls: string[] = []
  const aiBatch: any[] = []
  for (const a of articles) {
    try {
      await DB.prepare(
        'INSERT INTO news (title, url, image, source, lang, description, published_at, category, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        a.title, a.url, a.image, a.source, a.lang, a.description,
        a.publishedAt?.toISOString() || null, a.category, a.score
      ).run()
      saved++
      if (!a.image) noImgUrls.push(a.url)
      // Collect low-confidence articles for AI refinement (score=50 = default guess)
      if (a.score === 50) aiBatch.push(a)
    } catch (e) {
      // duplicate URL
    }
  }
  // Background: fetch OG images
  if (noImgUrls.length > 0) {
    fetchMissingImages(DB, noImgUrls).catch(() => {})
  }
  // Background: AI refine low-confidence articles (max 40)
  if (aiBatch.length > 0) {
    refineCategories(DB, aiBatch.slice(0, 40)).catch(() => {})
  }
  return saved
}

async function refineCategories(DB: D1Database, articles: any[]) {
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
