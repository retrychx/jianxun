import type { HandlerContext } from '../../../src/pages.js'
import { json, mapNews } from '../../../src/handler'
import { loadActiveNarratives, loadSingleNarrative } from '../../../src/agent'
import { getNarrativeOutlook } from '../../../src/agent/intel'

// Returns either:
//   GET /api/news/narrative — list of all active/stale narratives
//   GET /api/news/narrative?keyword=xxx — single narrative detail

export async function onRequestGet(context: HandlerContext) {
  const { request, env } = context
  const url = new URL(request.url)
  const keyword = url.searchParams.get('keyword')

  if (keyword) {
    const narrative = await loadSingleNarrative(env, keyword)
    if (!narrative) return json({ error: 'Narrative not found' }, 404)

    const devs: any[] = JSON.parse(narrative.developments || '[]')
    const ids: number[] = JSON.parse(narrative.article_ids || '[]')
    let articles: any[] = []
    let allEntities: { name: string; type: string }[] = []
    if (ids.length) {
      const rows = await env.DB.prepare(
        `SELECT * FROM news WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at DESC`
      ).bind(...ids).all()
      articles = (rows.results || []).map(mapNews)
      // 提取当前叙事实体
      const seen = new Set<string>()
      for (const a of articles) {
        const raw = a.entities
        if (raw) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
            if (Array.isArray(parsed)) {
              for (const e of parsed) {
                const name = e?.name?.trim().toLowerCase()
                if (name && name.length >= 2 && !seen.has(name)) {
                  seen.add(name)
                  allEntities.push({ name: e.name, type: e.type || 'concept' })
                }
              }
            }
          } catch {}
        }
      }
    }

    // 关联叙事：找其他叙事中文章包含相同实体的
    const related: { keyword: string; label: string; overlap: number; articleCount: number }[] = []
    if (allEntities.length > 0) {
      const others = await loadActiveNarratives(env)
      for (const other of others) {
        if (other.keyword === keyword) continue
        try {
          const otherIds: number[] = JSON.parse(other.article_ids || '[]')
          const overlap = otherIds.filter(id => ids.includes(id)).length
          const otherKeyword = (other.label || other.keyword || '').toLowerCase()
          // 实体名匹配（叙事标签中包含当前叙事实体名）
          const entityMatch = allEntities.filter(e => otherKeyword.includes(e.name.toLowerCase())).length
          const totalOverlap = overlap + entityMatch * 2
          if (totalOverlap > 0) {
            related.push({
              keyword: other.keyword,
              label: other.label || other.keyword,
              overlap: totalOverlap,
              articleCount: otherIds.length,
            })
          }
        } catch {}
      }
      related.sort((a, b) => b.overlap - a.overlap)
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
      entities: allEntities.slice(0, 30),
      related: related.slice(0, 6),
      outlook: await getNarrativeOutlook(env, keyword),
    })
  }

  const narratives = await loadActiveNarratives(env)
  const list = narratives.map(n => {
    const devs = (() => { try { return JSON.parse(n.developments || '[]') } catch { return [] } })() as any[]
    const latest = devs[devs.length - 1]
    return {
      keyword: n.keyword,
      label: n.label || n.keyword,
      status: n.status,
      firstSeen: n.first_seen,
      lastUpdated: n.last_updated,
      summary: n.summary,
      developmentCount: devs.length,
      articleCount: (JSON.parse(n.article_ids || '[]') as number[]).length,
      sourceStats: JSON.parse(n.source_stats || '{}'),
      // 叙事周报：最新一条进展
      latest: latest?.text || null,
      latestDate: latest?.date || null,
    }
  })

  return json({ narratives: list })
}
