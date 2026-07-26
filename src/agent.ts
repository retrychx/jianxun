/**
 * News Intelligence Agent — unified AI processing pipeline.
 *
 * Runs as a single ctx.waitUntil task after each fetchNews(), orchestrating:
 *   1. fixMissingImages    — fetch OG images for articles without one
 *   2. analyzeNewArticles  — enhanced AI analysis (summary, entities, sentiment, keyPoints, etc.)
 *   3. refineCategories    — DeepSeek batch reclassify low-confidence articles
 *   4. translateMissing    — English→Chinese batch translation
 *   5. crossRefAnalysis    — compare same-story coverage across sources
 *   6. generateDailyDigest — AI daily digest
 *   7. updateNarratives    — cross-cycle story tracking
 *   8. detectBreakingNews  — flag high-significance multi-source stories
 *   9. linkEntities        — canonicalize entity names across articles
 *  10. tuneSourceWeights   — auto-adjust source weights from failure patterns
 *
 * Each phase is also exported individually for standalone admin endpoints.
 *
 * Hardening features:
 *  - Circuit breaker: pings DeepSeek once before starting AI phases
 *  - Per-phase timeout (30s) prevents stuck calls from blocking the pipeline
 *  - Structured logging: each phase records duration, success/failure, and reason
 *  - Concurrency guard: skips if the agent ran within the last 5 minutes
 *  - All phases degrade gracefully: a single phase failure never kills the pipeline
 */

import type { ExecutionContext } from '@cloudflare/workers-types'
import { cacheDelete, signalEvent } from './cache.js'
import { DEEPSEEK_MODEL, fetchWithRetry } from './analysis.js'
import {
  extractContent,
  analyzeWithDeepSeek,
  translateBatch,
  crossRefAnalysis,
  generateAnswer,
  generateTopicLabels,
  type DeepSeekResult,
  type AnalysisDetail,
  type CrossRefResult,
} from './analysis.js'
import { tokenize } from './tokenize.js'
import { clusterNews } from './topics.js'
import { fallbackLabel, likeEscape, type Env } from './helpers.js'
import { generateTodayDigest } from './digest.js'

