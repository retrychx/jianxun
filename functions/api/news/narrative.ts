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

    const articleIds: number[] = JSON.parse(narrative.article_ids || '[]')
    let articles: any[] = []
    if (articleIds.length) {
      const rows = await env.DB.prepare(
        `SELECT * FROM news WHERE id IN (${articleIds.map(() => '?').join(',')}) ORDER BY published_at DESC`
      ).bind(...articleIds).all()
      articles = (rows.results || []).map(mapNews)
    }

    return json({
      ...narrative,
      developments: JSON.parse(narrative.developments || '[]'),
      articleIds,
      articles,
      sourceStats: JSON.parse(narrative.source_stats || '{}'),
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
