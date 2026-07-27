import { json, mapNews } from '../../../src/handler'
import { loadActiveNarratives, loadSingleNarrative } from '../../../src/agent'

// Returns either:
//   GET /api/news/narrative — list of all active/stale narratives
//   GET /api/news/narrative?keyword=xxx — single narrative detail

export async function onRequestGet(context: any) {
  const { request, env } = context
  const url = new URL(request.url)
  const keyword = url.searchParams.get('keyword')

  if (keyword) {
    const narrative = await loadSingleNarrative(env, keyword)
    if (!narrative) return json({ error: 'Narrative not found' }, 404)

    const devs: any[] = JSON.parse(narrative.developments || '[]')
    const ids: number[] = JSON.parse(narrative.article_ids || '[]')
    let articles: any[] = []
    if (ids.length) {
      const rows = await env.DB.prepare(
        `SELECT * FROM news WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at DESC`
      ).bind(...ids).all()
      articles = (rows.results || []).map(mapNews)
    }

    return json({
      keyword: narrative.keyword,
      label: narrative.label || narrative.keyword,
      status: narrative.status,
      firstSeen: narrative.first_seen,
      lastUpdated: narrative.last_updated,
      summary: narrative.summary,
      articleCount: ids.length,
      developmentCount: devs.length,
      sourceStats: JSON.parse(narrative.source_stats || '{}'),
      developments: devs,
      articles,
    })
  }

  const narratives = await loadActiveNarratives(env)
  const list = narratives.map(n => ({
    keyword: n.keyword,
    label: n.label || n.keyword,
    status: n.status,
    firstSeen: n.first_seen,
    lastUpdated: n.last_updated,
    summary: n.summary,
    developmentCount: (JSON.parse(n.developments || '[]') as any[]).length,
    articleCount: (JSON.parse(n.article_ids || '[]') as number[]).length,
    sourceStats: JSON.parse(n.source_stats || '{}'),
  }))

  return json({ narratives: list })
}