// ─── Orchestrator ──────────────────────────────────────────────

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return

  // Concurrency guard: skip if agent ran within the last 5 minutes
  const lastRun = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
  if (lastRun?.value) {
    const elapsed = Date.now() - new Date(lastRun.value).getTime()
    if (elapsed < 300_000) { /* 5 min */ return }
  }

  // Circuit breaker: cheap ping to verify DeepSeek is responding
  const apiOk = await pingDeepSeek(apiKey)
  const skipAi = !apiOk

  // Run phases with timeout + structured logging.
  // Independent phases run in parallel groups; dependent phases wait.
  const results: Record<string, any> = {}

  // ── Group 1: fully independent (no cross-dependencies, no analysis dependency) ──
  const [
    r1,    // fixMissingImages
    r2,    // analyzeNewArticles (critical path — everything downstream needs AI)
    r3,    // refineCategories
    r4,    // translateMissing
    r10,   // tuneSourceWeights
  ] = await Promise.allSettled([
    runPhase('fixMissingImages', () => fixMissingImages(env)),
    skipAi
      ? Promise.resolve({ ok: true, result: 0, ms: 0 })
      : runPhase('analyzeNewArticles', () => analyzeNewArticles(env), 45_000),
    skipAi
      ? Promise.resolve({ ok: true, result: { refined: 0 }, ms: 0 })
      : runPhase('refineCategories', () => refineCategories(env), 30_000),
    skipAi
      ? Promise.resolve({ ok: true, result: { translated: 0 }, ms: 0 })
      : runPhase('translateMissing', () => translateMissing(env), 30_000),
    runPhase('tuneSourceWeights', () => tuneSourceWeights(env), 10_000),
  ])

  // Unwrap results
  for (const [key, r] of [['fixMissingImages', r1], ['analyzeNewArticles', r2], ['refineCategories', r3], ['translateMissing', r4], ['tuneSourceWeights', r10]] as const) {
    results[key] = r.status === 'fulfilled' ? r.value : { ok: false, error: 'Promise rejected', ms: 0 }
  }

  // ── Group 2: depend on analyzeNewArticles having completed ──
  const analysisDone = r2.status === 'fulfilled' && r2.value?.ok !== false

  const [
    r5,   // crossRefAnalysis
    r6,   // generateDailyDigest
    r7,   // updateNarratives
    r8,   // detectBreakingNews
    r9,   // linkEntities
  ] = await Promise.allSettled([
    analysisDone && !skipAi
      ? runPhase('crossRefAnalysis', () => runCrossRefAnalysis(env), 30_000)
      : Promise.resolve({ ok: true, result: { crossRefs: 0 }, ms: 0 }),
    runPhase('generateDailyDigest', () => generateTodayDigest(env), 30_000),
    runPhase('updateNarratives', () => updateNarratives(env), 30_000),
    analysisDone
      ? runPhase('detectBreakingNews', () => detectBreakingNews(env), 15_000)
      : Promise.resolve({ ok: true, result: { breaking: 0 }, ms: 0 }),
    analysisDone
      ? runPhase('linkEntities', () => linkEntities(env), 15_000)
      : Promise.resolve({ ok: true, result: { linked: 0 }, ms: 0 }),
  ])

  for (const [key, r] of [['crossRefAnalysis', r5], ['generateDailyDigest', r6], ['updateNarratives', r7], ['detectBreakingNews', r8], ['linkEntities', r9]] as const) {
    results[key] = r.status === 'fulfilled' ? r.value : { ok: false, error: 'Promise rejected', ms: 0 }
  }

  // Record agent run log
  const totalMs = Date.now() - start
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)`
    ).bind(new Date().toISOString()).run()
    await env.DB.prepare(
      `INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_log', ?)`
    ).bind(JSON.stringify({ ts: new Date().toISOString(), totalMs, skipAi, results })).run()
  } catch {}
}

// ─── Utilities ─────────────────────────────────────────────────

/** Per-phase timeout wrapper + structured logging. */
async function runPhase<T>(name: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<{ ok: boolean; result?: T; error?: string; ms: number }> {
  const start = Date.now()
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
    const ms = Date.now() - start
    console.log(`[agent] ${name} ok ${ms}ms`)
    return { ok: true, result, ms }
  } catch (err: any) {
    const ms = Date.now() - start
    const msg = err?.message || err?.toString() || 'unknown error'
    console.error(`[agent] ${name} FAIL ${ms}ms: ${msg.slice(0, 200)}`)
    return { ok: false, error: msg.slice(0, 200), ms }
  }
}

/** Ping DeepSeek with a minimal request to verify the API is responsive. */
async function pingDeepSeek(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    console.error('[agent] DeepSeek ping failed — skipping AI phases')
    return false
  }
}

// ===================================================================
// Phase 1 — fixMissingImages
// ===================================================================

/** Fetch OG images for articles that have none. Exported for POST /api/news/fix-images. */
export async function fixMissingImages(env: Env) {
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
  return { imgFixed }
}

// ===================================================================
// Phase 2 — analyzeNewArticles (enhanced)
// ===================================================================

/** Analyze recent high-score articles with enhanced DeepSeek prompt.
 *  Exported for admin endpoints.  Stores summary/entities/sentiment
 *  into existing columns, plus analysis_detail JSON for new fields. */
