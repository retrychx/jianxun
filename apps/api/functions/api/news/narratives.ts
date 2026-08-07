import { json } from '../../../src/handler'
import { loadActiveNarratives } from '../../../src/agent'
import { cacheGet, cacheSet, CACHE_TTL } from '../../../src/cache.js'

export async function onRequestGet(context: any) {
  try {
    const { env } = context

    const cached = await cacheGet<any>('narratives_timeline'); if (cached) return json(cached)

    const narratives = await loadActiveNarratives(env)
    const timeline = new Map<string, any[]>()

    for (const n of narratives) {
      // 单个叙事数据损坏不应让整个 timeline 500
      let devs: any[] = []; try { devs = JSON.parse(n.developments || '[]'); if (!Array.isArray(devs)) devs = [] } catch { devs = [] }
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

    const sorted = [...timeline.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => ({ date, items }))
    const payload = { timeline: sorted }
    await cacheSet('narratives_timeline', payload, CACHE_TTL.briefing)
    return json(payload)
  } catch (e: any) {
    return json({ error: e?.message || 'internal error' }, 500)
  }
}
