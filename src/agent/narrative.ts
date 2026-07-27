/**
 * Narrative tracking (Phase 7) — cross-cycle story tracking.
 * Matches new articles to existing narratives and generates "developments."
 */

import { cacheDelete } from '../cache.js'
import { generateTopicLabels, generateNarrativeDevelopment, generateNarrativeSummary } from '../analysis/deepseek.js'
import { tokenize } from '../tokenize.js'
import { clusterNews } from '../topics.js'
import { fallbackLabel, type Env } from '../helpers.js'
import { markAgentRun as setLastAgentRun } from './state.js'
import { CONFIG } from './config.js'

const MATCH_THRESHOLD = CONFIG.narrative.matchThreshold
const MIN_CLUSTER_SIZE = CONFIG.narrative.minClusterSize
const STALE_DAYS = CONFIG.narrative.staleDays
const ARCHIVE_DAYS = CONFIG.narrative.archiveDays

export interface Narrative {
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

export async function loadActiveNarratives(env: Env): Promise<Narrative[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM narratives WHERE status IN ('active', 'stale') ORDER BY last_updated DESC"
  ).all<any>()
  return (rows.results || []) as Narrative[]
}

export async function loadSingleNarrative(env: Env, keyword: string): Promise<Narrative | null> {
  const row = await env.DB.prepare('SELECT * FROM narratives WHERE keyword = ?').bind(keyword).first<any>()
  return (row as Narrative) || null
}

export async function updateNarratives(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return

  const lastRun = new Date(Date.now() - 86400000).toISOString()  // fallback: 24h ago
  const narratives = await loadActiveNarratives(env)

  const rows = await env.DB.prepare(
    `SELECT id, title, summary, description, source, category, published_at, entities
     FROM news WHERE created_at > ? ORDER BY score DESC LIMIT 100`
  ).bind(lastRun).all<any>()
  const newArticles = rows.results || []
  if (!newArticles.length && !narratives.length) { await setLastAgentRun(env); return }

  const { matched, unmatched } = matchArticles(newArticles, narratives)

  for (const narrativeId of Object.keys(matched)) {
    const narrative = narratives.find(n => n.id === Number(narrativeId))
    if (!narrative) continue
    const articles = matched[narrativeId]
    const dev = await generateDevelopment(narrative, articles, apiKey)
    if (dev) await appendDevelopment(env, narrative, dev, articles)
  }

  if (unmatched.length >= MIN_CLUSTER_SIZE) {
    await seedNarratives(env, unmatched, narratives, apiKey)
  }

  await archiveStale(env, narratives)
  await setLastAgentRun(env)
}

function matchArticles(articles: any[], narratives: Narrative[]): { matched: Record<number, any[]>; unmatched: any[] } {
  const matched: Record<number, any[]> = {}; const unmatched: any[] = []
  for (const article of articles) {
    const artTokens = new Set(tokenize(article.title || ''))
    if (!artTokens.size) { unmatched.push(article); continue }
    let found = false
    for (const narrative of narratives) {
      const narrTokens = new Set((narrative.label || narrative.keyword || '').split(/[·\s]+/).filter(Boolean).flatMap(w => [...tokenize(w)]))
      if (!narrTokens.size) continue
      let intersection = 0
      for (const t of artTokens) if (narrTokens.has(t)) intersection++
      if (intersection / Math.max(artTokens.size + narrTokens.size - intersection, 1) >= MATCH_THRESHOLD) {
        if (!matched[narrative.id]) matched[narrative.id] = []; matched[narrative.id].push(article); found = true; break
      }
    }
    if (!found) unmatched.push(article)
  }
  return { matched, unmatched }
}