export async function analyzeNewArticles(env: Env, limit = 6): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 0

  const rows = await env.DB.prepare(
    "SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days') ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<any>()
  const articles = rows.results || []

  let done = 0
  for (const row of articles) {
    await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
    try {
      const { content: extracted, title: pageTitle } = await extractContent(row.url)
      const content = (extracted || row.description || row.title).slice(0, 2000)
      const result = await analyzeWithDeepSeek(row.title, content, apiKey, pageTitle)
      if (result) {
        await env.DB.prepare(
          `UPDATE news SET summary=?, entities=?, sentiment=?, category=?, content=COALESCE(?, content),
             analyzed_at=datetime('now'), analysis_detail=?
           WHERE id=?`
        ).bind(
          result.base.summary,
          JSON.stringify(result.base.entities),
          JSON.stringify(result.base.sentiment),
          result.base.category || '科技',
          extracted,
          JSON.stringify(result.detail),
          row.id,
        ).run()
        done++
      }
    } catch {}
  }
  return done
}

// ===================================================================
// Phase 3 — refineCategories
// ===================================================================

/** DeepSeek batch reclassify low-confidence articles.  Exported for admin endpoints. */
export async function refineCategories(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { refined: 0 }

  const rows = await env.DB.prepare(
    "SELECT id, title, url FROM news WHERE category = '科技' AND score = 50 AND analyze_attempts > 0 ORDER BY RANDOM() LIMIT 40"
  ).all<any>()
  const batch = rows.results || []
  if (!batch.length) return { refined: 0 }

  let refined = 0
  for (let i = 0; i < batch.length; i += 10) {
    const chunk = batch.slice(i, i + 10)
    try {
      const texts = chunk.map((a: any, idx: number) => `[${idx}] ${a.title}`).join('\n')
      const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
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
      if (!res?.ok) continue
      const data = await res.json() as any
      const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      if (!raw) continue
      const results = JSON.parse(raw) as { index: number; category: string }[]
      for (const r of results) {
        if (r.index >= 0 && r.index < chunk.length && r.category && chunk[r.index].category !== r.category) {
          await env.DB.prepare('UPDATE news SET category = ? WHERE id = ?').bind(r.category, chunk[r.index].id).run()
          refined++
        }
      }
    } catch {}
  }
  return { refined }
}

// ===================================================================
// Phase 4 — translateMissing
// ===================================================================

