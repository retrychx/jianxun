/**
 * News Narrative Agent — autonomous story tracking across fetch cycles.
 *
 * Runs as a background task (ctx.waitUntil) after each successful fetch.
 * Lifecycle:
 *   1. Load existing active/stale narratives
 *   2. Query articles newer than the last agent run
 *   3. Match new articles to existing narratives → generate "developments"
 *   4. Seed new narratives from fresh topic clusters (≥3 articles, not yet tracked)
 *   5. Archive narratives with no activity for 7+ days
 */

import { cacheSet, cacheGet, cacheDelete } from './cache.js'
import { tokenize } from './tokenize.js'
import { DEEPSEEK_MODEL, fetchWithRetry, generateTopicLabels } from './analysis.js'
import { fallbackLabel, type Env } from './helpers.js'
import { clusterNews } from './topics.js'

// Thresholds
const MATCH_THRESHOLD = 0.1        // Jaccard similarity for article→narrative matching
const MIN_CLUSTER_SIZE = 3          // Minimum articles to seed a new narrative
const STALE_DAYS = 7                // Days of inactivity before → stale
const ARCHIVE_DAYS = 14             // Days of inactivity before → archived

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

/** Main entry point: called from ctx.waitUntil after fetchNews. */
export async function runAgent(env: Env): Promise<void> {
  try {
    const apiKey = env.DEEPSEEK_API_KEY
    if (!apiKey) return

    const lastRun = await getLastAgentRun(env)
    const narratives = await loadActiveNarratives(env)

    // Query articles newer than last agent run
    const newRows = await env.DB.prepare(
      `SELECT id, title, summary, description, source, category, published_at, entities
       FROM news WHERE created_at > ? ORDER BY score DESC LIMIT 100`
    ).bind(lastRun).all<any>()
    const newArticles = newRows.results || []
    if (!newArticles.length && !narratives.length) return

    // ─── Step 1: Match new articles to existing narratives ───
    const { matched, unmatched } = matchArticles(newArticles, narratives)

    for (const narrativeId of Object.keys(matched)) {
      const narrative = narratives.find(n => n.id === Number(narrativeId))
      if (!narrative) continue
      const articles = matched[narrativeId]
      const dev = await generateDevelopment(narrative, articles, apiKey)
      if (dev) {
        await appendDevelopment(env, narrative, dev, articles)
      }
    }

    // ─── Step 2: Seed new narratives from unmatched articles ───
    if (unmatched.length >= MIN_CLUSTER_SIZE) {
      await seedNarratives(env, unmatched, narratives, apiKey)
    }

    // ─── Step 3: Archive stale narratives ───
    await archiveStale(env, narratives)

    // ─── Step 4: Update agent state ───
    await setLastAgentRun(env)
  } catch (err: any) {
    console.error('NewsNarrativeAgent error:', err?.message || err)
  }
}

// ─── Matching ────────────────────────────────────────────────

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
        (narrative.label || narrative.keyword || '')
          .split(/[·\s]+/).filter(Boolean).flatMap(w => [...tokenize(w)])
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

// ─── Development Generation ──────────────────────────────────

async function generateDevelopment(
  narrative: Narrative,
  articles: any[],
  apiKey: string,
): Promise<string | null> {
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
          {
            role: 'system',
            content: `你是叙事追踪编辑。跟踪"${label}"话题的报道动态。根据最新一批相关文章，写一条"关键进展"（≤80字中文）：概括这批报道带来了什么新信息。

注意：
- 聚焦事实而非评价，只说"发生了什么"
- 如果这批文章讲的是同一件事的不同侧面，提炼一个综合视角
- 如果这批文章讲的完全是不同的事，如实陈述
只返回进展正文，不要JSON、不要引号、不要标签。`,
          },
          {
            role: 'user',
            content: articles.map(a =>
              `[${a.source}] ${a.title}\n${(a.summary || a.description || '').slice(0, 200)}`
            ).join('\n\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: 256,
      }),
    })
    if (!res?.ok) return null
    const data = (await res.json()) as any
    const raw = data.choices?.[0]?.message?.content?.trim()
    return raw?.replace(/```[a-z]*\n?/g, '').replace(/^["「]|["」]$/g, '').trim().slice(0, 200) || null
  } catch {
    return null
  }
}

async function appendDevelopment(
  env: Env,
  narrative: Narrative,
  text: string,
  articles: any[],
): Promise<void> {
  const existing: any[] = JSON.parse(narrative.developments || '[]')
  const ids: number[] = JSON.parse(narrative.article_ids || '[]')

  // Dedup article IDs
  const newIds = articles.map(a => Number(a.id)).filter(id => !ids.includes(id))
  if (!newIds.length) return

  // Count sources for this batch
  const sources: Record<string, number> = {}
  for (const a of articles) {
    const s = a.source || 'unknown'
    sources[s] = (sources[s] || 0) + 1
  }
  const existingSources: Record<string, number> = JSON.parse(narrative.source_stats || '{}')
  for (const [s, c] of Object.entries(sources)) {
    existingSources[s] = (existingSources[s] || 0) + (c as number)
  }
  // Re-summarize with AI if the narrative has accumulated enough new articles
  let summary = narrative.summary
  if (existing.length === 0 || existing.length % 3 === 0) {
    summary = await generateSummary(env, narrative, ids, articles)
  }

  existing.push({
    date: new Date().toISOString().slice(0, 10),
    text,
    articleCount: newIds.length,
    sources: Object.keys(sources),
  })

  ids.push(...newIds)

  await env.DB.prepare(
    `UPDATE narratives SET last_updated = datetime('now'), developments = ?, article_ids = ?,
       source_stats = ?, summary = COALESCE(?, summary)
     WHERE id = ?`
  ).bind(
    JSON.stringify(existing),
    JSON.stringify(ids),
    JSON.stringify(existingSources),
    summary,
    narrative.id,
  ).run()

  // Invalidate narrative cache for this keyword
  cacheDelete(`narrative:${encodeURIComponent(narrative.keyword)}`).catch(() => {})
}

async function generateSummary(
  env: Env,
  narrative: Narrative,
  existingIds: number[],
  newBatch: any[],
): Promise<string | null> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const allIds = [...new Set([...existingIds, ...newBatch.map(a => a.id)])]
  const rows = await env.DB.prepare(
    `SELECT title, summary, description FROM news WHERE id IN (${allIds.map(() => '?').join(',')})`
  ).bind(...allIds).all<any>()
  const articles = rows.results || []

  const label = narrative.label || narrative.keyword
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是叙事编辑。给以下报道系列写一个中文摘要（≤120字）：用2-3句话概括"${label}"话题的核心事实和发展脉络。只返回摘要正文，不要JSON。`,
          },
          {
            role: 'user',
            content: articles.slice(0, 20).map(a =>
              `${a.title}\n${(a.summary || a.description || '').slice(0, 200)}`
            ).join('\n\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: 256,
      }),
    })
    if (!res?.ok) return null
    const data = (await res.json()) as any
    const raw = data.choices?.[0]?.message?.content?.trim()
    return raw?.slice(0, 300) || null
  } catch {
    return null
  }
}

