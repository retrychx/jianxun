import { cacheGet, cacheSet, CACHE_TTL } from './cache.js'
import { tokenize } from './tokenize.js'
import { mapNews, likeEscape, fallbackLabel, PERSPECTIVES, type Env } from './helpers.js'
import { generateStoryline, generateTopicLabels } from './analysis.js'

// Threshold for Jaccard similarity when merging topic clusters (0-1).
// Lower = more aggressive merging; a value around 0.12 catches semantically
// related but lexically different articles (e.g. "英伟达发布新GPU" ≈ "NVIDIA新芯片").
const SIMILARITY_THRESHOLD = 0.12
// Lower threshold when recovering singletons into existing clusters (less strict).
const SINGLETON_THRESHOLD = 0.08

interface Cluster {
  words: string[]
  items: any[]
  tokenSet: Set<string>
}

/**
 * Multi-pass greedy clustering:
 * 1. Keyword overlap (existing) — articles sharing a token cluster together.
 * 2. Jaccard similarity merge — merge clusters whose aggregate token sets overlap enough.
 * 3. Singleton recovery — unclustered articles join the nearest similar cluster.
 */
function clusterNews(items: any[]): { words: string[]; items: any[] }[] {
  const used = new Set<number>()
  const clusters: Cluster[] = []

  // ─── Pass 1: keyword overlap ───
  for (const item of items) {
    if (used.has(item.id)) continue
    const words = tokenize(item.title)
    if (!words.length) continue
    const cluster: any[] = [item]; used.add(item.id)
    for (const other of items) {
      if (used.has(other.id)) continue
      if (words.some((w: string) => other.title?.includes(w))) { cluster.push(other); used.add(other.id) }
    }
    if (cluster.length >= 2) {
      clusters.push({ words, items: cluster, tokenSet: new Set(words) })
    }
  }

  // ─── Pass 2: merge similar clusters ───
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < clusters.length; i++) {
      if (!clusters[i]) continue
      for (let j = i + 1; j < clusters.length; j++) {
        if (!clusters[j]) continue
        if (clusterSimilarity(clusters[i], clusters[j]) >= SIMILARITY_THRESHOLD) {
          clusters[i] = mergeClusters(clusters[i], clusters[j])
          clusters[j] = null!
          merged = true
        }
      }
    }
    // Compact
    let writeIdx = 0
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i]) clusters[writeIdx++] = clusters[i]
    }
    clusters.length = writeIdx
  }

  // ─── Pass 3: recover unclustered singletons ───
  const unclustered = items.filter(i => !used.has(i.id))
  for (const item of unclustered) {
    const itemWords = new Set(tokenize(item.title))
    if (!itemWords.size) continue
    for (const cluster of clusters) {
      const overlap = [...itemWords].filter(w => cluster.tokenSet.has(w)).length
      const union = new Set([...itemWords, ...cluster.tokenSet])
      const similarity = union.size > 0 ? overlap / union.size : 0
      if (similarity >= SINGLETON_THRESHOLD) {
        cluster.items.push(item)
        // Widen token set for future singleton matches
        for (const w of itemWords) cluster.tokenSet.add(w)
        used.add(item.id)
        break
      }
    }
  }

  return clusters.map(c => ({ words: c.words, items: c.items }))
}

/** Jaccard similarity between two clusters' aggregate title-token sets. */
function clusterSimilarity(a: Cluster, b: Cluster): number {
  if (!a.tokenSet.size || !b.tokenSet.size) return 0
  let intersection = 0
  for (const w of a.tokenSet) if (b.tokenSet.has(w)) intersection++
  const union = a.tokenSet.size + b.tokenSet.size - intersection
  return union > 0 ? intersection / union : 0
}

/** Merge two clusters into one, preserving the larger cluster's representative words. */
function mergeClusters(a: Cluster, b: Cluster): Cluster {
  const merged = a.items.length >= b.items.length ? a : b
  const other = a.items.length >= b.items.length ? b : a
  merged.items.push(...other.items)
  for (const w of other.tokenSet) merged.tokenSet.add(w)
  // Refresh representative words from merged tokenSet
  merged.words = [...merged.tokenSet].slice(0, 5)
  return merged
}