/** Batch-translate English titles/summaries to Chinese. Exported for POST /api/news/translate. */
export async function translateMissing(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { translated: 0 }
  const rows = await env.DB.prepare(
    "SELECT id, title, summary, description FROM news WHERE lang = 'en' AND title_zh IS NULL ORDER BY score DESC LIMIT 10"
  ).all<any>()
  if (!rows.results?.length) return { translated: 0 }
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

// ===================================================================
// Phase 5 — crossRefAnalysis (NEW)
// ===================================================================

/** Detect same-story articles across multiple sources and generate
 *  angle comparisons.  Results are stored as cross-reference narratives. */
export async function runCrossRefAnalysis(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { crossRefs: 0 }

  // Find recently analyzed articles grouped by title_norm duplicates
  const rows = await env.DB.prepare(
    `SELECT id, title, title_norm, summary, source FROM news
     WHERE analyzed_at >= datetime('now', '-2 days') AND title_norm IS NOT NULL
     ORDER BY title_norm, score DESC`
  ).all<any>()
  const articles = rows.results || []
  if (articles.length < 4) return { crossRefs: 0 }

  // Group by title_norm
  const groups = new Map<string, any[]>()
  for (const a of articles) {
    const key = a.title_norm || a.title
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }

  // Filter to groups with ≥2 different sources
  const multiSource: { source: string; title: string; summary: string }[][] = []
  for (const [, group] of groups) {
    const uniqueSources = [...new Set(group.map((a: any) => a.source))]
    if (uniqueSources.length >= 2) {
      multiSource.push(group.map((a: any) => ({ source: a.source, title: a.title, summary: a.summary || '' })))
    }
  }

  if (!multiSource.length) return { crossRefs: 0 }

  const results = await crossRefAnalysis(multiSource.slice(0, 5), apiKey)
  if (!results) return { crossRefs: 0 }

  // Store as cross-reference entries in narratives table
  let stored = 0
  for (const ref of results) {
    const keyword = `__cross__${ref.keyword.slice(0, 40)}`
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO narratives (keyword, label, first_seen, last_updated, status, summary, developments, article_ids, source_stats)
         VALUES (?, ?, date('now'), datetime('now'), 'active', ?, ?, ?, ?)`
      ).bind(
        keyword,
        `📍 ${ref.keyword}`,
        ref.comparison.slice(0, 300),
        JSON.stringify([{ date: new Date().toISOString().slice(0, 10), text: ref.comparison, articleCount: ref.sources.length, sources: ref.sources.map(s => s.name) }]),
        JSON.stringify(ref.articleIds),
        JSON.stringify(Object.fromEntries(ref.sources.map(s => [s.name, 1]))),
      ).run()
      stored++
    } catch {}
  }
  return { crossRefs: stored }
}

// ===================================================================
// Phase 7 — updateNarratives (from previous agent.ts)
// ===================================================================

// ─── Narrative types and constants ──────────────────────────────

const MATCH_THRESHOLD = 0.1
const MIN_CLUSTER_SIZE = 3
const STALE_DAYS = 7
const ARCHIVE_DAYS = 14

interface Narrative {
  id: number
  keyword: string
  label: string | null
  first_seen: string
  last_updated: string
  status: string
  summary: string | null
  developments: string
  article_ids: string
  source_stats: string
}

/** Core narrative tracking logic. */
async function updateNarratives(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return

  const lastRun = await getLastAgentRun(env)
  const narratives = await loadActiveNarratives(env)

  const newRows = await env.DB.prepare(
    `SELECT id, title, summary, description, source, category, published_at, entities
     FROM news WHERE created_at > ? ORDER BY score DESC LIMIT 100`
  ).bind(lastRun).all<any>()
  const newArticles = newRows.results || []
  if (!newArticles.length && !narratives.length) { await setLastAgentRun(env); return }

  // Match new articles to existing narratives
  const { matched, unmatched } = matchArticles(newArticles, narratives)

  for (const narrativeId of Object.keys(matched)) {
    const narrative = narratives.find(n => n.id === Number(narrativeId))
    if (!narrative) continue
    const articles = matched[narrativeId]
    const dev = await generateDevelopment(narrative, articles, apiKey)
    if (dev) await appendDevelopment(env, narrative, dev, articles)
  }

  // Seed new narratives
  if (unmatched.length >= MIN_CLUSTER_SIZE) {
    await seedNarratives(env, unmatched, narratives, apiKey)
  }

  // Archive stale
  await archiveStale(env, narratives)
  await setLastAgentRun(env)
}

function matchArticles(
  articles: any[],
  narratives: Narrative[],
): { matched: Record<number, any[]>; unmatched: any[] } {
  const matched: Record<number, any[]> = {}
  const unmatched: any[] = []
  for (const article of articles) {
    const artTokens = new Set(tokenize(article.title || ''))
    if (!artTokens.size) { unmatched.push(article); continue }
    let found = false
    for (const narrative of narratives) {
      const narrTokens = new Set(
        (narrative.label || narrative.keyword || '').split(/[·\s]+/).filter(Boolean).flatMap(w => [...tokenize(w)])
      )
      if (!narrTokens.size) continue
      let intersection = 0
      for (const t of artTokens) if (narrTokens.has(t)) intersection++
      const similarity = intersection / Math.max(artTokens.size + narrTokens.size - intersection, 1)
      if (similarity >= MATCH_THRESHOLD) {
        if (!matched[narrative.id]) matched[narrative.id] = []
        matched[narrative.id].push(article)
        found = true
        break
      }
    }
    if (!found) unmatched.push(article)
  }
  return { matched, unmatched }
}

async function generateDevelopment(narrative: Narrative, articles: any[], apiKey: string): Promise<string | null> {
  if (!apiKey || !articles.length) return null
  const label = narrative.label || narrative.keyword
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: `你是叙事追踪编辑。跟踪"${label}"话题的报道动态。根据最新一批相关文章，写一条"关键进展"（≤80字中文）：概括这批报道带来了什么新信息。只返回进展正文，不要JSON、不要引号。` },
          { role: 'user', content: articles.map(a => `[${a.source}] ${a.title}\n${(a.summary || a.description || '').slice(0, 200)}`).join('\n\n') },
        ],
        temperature: 0.2,
        max_tokens: 256,
      }),
    })
    if (!res?.ok) return null
    const data = (await res.json()) as any
    const raw = data.choices?.[0]?.message?.content?.trim()
    return raw?.replace(/```[a-z]*\n?/g, '').replace(/^["「]|["」]$/g, '').trim().slice(0, 200) || null
  } catch { return null }
}

