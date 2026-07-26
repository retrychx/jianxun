import { cacheGet, cacheSet, cacheDelete, CACHE_TTL } from './cache.js'
import { generateDigest } from './analysis.js'
import { DEEPSEEK_MODEL, fetchWithRetry } from './analysis.js'
import { type Env } from './helpers.js'

// Incremental daily digest: first generation creates a full digest from the
// day's top candidates; subsequent calls only process articles not yet in it,
// appending new picks.  This saves API cost and keeps selections stable.
export async function generateTodayDigest(env: Env): Promise<'exists' | 'insufficient' | 'failed' | 'generated'> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 'failed'
  const dateRow = await env.DB.prepare("SELECT date('now', '+8 hours') as d").first<{ d: string }>()
  const date = dateRow?.d
  if (!date) return 'failed'

  // Check whether today already has a digest (for incremental merge)
  const existing = await env.DB.prepare('SELECT * FROM digests WHERE date = ?').bind(date).first<any>()
  let existingIds = new Set<number>()
  let existingItems: any[] = []
  if (existing) {
    try {
      existingItems = JSON.parse(existing.items)
      if (!Array.isArray(existingItems)) existingItems = []
      for (const it of existingItems) if (it.news_id) existingIds.add(it.news_id)
      const extra = existing.extra ? JSON.parse(existing.extra) : null
      if (extra?.news_id) existingIds.add(extra.news_id)
    } catch { existingItems = [] }
  }

  // Full candidate pool for today's window
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.title, n.summary, n.category, n.source, n.analysis_detail,
       (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime(date('now', '+8 hours'), '-8 hours', '-24 hours')
       AND published_at < datetime(date('now', '+8 hours'), '-8 hours')
     ORDER BY n.score DESC`
  ).all()
  const all = candidates.results as any[]

  // Enrich candidates with parsed analysis_detail for the digest prompt
  for (const c of all) {
    if (c.analysis_detail) {
      try {
        const d = JSON.parse(c.analysis_detail)
        c._significance = d.significance || ''
        c._controversy = d.controversy || false
      } catch {}
    }
  }

  const totalCount = all.length

  if (!existing) {
    if (totalCount < 10) return 'insufficient'
    const digest = await generateDigest(all, apiKey)
    if (!digest) return 'failed'
    await env.DB.prepare('INSERT INTO digests (date, intro, items, extra) VALUES (?, ?, ?, ?)')
      .bind(date, digest.intro, JSON.stringify(digest.items), digest.extra ? JSON.stringify(digest.extra) : null).run()
    await Promise.allSettled([cacheDelete('digest'), cacheDelete('digests')])
    return 'generated'
  }

  // ─── Incremental: only articles not yet in the digest ───
  const newArticles = all.filter(c => !existingIds.has(c.id))
  if (newArticles.length < 3) return 'exists'

  const digest = await generateDigest(newArticles, apiKey)
  if (!digest) return 'failed'

  // Merge: keep existing items, append new ones (dedup by news_id)
  const seen = new Set(existingItems.map((it: any) => it.news_id))
  for (const it of digest.items) {
    if (!seen.has(it.news_id)) {
      existingItems.push(it)
      seen.add(it.news_id)
    }
  }
  const mergedExtra = digest.extra && !existingIds.has(digest.extra.news_id) ? digest.extra : null

  await env.DB.prepare('UPDATE digests SET items = ?, extra = COALESCE(?, extra) WHERE date = ?')
    .bind(JSON.stringify(existingItems), mergedExtra ? JSON.stringify(mergedExtra) : null, date).run()
  await Promise.allSettled([cacheDelete('digest'), cacheDelete('digests')])
  return 'generated'
}

export async function debugDigest(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { stage: 'no-api-key' }
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.title, n.summary, n.category, n.source,
       (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime('now', '-24 hours')
     ORDER BY n.score DESC LIMIT 30`
  ).all()
  const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: '你是中文科技日报主编。从候选新闻中挑出今天最重要的 5-8 条做成日报。只返回 JSON：{"intro":"≤120字","items":[{"news_id":数字,"why":"≤30字","category":"分类"}],"extra":{"news_id":数字,"why":"≤30字"}或null}。news_id 必须来自候选列表。' },
        { role: 'user', content: (candidates.results as any[]).slice(0, 30).map(c => `[${c.id}] ${c.title}（${c.source}/${c.category}）\n${(c.summary || '').slice(0, 200)}`).join('\n\n') }
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  })
  if (!res) return { stage: 'failed', httpStatus: 0, candidateCount: candidates.results?.length }
  const text = await res.text()
  let parsed: any = null
  try {
    const data = JSON.parse(text)
    const raw = data.choices?.[0]?.message?.content || ''
    parsed = { finishReason: data.choices?.[0]?.finish_reason, contentHead: raw.slice(0, 600), contentTail: raw.slice(-300) }
  } catch { parsed = { nonJsonResponse: text.slice(0, 600) } }
  return { stage: 'llm', httpStatus: res.status, candidateCount: candidates.results?.length, ...parsed }
}

export async function digest(env: Env, date: string | null) {
  const cacheKey = date ? `digest:${date}` : 'digest'
  { const cached = await cacheGet<any>(cacheKey); if (cached) return cached }
  const row = date
    ? await env.DB.prepare('SELECT * FROM digests WHERE date = ?').bind(date).first<any>()
    : await env.DB.prepare('SELECT * FROM digests ORDER BY date DESC, id DESC LIMIT 1').first<any>()
  if (!row) return null

  let items: any[] = []
  let extra: any = null
  try { items = JSON.parse(row.items) } catch {}
  try { extra = row.extra ? JSON.parse(row.extra) : null } catch {}
  if (!Array.isArray(items)) items = []

  const ids = [...items.map(i => i.news_id), extra?.news_id].filter((id: any) => Number.isInteger(id))
  const byId = new Map<number, any>()
  if (ids.length) {
    const rows = await env.DB.prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
       FROM news n WHERE n.id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all()
    for (const r of rows.results as any[]) byId.set(r.id, r)
  }

  const result = {
    date: row.date as string,
    intro: row.intro as string,
    items: items.flatMap((it: any) => {
      const n = byId.get(it.news_id)
      if (!n) return []
      return [{
        id: n.id, title: n.title, titleZh: n.title_zh || null,
        why: it.why || '', category: it.category || n.category,
        source: n.source, heat: n.heat || 1,
      }]
    }),
    extra: (() => {
      const n = extra && byId.get(extra.news_id)
      return n ? { id: n.id, title: n.title, titleZh: n.title_zh || null, why: extra.why || '' } : null
    })(),
  }
  await cacheSet(cacheKey, result, CACHE_TTL.digest)
  return result
}

export async function digests(env: Env) {
  { const cached = await cacheGet<any>('digests'); if (cached) return cached }
  const rows = await env.DB.prepare('SELECT date FROM digests ORDER BY date DESC').all()
  const result = { dates: (rows.results as any[]).map(r => r.date) }
  await cacheSet('digests', result, CACHE_TTL.digests)
  return result
}