// ─── Seeding ─────────────────────────────────────────────────

async function seedNarratives(
  env: Env,
  articles: any[],
  existing: Narrative[],
  apiKey: string,
): Promise<void> {
  const existingKeywords = new Set(existing.map(n => n.keyword))

  // Run topic clustering on the unmatched batch
  const clusters = clusterNews(articles.map(a => ({
    id: a.id,
    title: a.title || '',
  })))

  for (const cluster of clusters) {
    if (cluster.items.length < MIN_CLUSTER_SIZE) continue
    const keyword = cluster.words.slice(0, 3).join(' · ')
    if (existingKeywords.has(keyword)) continue

    // Get full article data for this cluster
    const ids = cluster.items.map((i: any) => i.id)
    const rows = await env.DB.prepare(
      `SELECT id, title, summary, description, source FROM news WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all<any>()
    const clusterArticles = rows.results || []

    const label = await generateTopicLabels(
      [clusterArticles.slice(0, 3).map((a: any) => a.title)],
      apiKey,
    ).then(l => l?.[0] || null)

    const narrativesLabel = label || fallbackLabel(cluster.words)

    const sources: Record<string, number> = {}
    for (const a of clusterArticles) {
      const s = a.source || 'unknown'
      sources[s] = (sources[s] || 0) + 1
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO narratives (keyword, label, first_seen, last_updated, status, summary, developments, article_ids, source_stats)
       VALUES (?, ?, date('now'), datetime('now'), 'active', ?, '[]', ?, ?)`
    ).bind(
      keyword,
      narrativesLabel,
      (clusterArticles[0]?.summary || clusterArticles[0]?.description || '').slice(0, 300),
      JSON.stringify(ids),
      JSON.stringify(sources),
    ).run()
  }
}

// ─── Archival ────────────────────────────────────────────────

async function archiveStale(env: Env, narratives: Narrative[]): Promise<void> {
  for (const n of narratives) {
    if (n.status !== 'active' && n.status !== 'stale') continue

    const updated = new Date(n.last_updated)
    const daysSinceUpdate = (Date.now() - updated.getTime()) / 86_400_000

    if (daysSinceUpdate >= ARCHIVE_DAYS && n.status === 'active') {
      await env.DB.prepare("UPDATE narratives SET status = 'archived' WHERE id = ?").bind(n.id).run()
    } else if (daysSinceUpdate >= STALE_DAYS && n.status === 'active') {
      await env.DB.prepare("UPDATE narratives SET status = 'stale' WHERE id = ?").bind(n.id).run()
    }
  }
}

// ─── Agent State ─────────────────────────────────────────────

const AGENT_RUN_CACHE_KEY = 'agent:lastRun'

async function getLastAgentRun(env: Env): Promise<string> {
  // Try D1 first (persistent)
  const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
  if (row?.value) return row.value
  // Fallback: look back 24 hours
  return new Date(Date.now() - 86_400_000).toISOString()
}

async function setLastAgentRun(env: Env): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)").bind(now).run()
}

// ─── Shared: load narratives ────────────────────────────────

export async function loadActiveNarratives(env: Env): Promise<Narrative[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM narratives WHERE status IN ('active', 'stale') ORDER BY last_updated DESC"
  ).all<any>()
  return (rows.results || []) as Narrative[]
}

export async function loadSingleNarrative(env: Env, keyword: string): Promise<Narrative | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM narratives WHERE keyword = ?'
  ).bind(keyword).first<any>()
  return (row as Narrative) || null
}