async function appendDevelopment(env: Env, narrative: Narrative, text: string, articles: any[]): Promise<void> {
  const existing: any[] = JSON.parse(narrative.developments || '[]')
  const ids: number[] = JSON.parse(narrative.article_ids || '[]')
  const newIds = articles.map(a => Number(a.id)).filter(id => !ids.includes(id))
  if (!newIds.length) return
  const sources: Record<string, number> = {}
  for (const a of articles) { const s = a.source || 'unknown'; sources[s] = (sources[s] || 0) + 1 }
  const existingSources: Record<string, number> = JSON.parse(narrative.source_stats || '{}')
  for (const [s, c] of Object.entries(sources)) existingSources[s] = (existingSources[s] || 0) + (c as number)
  let summary = narrative.summary
  if (existing.length === 0 || existing.length % 3 === 0) {
    summary = await generateNarrSummary(env, narrative, ids, articles)
  }
  existing.push({ date: new Date().toISOString().slice(0, 10), text, articleCount: newIds.length, sources: Object.keys(sources) })
  ids.push(...newIds)
  await env.DB.prepare(
    `UPDATE narratives SET last_updated = datetime('now'), developments = ?, article_ids = ?,
       source_stats = ?, summary = COALESCE(?, summary) WHERE id = ?`
  ).bind(JSON.stringify(existing), JSON.stringify(ids), JSON.stringify(existingSources), summary, narrative.id).run()
  cacheDelete(`narrative:${encodeURIComponent(narrative.keyword)}`).catch(() => {})
}

async function generateNarrSummary(env: Env, narrative: Narrative, existingIds: number[], newBatch: any[]): Promise<string | null> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return null
  const allIds = [...new Set([...existingIds, ...newBatch.map(a => a.id)])]
  const rows = await env.DB.prepare(
    `SELECT title, summary, description FROM news WHERE id IN (${allIds.map(() => '?').join(',')})`
  ).bind(...allIds).all<any>()
  const label = narrative.label || narrative.keyword
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: `你是叙事编辑。给以下报道系列写一个中文摘要（≤120字）：用2-3句话概括"${label}"话题的核心事实和发展脉络。只返回摘要正文，不要JSON。` }, { role: 'user', content: (rows.results || []).slice(0, 20).map((a: any) => `${a.title}\n${(a.summary || a.description || '').slice(0, 200)}`).join('\n\n') }], temperature: 0.2, max_tokens: 256 }),
    })
    if (!res?.ok) return null
    const data = (await res.json()) as any
    return data.choices?.[0]?.message?.content?.trim()?.slice(0, 300) || null
  } catch { return null }
}