export async function topics(env: Env) {
  { const cached = await cacheGet<any>('topics'); if (cached) return cached }
  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const items = all.results as any[]
  const topicList: any[] = []

  for (const { words, items: cluster } of clusterNews(items)) {
    const dates = cluster.map(i => i.published_at).filter(Boolean).sort()
    const dateRange = dates.length >= 2 ? dates[0].slice(0, 10) + ' ~ ' + dates[dates.length - 1].slice(0, 10) : dates[0]?.slice(0, 10) || ''
    const sourcePerspectives = [...new Set(cluster.map(i => i.source))].map(s => ({
      name: s,
      angle: PERSPECTIVES[s] || '综合'
    }))
    const topTitles = cluster.slice(0, 3).map(i => i.title)
    const bestItem = cluster.sort((a: any, b: any) => (b.summary?.length || 0) - (a.summary?.length || 0))[0]
    const narrative = bestItem?.summary
      ? bestItem.summary.slice(0, 300)
      : (cluster[0]?.description || '').slice(0, 200) + '...'

    topicList.push({
      keyword: words.slice(0, 3).join(' · '),
      label: fallbackLabel(words),
      count: cluster.length,
      sources: [...new Set(cluster.map(i => i.source))],
      sourcePerspectives,
      dateRange,
      narrative: narrative.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
      items: cluster.slice(0, 5),
      topTitles,
    })
  }
  topicList.sort((a, b) => b.count - a.count)
  const top = topicList.slice(0, 15)
  const aiLabels = await generateTopicLabels(top.map(t => t.topTitles), env.DEEPSEEK_API_KEY)
  const result = {
    topics: top.map((t: any, i: number) => {
      const { topTitles, ...rest } = t
      return { ...rest, label: aiLabels?.[i] || t.label, items: t.items.map(mapNews) }
    })
  }
  await cacheSet('topics', result, CACHE_TTL.topics)
  return result
}

export async function topic(env: Env, name: string) {
  const cacheKey = `topic:${name}`
  { const cached = await cacheGet<any>(cacheKey); if (cached) return cached }

  const all = await env.DB.prepare('SELECT * FROM news ORDER BY score DESC LIMIT 80').all()
  const hit = clusterNews(all.results as any[]).find(c =>
    c.words.some(w => w === name || w.includes(name) || name.includes(w)) ||
    fallbackLabel(c.words).includes(name)
  )
  let clusterItems: any[]
  let keyword: string, label: string
  if (hit) {
    clusterItems = hit.items
    keyword = hit.words.slice(0, 3).join(' · ')
    label = fallbackLabel(hit.words)
  } else {
    const rows = await env.DB.prepare("SELECT * FROM news WHERE title LIKE ? ESCAPE '\\' ORDER BY published_at DESC LIMIT 20").bind(`%${likeEscape(name)}%`).all()
    if (!rows.results.length) return null
    clusterItems = rows.results as any[]
    keyword = name
    label = name
  }

  const top = clusterItems.slice().sort((a: any, b: any) => (b.score || 0) - (a.score || 0)).slice(0, 10)
  const storyline = await generateStoryline(
    top.map((i: any) => ({ title: i.title, summary: i.summary || i.description || '' })),
    env.DEEPSEEK_API_KEY
  )

  const timeline = clusterItems.slice()
    .sort((a: any, b: any) => (a.published_at || '9999').localeCompare(b.published_at || '9999'))
    .map(mapNews)

  const bySource = new Map<string, { count: number; labels: Map<string, number> }>()
  for (const r of clusterItems) {
    const entry = bySource.get(r.source) || { count: 0, labels: new Map<string, number>() }
    bySource.set(r.source, entry)
    entry.count++
    if (!r.sentiment) continue
    try {
      const label = JSON.parse(r.sentiment)?.label
      if (label) entry.labels.set(label, (entry.labels.get(label) || 0) + 1)
    } catch {}
  }
  const perspectives = [...bySource.entries()].map(([source, e]) => ({
    source,
    label: e.labels.size ? [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
    count: e.count,
  }))

  const result = { keyword, label, storyline, timeline, perspectives }
  await cacheSet(cacheKey, result, CACHE_TTL.topic)
  return result
}

export async function weekly(env: Env) {
  { const cached = await cacheGet<any>('weekly'); if (cached) return cached }
  const rows = await env.DB.prepare(
    "SELECT * FROM news WHERE created_at >= datetime('now', '-7 days') ORDER BY score DESC"
  ).all()
  const items = rows.results as any[]

  const entityCount = new Map<string, number>()
  for (const r of items) {
    if (!r.entities) continue
    try {
      const list = JSON.parse(r.entities)
      if (!Array.isArray(list)) continue
      for (const e of list) {
        if (e?.name) entityCount.set(e.name, (entityCount.get(e.name) || 0) + 1)
      }
    } catch {}
  }
  const topEntities = [...entityCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const clusters = clusterNews(items.slice(0, 80)).sort((a, b) => b.items.length - a.items.length).slice(0, 5)
  const aiLabels = await generateTopicLabels(clusters.map(c => c.items.slice(0, 3).map(i => i.title)), env.DEEPSEEK_API_KEY)
  const topTopics = clusters.map((c, i) => ({ label: aiLabels?.[i] || fallbackLabel(c.words), count: c.items.length }))

  const result = { totalNew: items.length, topEntities, topTopics }
  await cacheSet('weekly', result, CACHE_TTL.weekly)
  return result
}
