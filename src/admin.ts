import type { ExecutionContext } from '@cloudflare/workers-types'
import { cacheDelete, CACHE_TTL, cacheSet, cacheGet, signalEvent } from './cache.js'
import { fetchAllRSS, saveArticles } from './rss.js'
import { extractContent, analyzeWithDeepSeek, translateBatch, generateAnswer } from './analysis.js'
import { json, likeEscape, type Env } from './helpers.js'
import { tokenize } from './tokenize.js'
import { generateTodayDigest } from './digest.js'

export async function fetchNews(env: Env, ctx: ExecutionContext) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles, env.DEEPSEEK_API_KEY, ctx)
  if (saved > 0) {
    const deletions = ['trending', 'topics', 'stats', 'categories', 'briefing'].map(k => cacheDelete(k))
    await Promise.allSettled(deletions)
  }
  ctx.waitUntil((async () => {
    await analyzeRecentTop(env).catch(() => 0)
    await generateTodayDigest(env).catch(() => {})
  })())
  // Notify SSE clients
  if (saved > 0) {
    signalEvent('fetch', { count: saved, timestamp: new Date().toISOString() }).catch(() => {})
  }
  return { fetched: saved }
}

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

// 对给定文章逐条跑 AI 分析（提取正文→DeepSeek→写回），返回成功数。
async function analyzeRows(env: Env, rows: any[], apiKey: string): Promise<number> {
  let done = 0
  for (const row of rows) {
    await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
    try {
      const { content: extracted } = await extractContent(row.url)
      const content = (extracted || row.description || row.title).slice(0, 2000)
      const result = await analyzeWithDeepSeek(row.title, content, apiKey)
      if (result) {
        await env.DB.prepare("UPDATE news SET summary=?, entities=?, sentiment=?, category=?, content=COALESCE(?, content), analyzed_at=datetime('now') WHERE id=?")
          .bind(result.summary, JSON.stringify(result.entities), JSON.stringify(result.sentiment), result.category || '科技', extracted, row.id).run()
        done++
      }
    } catch (e: any) {
      console.error('AI analysis failed:', e.message)
    }
  }
  return done
}

// 抓取后优先分析近 2 天高分新文，保证日报/简报候选文有摘要与情感
async function analyzeRecentTop(env: Env, limit = 6): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.warn('DEEPSEEK_API_KEY not set — AI analysis disabled. Add via: npx wrangler pages secret put DEEPSEEK_API_KEY')
    return 0
  }
  const rows = await env.DB.prepare(
    "SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days') ORDER BY score DESC LIMIT ?"
  ).bind(limit).all()
  return analyzeRows(env, rows.results as any[], apiKey)
}

export async function fixImages(env: Env) {
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
  const aiRows = await env.DB.prepare("SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 ORDER BY RANDOM() LIMIT 3").all()
  const apiKey = env.DEEPSEEK_API_KEY
  const aiDone = apiKey ? await analyzeRows(env, aiRows.results as any[], apiKey) : 0
  return { imgFixed, aiDone }
}

// 问答搜索：近 7 天相关报道 → DeepSeek 综合回答
export async function ask(env: Env, q: string): Promise<Response> {
  const query = (q || '').trim()
  if (query.length < 2 || query.length > 60) return json({ error: '问题长度需在 2-60 字之间' }, 400)

  const cacheKey = `ask:${query}`
  { const cached = await cacheGet<any>(cacheKey); if (cached) return json(cached) }

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

  const escTokens = tokens.map(t => likeEscape(t))
  const clauses = tokens.map(() => "(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR entities LIKE ? ESCAPE '\\')").join(' OR ')
  const params = escTokens.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`])
  const rows = await env.DB.prepare(
    `SELECT id, title, title_zh, summary, summary_zh, source, published_at, entities FROM news
     WHERE published_at >= datetime('now', '-7 days')
       AND (${clauses})
     ORDER BY score DESC LIMIT 80`
  ).bind(...params).all()

  const ranked = (rows.results as any[])
    .map(r => {
      const hay = `${r.title || ''} ${r.summary || ''} ${r.entities || ''}`.toLowerCase()
      const hits = tokens.filter(t => hay.includes(t.toLowerCase())).length
      return { ...r, hits }
    })
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 30)
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

  if (!answer) return json({ answer: null, refs: [] })
  const refs = answer.refs.map(i => {
    const c = candidates[i]
    return { ref: i, id: c.id, title: c.title, titleZh: c.title_zh || null, source: c.source }
  })
  const result = { answer: answer.answer, refs }
  await cacheSet(cacheKey, result, CACHE_TTL.ask)
  return json(result)
}