async function seedNarratives(env: Env, articles: any[], existing: Narrative[], apiKey: string): Promise<void> {
  const existingKeywords = new Set(existing.map(n => n.keyword))
  const clusters = clusterNews(articles.map(a => ({ id: a.id, title: a.title || '' })))
  for (const cluster of clusters) {
    if (cluster.items.length < MIN_CLUSTER_SIZE) continue
    const keyword = cluster.words.slice(0, 3).join(' · ')
    if (existingKeywords.has(keyword)) continue
    const ids = cluster.items.map((i: any) => i.id)
    const rows = await env.DB.prepare(`SELECT id, title, summary, description, source FROM news WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<any>()
    const clusterArticles = rows.results || []
    const label = await generateTopicLabels([clusterArticles.slice(0, 3).map((a: any) => a.title)], apiKey).then(l => l?.[0] || null)
    const narrativesLabel = label || fallbackLabel(cluster.words)
    const sources: Record<string, number> = {}
    for (const a of clusterArticles) { const s = a.source || 'unknown'; sources[s] = (sources[s] || 0) + 1 }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO narratives (keyword, label, first_seen, last_updated, status, summary, developments, article_ids, source_stats)
       VALUES (?, ?, date('now'), datetime('now'), 'active', ?, '[]', ?, ?)`
    ).bind(keyword, narrativesLabel, (clusterArticles[0]?.summary || clusterArticles[0]?.description || '').slice(0, 300), JSON.stringify(ids), JSON.stringify(sources)).run()
  }
}

async function archiveStale(env: Env, narratives: Narrative[]): Promise<void> {
  for (const n of narratives) {
    if (n.status !== 'active' && n.status !== 'stale') continue
    const daysSinceUpdate = (Date.now() - new Date(n.last_updated).getTime()) / 86_400_000
    if (daysSinceUpdate >= ARCHIVE_DAYS && n.status === 'active') {
      await env.DB.prepare("UPDATE narratives SET status = 'archived' WHERE id = ?").bind(n.id).run()
    } else if (daysSinceUpdate >= STALE_DAYS && n.status === 'active') {
      await env.DB.prepare("UPDATE narratives SET status = 'stale' WHERE id = ?").bind(n.id).run()
    }
  }
}

async function getLastAgentRun(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
  return row?.value || new Date(Date.now() - 86_400_000).toISOString()
}

async function setLastAgentRun(env: Env): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)").bind(new Date().toISOString()).run()
}

// ─── Exported helpers ──────────────────────────────────────────

export async function loadActiveNarratives(env: Env): Promise<Narrative[]> {
  const rows = await env.DB.prepare("SELECT * FROM narratives WHERE status IN ('active', 'stale') ORDER BY last_updated DESC").all<any>()
  return (rows.results || []) as Narrative[]
}

export async function loadSingleNarrative(env: Env, keyword: string): Promise<Narrative | null> {
  const row = await env.DB.prepare('SELECT * FROM narratives WHERE keyword = ?').bind(keyword).first<any>()
  return (row as Narrative) || null
}

// ===================================================================
// Phase 8 — detectBreakingNews
// ===================================================================

/** Detect and flag high-significance stories covered by multiple sources.
 *  Stores in narratives table with __breaking__ prefix, emits SSE event. */
