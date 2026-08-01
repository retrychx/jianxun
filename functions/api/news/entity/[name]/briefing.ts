// GET /api/news/entity/:name/briefing — Entity Story Board
import { json, mapNews, likeEscape } from '../../../../../src/handler'
import { getEntityEvents } from '../../../../../src/agent/intel'

export async function onRequestGet(context: any) {
  const { env, params } = context
  // Pages Functions 已对路径参数做 URL 解码——不要再 decodeURIComponent
  // （二次解码会把含 %/+ 的实体名变形；单个 % 还会抛 URIError 直接 500）
  const name = String(params.name || '').trim()
  if (!name) return json({ error: 'missing entity name' }, 400)
  if (name.length > 80) return json({ error: 'entity name too long' }, 400)

  // 转义 LIKE 通配符，否则实体名里的 % / _ 会变成通配符返回无关文章
  const like = `%${likeEscape(name)}%`

  try {
    // 1. 所有提及该实体的文章
    const rows: any = await env.DB.prepare(
      `SELECT * FROM news WHERE entities LIKE ? ESCAPE '\\' ORDER BY published_at DESC LIMIT 50`
    ).bind(like).all()
    const articles = ((rows?.results) || []).map(mapNews)

    // 2. 提及该实体的活跃叙事
    const narrRows: any = await env.DB.prepare(
      `SELECT keyword, label, article_ids, summary FROM narratives
       WHERE status = 'active' AND (keyword LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\')
       ORDER BY last_updated DESC LIMIT 10`
    ).bind(like, like).all()
    const narratives = (narrRows.results || []).map((n: any) => ({
      keyword: n.keyword,
      label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
      articleCount: (() => { try { return JSON.parse(n.article_ids || '[]').length } catch { return 0 } })(),
      summary: n.summary || '',
    }))

    // 3. 来源分布
    const srcMap = new Map<string, number>()
    for (const a of articles) {
      const s = a.source || 'unknown'
      srcMap.set(s, (srcMap.get(s) || 0) + 1)
    }
    const sourceStats = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([source, count]) => ({ source, count }))

    // 4. 情感走势（按天）
    const sentByDay = new Map<string, { positive: number; negative: number; neutral: number; total: number }>()
    for (const a of articles) {
      if (!a.publishedAt) continue
      const day = a.publishedAt.slice(0, 10)
      if (!sentByDay.has(day)) sentByDay.set(day, { positive: 0, negative: 0, neutral: 0, total: 0 })
      const entry = sentByDay.get(day)!
      entry.total++
      const s = a.sentiment
      if (typeof s === 'string') {
        try {
          const parsed = JSON.parse(s)
          const label = parsed?.label || ''
          if (label === 'positive') entry.positive++
          else if (label === 'negative') entry.negative++
          else entry.neutral++
        } catch { entry.neutral++ }
      } else if (s && typeof s === 'object') {
        const label = (s as any).label || ''
        if (label === 'positive') entry.positive++
        else if (label === 'negative') entry.negative++
        else entry.neutral++
      }
    }
    const sentimentTrend = [...sentByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({
      date: day,
      positive: v.positive,
      negative: v.negative,
      neutral: v.neutral,
      total: v.total,
    }))

    // 5. 关键人物：与该实体同现的 person 实体
    const personCount = new Map<string, number>()
    for (const a of articles) {
      const raw = (a as any).entities
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (Array.isArray(parsed)) {
            for (const e of parsed) {
              if (e?.type === 'person' && e?.name) {
                personCount.set(e.name, (personCount.get(e.name) || 0) + 1)
              }
            }
          }
        } catch {}
      }
    }
    const keyPeople = [...personCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }))

    // 6. 结构化事件（agent 预生成）
    const events = await getEntityEvents(env, name)

    return json({
      entity: name,
      articleCount: articles.length,
      sourceStats,
      sentimentTrend,
      narratives,
      keyPeople,
      events,
      articles: articles.slice(0, 20),
    })
  } catch {
    return json({ error: 'internal error' }, 500)
  }
}
