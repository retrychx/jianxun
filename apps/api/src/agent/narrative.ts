/**
 * Narrative tracking (Phase 7) — cross-cycle story tracking.
 * Matches new articles to existing narratives and generates "developments."
 */

import { cacheDelete, signalEvent } from '../cache.js'
import { generateTopicLabels, generateNarrativeDevelopment, generateNarrativeSummary, callDeepSeekText } from '../analysis/deepseek.js'
import { tokenize } from '../tokenize.js'
import { clusterNews } from '../topics.js'
import { STOPWORDS } from '../stopwords.js'
import { fallbackLabel, parseDBTime, toDBTime, decodeHtml, type Env } from '../helpers.js'
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

export async function updateNarratives(env: Env, signal?: AbortSignal): Promise<{ matched: number; created: number }> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { matched: 0, created: 0 }

  // 用与 DB datetime('now') 相同的 "YYYY-MM-DD HH:MM:SS" 格式，
  // 否则 ISO 串与 DB 串字典序比较会漏掉边界当天全部文章。
  const lastRun = toDBTime(new Date(Date.now() - 86400000))
  const narratives = await loadActiveNarratives(env)

  const rows = await env.DB.prepare(
    `SELECT id, title, summary, description, source, category, published_at, entities
     FROM news WHERE created_at > ? ORDER BY score DESC LIMIT 100`
  ).bind(lastRun).all<any>()
  const newArticles = rows.results || []
  if (!newArticles.length && !narratives.length) return { matched: 0, created: 0 }

  const { matched, unmatched } = await matchArticles(newArticles, narratives, apiKey, signal)

  for (const narrativeId of Object.keys(matched)) {
    const id = Number(narrativeId)
    const narrative = narratives.find(n => n.id === id)
    if (!narrative) continue
    const articles = matched[id]
    const dev = await generateDevelopment(narrative, articles, apiKey, signal)
    if (dev) await appendDevelopment(env, narrative, dev, articles, signal)
  }

  let created = 0
  if (unmatched.length >= MIN_CLUSTER_SIZE) {
    created = await seedNarratives(env, unmatched, narratives, apiKey, signal)
  }

  await archiveStale(env, narratives)
  // 返回 KPI 供报告展示（此前返回 undefined，narrativesMatched/created 永不显示）
  return { matched: Object.keys(matched).length, created }
}

function narrTokens(narrative: Narrative): Set<string> {
  const sources: string[] = [narrative.label || narrative.keyword]
  // 加入摘要文字作为匹配信号
  if (narrative.summary) sources.push(narrative.summary)
  // 加入最新进展文字
  try {
    const devs = typeof narrative.developments === 'string' ? JSON.parse(narrative.developments) : narrative.developments
    if (Array.isArray(devs) && devs.length > 0) {
      sources.push(devs.slice(-2).map((d: any) => d.text || '').join(' '))
    }
  } catch {}
  const tokens = new Set<string>()
  for (const src of sources) {
    if (!src) continue
    src.split(/[·\s,，、]+/).filter(Boolean).forEach(w => {
      tokenize(w).forEach(t => tokens.add(t))
    })
  }
  return tokens
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/** AI 语义匹配：用 DeepSeek 判断未匹配文章是否属于某个叙事 */
async function semanticMatch(article: any, narrative: Narrative, apiKey: string, signal?: AbortSignal): Promise<boolean> {
  const label = narrative.label || narrative.keyword || ''
  const summary = narrative.summary || ''
  const text = await callDeepSeekText(apiKey,
    '你是新闻分类助手。判断以下文章标题是否属于该叙事。只返回 true 或 false。',
    `叙事：${label}\n叙事摘要：${summary.slice(0,200)}\n\n文章标题：${article.title || ''}\n\n属于这个叙事吗？`,
    { maxTokens: 10, temperature: 0.01, timeoutMs: CONFIG.narrative.semanticMatchTimeoutMs, signal },
  )
  return (text || '').trim().toLowerCase() === 'true'
}

async function matchArticles(articles: any[], narratives: Narrative[], apiKey?: string, signal?: AbortSignal): Promise<{ matched: Record<number, any[]>; unmatched: any[] }> {
  const matched: Record<number, any[]> = {}; const unmatched: any[] = []
  const narrTokenCache = new Map<number, Set<string>>()
  for (const n of narratives) narrTokenCache.set(n.id, narrTokens(n))

  for (const article of articles) {
    const artTokens = new Set(tokenize(article.title || ''))
    if (!artTokens.size) { unmatched.push(article); continue }
    let found = false
    // Pass 1: 快速词法匹配
    for (const narrative of narratives) {
      const tokens = narrTokenCache.get(narrative.id)
      if (!tokens || !tokens.size) continue
      if (jaccard(artTokens, tokens) >= MATCH_THRESHOLD) {
        if (!matched[narrative.id]) matched[narrative.id] = []
        matched[narrative.id].push(article); found = true; break
      }
    }
    // Pass 2: 词法匹配未通过的，用 AI 语义判断（5% 采样控制成本）
    if (!found && apiKey && Math.random() < 0.05) {
      const candidates = narratives.filter(n => jaccard(artTokens, narrTokenCache.get(n.id) || new Set()) >= MATCH_THRESHOLD * 0.5).slice(0, 2)
      for (const narrative of candidates) {
        if (await semanticMatch(article, narrative, apiKey, signal)) {
          if (!matched[narrative.id]) matched[narrative.id] = []
          matched[narrative.id].push(article); found = true; break
        }
      }
    }
    if (!found) unmatched.push(article)
  }
  return { matched, unmatched }
}

async function generateDevelopment(narrative: Narrative, articles: any[], apiKey: string, signal?: AbortSignal): Promise<string | null> {
  const label = narrative.label || narrative.keyword
  return generateNarrativeDevelopment(
    articles.map(a => ({ source: a.source, title: a.title, summary: a.summary || a.description || '' })),
    label, apiKey, signal
  )
}


async function appendDevelopment(env: Env, narrative: Narrative, text: string, articles: any[], signal?: AbortSignal): Promise<void> {
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
    summary = await narrSummary(env, narrative, ids, articles, signal)
  }
  existing.push({ date: new Date().toISOString().slice(0,10), text: decodeHtml(text), articleCount: newIds.length, sources: Object.keys(sources) })
  ids.push(...newIds)
  await env.DB.prepare(
    `UPDATE narratives SET last_updated=datetime('now'), developments=?, article_ids=?,
     source_stats=?, summary=COALESCE(?,summary) WHERE id=?`
  ).bind(JSON.stringify(existing), JSON.stringify(ids), JSON.stringify(existingSources), summary, narrative.id).run()
  cacheDelete(`narrative:${encodeURIComponent(narrative.keyword)}`).catch(() => {})
  signalEvent('narrative', { keyword: narrative.keyword, label: narrative.label || narrative.keyword, text, articleCount: newIds.length }).catch(() => {})
}