export async function detectBreakingNews(env: Env) {
  // Query recently analyzed articles with high significance
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, source, analysis_detail FROM news
     WHERE analyzed_at >= datetime('now', '-6 hours')
       AND analysis_detail IS NOT NULL
     ORDER BY score DESC LIMIT 30`
  ).all<any>()
  const articles = rows.results || []

  // Parse analysis_detail and group by significance + cross-source signal
  const highSig: any[] = []
  for (const a of articles) {
    try {
      const d = JSON.parse(a.analysis_detail)
      if (d.impact === 'high' || d.significance) {
        highSig.push({ ...a, _detail: d })
      }
    } catch {}
  }

  if (highSig.length < 2) return

  // Group highly significant articles by title_norm overlap
  const groups = new Map<string, any[]>()
  for (const a of highSig) {
    // Use first 30 chars of title as rough dedup key
    const key = (a.title || '').slice(0, 30).toLowerCase().replace(/[^\w一-鿿]/g, '')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }

  // Multi-source groups = breaking news candidates
  let brokeCount = 0
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const sources = [...new Set(group.map((a: any) => a.source))]
    if (sources.length < 2) continue

    // Dedup: skip if a similar __breaking__ narrative was already created
    const titlePrefix = group[0].title.slice(0, 30).replace(/[%_\\]/g, '\\$&')
    const existing = await env.DB.prepare(
      "SELECT id FROM narratives WHERE keyword LIKE ? ESCAPE '\\' AND status = 'active' LIMIT 1"
    ).bind(`__breaking__${titlePrefix}%`).first<any>()
    if (existing) continue

    const keyword = `__breaking__${group[0].title.slice(0, 40)}`
    const summary = group.map((a: any) => a._detail?.significance || '').filter(Boolean).join('；').slice(0, 300)
    const ids = group.map((a: any) => a.id)

    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO narratives (keyword, label, first_seen, last_updated, status, summary, developments, article_ids, source_stats)
         VALUES (?, ?, date('now'), datetime('now'), 'active', ?, '[]', ?, ?)`
      ).bind(
        keyword,
        `🔴 突发: ${group[0].title.slice(0, 40)}`,
        summary || `${sources.join('/')} 同时报道该事件`,
        JSON.stringify(ids),
        JSON.stringify(Object.fromEntries(sources.map(s => [s, group.filter((a: any) => a.source === s).length]))),
      ).run()

      // Emit SSE event for frontend
      signalEvent('breaking', {
        title: group[0].title.slice(0, 80),
        sources,
        significance: summary.slice(0, 100),
        articleCount: group.length,
      }).catch(() => {})

      brokeCount++
    } catch {}
  }
  return { breaking: brokeCount }
}

// ===================================================================
// Phase 9 — linkEntities
// ===================================================================

/** Link synonymous entity names across articles using Jaccard similarity.
 *  Stores canonical mappings in entity_links table, then updates article
 *  entities to use canonical names. */
