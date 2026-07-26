import { cacheGet, cacheSet, cacheDelete, CACHE_TTL } from './cache.js'
import { generateDigest } from './analysis.js'
import { DEEPSEEK_MODEL, fetchWithRetry } from './analysis.js'
import { type Env } from './helpers.js'

// Generate at most one digest per CST day, once the day has enough new articles.
export async function generateTodayDigest(env: Env): Promise<'exists' | 'insufficient' | 'failed' | 'generated'> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 'failed'
  const dateRow = await env.DB.prepare("SELECT date('now', '+8 hours') as d").first<{ d: string }>()
  const date = dateRow?.d
  if (!date) return 'failed'
  const existing = await env.DB.prepare('SELECT id FROM digests WHERE date = ?').bind(date).first()
  if (existing) return 'exists'
  const todayCount = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM news WHERE created_at >= datetime(date('now', '+8 hours'), '-8 hours')"
  ).first<{ n: number }>()
  if ((todayCount?.n || 0) < 10) return 'insufficient'
  const candidates = await env.DB.prepare(
    `SELECT n.id, n.title, n.summary, n.category, n.source,
       (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat
     FROM news n
     WHERE published_at >= datetime(date('now', '+8 hours'), '-8 hours', '-24 hours')
       AND published_at < datetime(date('now', '+8 hours'), '-8 hours')
     ORDER BY n.score DESC LIMIT 30`
  ).all()
  const digest = await generateDigest(candidates.results as any[], apiKey)
  if (!digest) return 'failed'
  await env.DB.prepare('INSERT INTO digests (date, intro, items, extra) VALUES (?, ?, ?, ?)')
    .bind(date, digest.intro, JSON.stringify(digest.items), digest.extra ? JSON.stringify(digest.extra) : null).run()
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

  const ids = [...items.map(i => i.news_id), extra?.news_id].filter(id => Number.isInteger(id))
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
