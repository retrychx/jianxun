import type { ExecutionContext } from '@cloudflare/workers-types'
import { cacheDelete, CACHE_TTL, cacheSet, cacheGet, signalEvent } from '../cache.js'
import { fetchAllRSS, saveArticles } from '../rss.js'
import { generateAnswer } from '../analysis.js'
import { json, likeEscape, type Env } from '../helpers.js'
import { tokenize } from '../tokenize.js'

/** Fetch latest RSS articles, save new ones, then launch the full AI agent pipeline. */
export async function fetchNews(env: Env, ctx: ExecutionContext) {
  const articles = await fetchAllRSS(env.DB)
  const saved = await saveArticles(env.DB, articles)
  if (saved > 0) {
    const deletions = ['trending', 'topics', 'stats', 'categories', 'briefing'].map(k => cacheDelete(k))
    await Promise.allSettled(deletions)
  }

  // 记录抓取结果供 /api/news/status 观测（cron 抓取健康度）
  await env.DB.prepare(
    "INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_fetch', ?)"
  ).bind(JSON.stringify({ ts: new Date().toISOString(), fetched: saved })).run().catch(() => {})

  // Launch the unified intelligence agent as a background task
  ctx.waitUntil((async () => {
    const { runAgent } = await import('../agent/index.js')
    await runAgent(env).catch((e: any) => console.error('[fetchNews] agent crashed:', e?.message))
  })())

  // Notify SSE clients
  if (saved > 0) {
    signalEvent('fetch', { count: saved, timestamp: new Date().toISOString() }).catch(() => {})
  }
  return { fetched: saved }
}

/** Manually save AI analysis for an article (admin POST /api/news/:id/detail). */
export async function saveAnalysis(env: Env, id: number, body: any) {
  try {
    const { summary, category, entities, sentiment } = body
    // 归一化实体：管理端传入的 string[] 转成与 AI 管线一致的对象数组，
    // 避免同一字段两种结构导致前端解析/排序混乱
    const normEntities = (Array.isArray(entities) ? entities : []).map((e: any) =>
      typeof e === 'string' ? { name: e, type: 'concept', weight: 0.5 } : e
    )
    await env.DB.prepare(
      "UPDATE news SET summary=?, entities=?, sentiment=?, category=COALESCE(?,category), analyzed_at=datetime('now') WHERE id=?"
    ).bind(summary || null, JSON.stringify(normEntities), JSON.stringify(sentiment || {}), category || null, id).run()
    return { ok: true }
  } catch {
    // 不返回 e.message——可能泄露 SQL/内部结构
    return { ok: false, error: '分析保存失败' }
  }
}

// ─── AI Q&A (standalone, not part of the pipeline) ─────────────

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