export async function linkEntities(env: Env) {
  // Collect entities from recently analyzed articles
  const rows = await env.DB.prepare(
    `SELECT id, entities FROM news
     WHERE analyzed_at >= datetime('now', '-12 hours') AND entities IS NOT NULL
     ORDER BY score DESC LIMIT 100`
  ).all<any>()
  if (!rows.results?.length) return { linked: 0 }

  // Collect all entity names with their types
  const rawEntities: { name: string; type: string; articleId: number }[] = []
  for (const r of rows.results) {
    try {
      const list = JSON.parse(r.entities)
      if (Array.isArray(list)) {
        for (const e of list) {
          if (e?.name) rawEntities.push({ name: e.name, type: e.type || 'concept', articleId: r.id })
        }
      }
    } catch {}
  }

  // Dedup entity names (canonicalization via Jaccard similarity)
  const SIMILARITY_THRESHOLD = 0.6
  const canonical = new Map<string, { canonical: string; type: string }>()

  for (const e of rawEntities) {
    const norm = e.name.toLowerCase().trim()
    if (canonical.has(norm)) continue

    // Check for similar existing entries
    let found = false
    for (const [existing, mapped] of canonical) {
      const tokensA = new Set(norm.split(/[\s_-]+/))
      const tokensB = new Set(existing.split(/[\s_-]+/))
      // Also check substring: "Apple" ≈ "Apple Inc."
      if (norm.includes(existing) || existing.includes(norm)) {
        canonical.set(norm, { canonical: mapped.canonical, type: mapped.type || e.type })
        found = true
        break
      }
      let intersection = 0
      for (const t of tokensA) if (tokensB.has(t)) intersection++
      const similarity = intersection / Math.max(tokensA.size + tokensB.size - intersection, 1)
      if (similarity >= SIMILARITY_THRESHOLD && tokensA.size > 0 && tokensB.size > 0) {
        canonical.set(norm, { canonical: mapped.canonical, type: mapped.type || e.type })
        found = true
        break
      }
    }
    if (!found) {
      canonical.set(norm, { canonical: e.name, type: e.type })
    }
  }

  // Store links in entity_links table
  const now = new Date().toISOString()
  let linked = 0
  for (const [original, mapping] of canonical) {
    try {
      const existing = await env.DB.prepare('SELECT article_count FROM entity_links WHERE original_name = ?').bind(original).first<any>()
      const count = existing ? (existing.article_count || 0) + 1 : 1
      await env.DB.prepare(
        `INSERT OR REPLACE INTO entity_links (original_name, canonical_name, entity_type, last_seen, article_count)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(original, mapping.canonical, mapping.type, now, count).run()
      linked++
    } catch {}
  }

  // Update article entities to use canonical names
  // For articles that had entities, rewrite the entities JSON with canonical names
  for (const articleId of [...new Set(rawEntities.map(e => e.articleId))]) {
    const article = rawEntities.filter(e => e.articleId === articleId)
    const updatedEntities = article.map(e => ({
      name: canonical.get(e.name.toLowerCase().trim())?.canonical || e.name,
      type: e.type,
      weight: 0.5,
    }))
    // Dedup by canonical name
    const seen = new Set<string>()
    const deduped = updatedEntities.filter(e => {
      const key = e.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (deduped.length > 0) {
      await env.DB.prepare('UPDATE news SET entities = ? WHERE id = ?')
        .bind(JSON.stringify(deduped), articleId).run()
    }
  }
  return { linked }
}

// ===================================================================
// Phase 10 — tuneSourceWeights
// ===================================================================

/** Auto-adjust source weights based on fetch failure patterns.
 *  Sources with repeated failures get their score weight reduced;
 *  recovered sources gradually regain weight.
 *  Also normalizes source_stats source names against RSS_SOURCES entries. */
export async function tuneSourceWeights(env: Env) {
  // Get current source health
  const stats = await env.DB.prepare('SELECT * FROM source_stats').all<any>()
  const rows = stats.results || []
  if (!rows.length) return { tuned: 0 }

  let tuned = 0
  for (const row of rows) {
    const failCount = row.fail_count || 0
    const source = row.source

    // Calculate adaptive weight: base 1.0, each failure reduces by 0.1, min 0.1
    let newWeight = Math.max(0.1, 1.0 - failCount * 0.1)

    // Check existing adaptive weight
    const existing = await env.DB.prepare('SELECT weight FROM source_weights WHERE source = ?').bind(source).first<any>()
    if (existing) {
      const oldWeight = existing.weight || 1.0
      // Don't change if weight hasn't moved enough
      if (Math.abs(oldWeight - newWeight) < 0.05) {
        // But ensure consecutive_failures is tracked
        await env.DB.prepare(
          'UPDATE source_weights SET consecutive_failures = ?, total_fetches = total_fetches + 1, last_adjusted = datetime(\'now\') WHERE source = ?'
        ).bind(failCount, source).run()
        continue
      }
    }

    // Upsert adaptive weight
    await env.DB.prepare(
      `INSERT OR REPLACE INTO source_weights (source, weight, consecutive_failures, total_fetches, last_adjusted)
       VALUES (?, ?, ?, COALESCE((SELECT total_fetches FROM source_weights WHERE source = ?) + 1, 1), datetime('now'))`
    ).bind(source, newWeight, failCount, source).run()

    // Reset fail_count if recovered (consecutive successes): if source_stats shows
    // last_ok is recent and fail_count has been decremented or stale, we gradually raise weight
    if (failCount === 0 && existing && existing.weight < 1.0) {
      const recoveryWeight = Math.min(1.0, (existing.weight || 0.5) + 0.15)
      await env.DB.prepare('UPDATE source_weights SET weight = ? WHERE source = ?').bind(recoveryWeight, source).run()
    }

    tuned++
  }
  return { tuned }
}