async function narrSummary(env: Env, narrative: Narrative, existingIds: number[], newBatch: any[], signal?: AbortSignal): Promise<string | null> {
  const apiKey = env.DEEPSEEK_API_KEY; if (!apiKey) return null
  const allIds = [...new Set([...existingIds, ...newBatch.map(a => a.id)])]
  const rows = await env.DB.prepare(`SELECT title,summary,description FROM news WHERE id IN (${allIds.map(()=>'?').join(',')})`).bind(...allIds).all<any>()
  const label = narrative.label || narrative.keyword
  return generateNarrativeSummary(
    (rows.results || []).map((a: any) => ({ title: a.title, summary: a.summary || a.description || '' })),
    label, apiKey, signal
  )
}


async function seedNarratives(env: Env, articles: any[], existing: Narrative[], apiKey: string, signal?: AbortSignal): Promise<number> {
  // Index existing narratives by their article_ids for overlap dedup
  const existingArticleIds = new Map<number, Set<number>>()
  for (const n of existing) {
    try {
      const ids: number[] = JSON.parse(n.article_ids || '[]')
      existingArticleIds.set(n.id, new Set(ids))
    } catch {}
  }
  const existingKeywords = new Set(existing.map(n => n.keyword))
  let created = 0

  const clusters = clusterNews(articles.map(a => ({ id: a.id, title: a.title || '' })))
  for (const cluster of clusters) {
    if (cluster.items.length < MIN_CLUSTER_SIZE) continue
    const newIds = new Set(cluster.items.map((i: any) => i.id))

    // 去重：检查文章与已有叙事是否有 ≥ 50% 重叠
    let isDuplicate = false
    for (const [, existingIds] of existingArticleIds) {
      let overlap = 0
      for (const id of newIds) if (existingIds.has(id)) overlap++
      if (overlap / Math.max(newIds.size, existingIds.size) >= 0.5) { isDuplicate = true; break }
    }
    if (isDuplicate) continue

    // 生成关键词：过滤停用词、短词和纯数字
    const cleanWords = cluster.words.filter(w =>
      w.length >= 2 && !STOPWORDS.has(w.toLowerCase()) && !/^\d+$/.test(w)
    )
    const keyword = cleanWords.slice(0, 3).join(' · ')
    if (keyword.length < 3 || existingKeywords.has(keyword)) continue

    const ids = cluster.items.map((i: any) => i.id)
    const rows = await env.DB.prepare(`SELECT id,title,summary,description,source FROM news WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<any>()
    const ca = rows.results || []

    // 用 AI 生成标签；失败时用第一篇标题的前半段
    const lbl = await generateTopicLabels([ca.slice(0,3).map((a:any)=>a.title)], apiKey, signal).then(l=>l?.[0]||null)
    // 存库前解码 HTML 实体（AI 可能把源标题里的 &#8217; 抄进标签）
    const nlbl = decodeHtml(lbl || ca[0]?.title?.slice(0, 30) || fallbackLabel(cleanWords))

    const srcs: Record<string,number> = {}; for (const a of ca) { const s=a.source||'unknown'; srcs[s]=(srcs[s]||0)+1 }

    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
       VALUES (?,?,date('now'),datetime('now'),'active',?,'[]',?,?)`
    ).bind(keyword, nlbl, decodeHtml((ca[0]?.summary||ca[0]?.description||'').slice(0,300)), JSON.stringify(ids), JSON.stringify(srcs)).run()
    if (r.meta.changes > 0) created++
  }
  return created
}

async function archiveStale(env: Env, narratives: Narrative[]): Promise<void> {
  for (const n of narratives) {
    if (n.status !== 'active' && n.status !== 'stale') continue
    const days = (Date.now() - parseDBTime(n.last_updated).getTime()) / 86_400_000
    if (days >= ARCHIVE_DAYS && n.status === 'active') await env.DB.prepare("UPDATE narratives SET status='archived' WHERE id=?").bind(n.id).run()
    else if (days >= STALE_DAYS && n.status === 'active') await env.DB.prepare("UPDATE narratives SET status='stale' WHERE id=?").bind(n.id).run()
  }
}
