/**
 * News Intelligence Agent — unified AI processing pipeline.
 *
 * Runs as a single ctx.waitUntil task after each fetchNews(), orchestrating:
 *   1. fixMissingImages  — fetch OG images for articles without one
 *   2. analyzeNewArticles — enhanced AI analysis (summary, entities, sentiment, keyPoints, etc.)
 *   3. refineCategories  — DeepSeek batch reclassify low-confidence articles
 *   4. translateMissing  — English→Chinese batch translation
 *   5. crossRefAnalysis  — compare same-story coverage across sources (NEW)
 *   6. generateDailyDigest — AI daily digest
 *   7. updateNarratives  — cross-cycle story tracking
 *
 * Each phase is also exported individually for standalone admin endpoints.
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
  type DeepSeekResult,
  type AnalysisDetail,
  type CrossRefResult,
} from './analysis.js'
import { tokenize } from './tokenize.js'
import { clusterNews } from './topics.js'
import { fallbackLabel, likeEscape, type Env } from './helpers.js'

// ─── Public: main orchestrator ─────────────────────────────────

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return

  // Phase 1: Images
  await fixMissingImages(env).catch(() => {})

  // Phase 2: AI analysis (summary, entities, sentiment, keyPoints, significance)
  await analyzeNewArticles(env).catch(() => {})

  // Phase 3: Category refinement
  await refineCategories(env).catch(() => {})

  // Phase 4: English→Chinese translation
  await translateMissing(env).catch(() => {})

  // Phase 5: Cross-source comparison (NEW)
  await runCrossRefAnalysis(env).catch(() => {})

  // Phase 6: Daily digest
  const { generateTodayDigest } = await import('./digest.js')
  await generateTodayDigest(env).catch(() => {})

  // Phase 7: Narrative tracking
  await updateNarratives(env).catch(() => {})
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
      const { content: extracted } = await extractContent(row.url)
      const content = (extracted || row.description || row.title).slice(0, 2000)
      const result = await analyzeWithDeepSeek(row.title, content, apiKey)
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
    const { generateTopicLabels } = await import('./analysis.js')
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