async function generateDevelopment(narrative: Narrative, articles: any[], apiKey: string): Promise<string | null> {
  const label = narrative.label || narrative.keyword
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: `你是叙事追踪编辑。跟踪"${label}"话题的报道动态。根据最新一批相关文章，写一条"关键进展"（≤80字中文）：概括这批报道带来了什么新信息。只返回进展正文，不要JSON、不要引号。` }, { role: 'user', content: articles.map(a => `[${a.source}] ${a.title}\n${(a.summary || a.description || '').slice(0, 200)}`).join('\n\n') }], temperature: 0.2, max_tokens: 256 }),
    })
    if (!res?.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.trim()
    return raw?.replace(/```[a-z]*\n?/g,'').replace(/^["「]|["」]$/g,'').trim().slice(0,200) || null
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
    summary = await narrSummary(env, narrative, ids, articles)
  }
  existing.push({ date: new Date().toISOString().slice(0,10), text, articleCount: newIds.length, sources: Object.keys(sources) })
  ids.push(...newIds)
  await env.DB.prepare(
    `UPDATE narratives SET last_updated=datetime('now'), developments=?, article_ids=?,
     source_stats=?, summary=COALESCE(?,summary) WHERE id=?`
  ).bind(JSON.stringify(existing), JSON.stringify(ids), JSON.stringify(existingSources), summary, narrative.id).run()
  cacheDelete(`narrative:${encodeURIComponent(narrative.keyword)}`).catch(() => {})
}

async function narrSummary(env: Env, narrative: Narrative, existingIds: number[], newBatch: any[]): Promise<string | null> {
  const apiKey = env.DEEPSEEK_API_KEY; if (!apiKey) return null
  const allIds = [...new Set([...existingIds, ...newBatch.map(a => a.id)])]
  const rows = await env.DB.prepare(`SELECT title,summary,description FROM news WHERE id IN (${allIds.map(()=>'?').join(',')})`).bind(...allIds).all<any>()
  const label = narrative.label || narrative.keyword
  return generateNarrativeSummary(
    (rows.results || []).map((a: any) => ({ title: a.title, summary: a.summary || a.description || '' })),
    label, apiKey
  )
}

async function seedNarratives(env: Env, articles: any[], existing: Narrative[], apiKey: string): Promise<void> {
  const existingKeywords = new Set(existing.map(n => n.keyword))
  const clusters = clusterNews(articles.map(a => ({ id: a.id, title: a.title || '' })))
  for (const cluster of clusters) {
    if (cluster.items.length < MIN_CLUSTER_SIZE) continue
    const keyword = cluster.words.slice(0,3).join(' · ')
    if (existingKeywords.has(keyword)) continue
    const ids = cluster.items.map((i: any) => i.id)
    const rows = await env.DB.prepare(`SELECT id,title,summary,description,source FROM news WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<any>()
    const ca = rows.results || []
    const lbl = await generateTopicLabels([ca.slice(0,3).map((a:any)=>a.title)], apiKey).then(l=>l?.[0]||null)
    const nlbl = lbl || fallbackLabel(cluster.words)
    const srcs: Record<string,number> = {}; for (const a of ca) { const s=a.source||'unknown'; srcs[s]=(srcs[s]||0)+1 }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
       VALUES (?,?,date('now'),datetime('now'),'active',?,'[]',?,?)`
    ).bind(keyword, nlbl, (ca[0]?.summary||ca[0]?.description||'').slice(0,300), JSON.stringify(ids), JSON.stringify(srcs)).run()
  }
}

async function archiveStale(env: Env, narratives: Narrative[]): Promise<void> {
  for (const n of narratives) {
    if (n.status !== 'active' && n.status !== 'stale') continue
    const days = (Date.now() - new Date(n.last_updated).getTime()) / 86_400_000
    if (days >= ARCHIVE_DAYS && n.status === 'active') await env.DB.prepare("UPDATE narratives SET status='archived' WHERE id=?").bind(n.id).run()
    else if (days >= STALE_DAYS && n.status === 'active') await env.DB.prepare("UPDATE narratives SET status='stale' WHERE id=?").bind(n.id).run()
  }
}
