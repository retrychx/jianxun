import { json } from '../../../src/handler'
import { loadActiveNarratives } from '../../../src/agent'

// GET /api/news/narratives — aggregated timeline of all active narrative activity,
// grouped by date, across all tracked topics.  Useful for a "what happened today" view.

export async function onRequestGet(context: any) {
  const { env } = context
  const narratives = await loadActiveNarratives(env)

  // Build a date-keyed timeline from all developments
  const timeline = new Map<string, any[]>()

  for (const n of narratives) {
    const devs: any[] = JSON.parse(n.developments || '[]')
    for (const d of devs) {
      const date = d.date || 'unknown'
      if (!timeline.has(date)) timeline.set(date, [])
      timeline.get(date)!.push({
        keyword: n.keyword,
        label: n.label || n.keyword,
        text: d.text,
        articleCount: d.articleCount,
        sources: d.sources || [],
      })
    }
  }

  // Sort by date descending
  const sorted = [...timeline.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }))

  return json({ timeline: sorted })
}
