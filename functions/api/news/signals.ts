// GET /api/news/signals — 行业早期信号 + 公司监控 + 来源可信度
import { json } from '../../../src/handler'

const CREDIBILITY = [
  ['36氪', '量子位', '虎嗅', '钛媒体', '爱范儿', '品玩', '雷锋网', '动点科技', '中国新闻网', 'IT之家', '凤凰网科技', '搜狐科技', '新浪科技'],
  ['MIT Tech Review', 'The Verge', 'TechCrunch', 'Ars Technica', 'Wired', 'New Scientist', 'Simon Willison', 'Quanta Magazine'],
]

function sourceCredibility(source: string): { score: number; label: string } {
  if (CREDIBILITY[0].includes(source)) return { score: 4, label: '高' }
  if (CREDIBILITY[1].includes(source)) return { score: 4, label: '高' }
  return { score: 2, label: '一般' }
}

export async function onRequestGet(context: any) {
  const { env } = context

  // 1. 叙事热度变化（今日 vs 昨日）
  const today = await env.DB.prepare(`
    SELECT keyword, label, last_updated, article_ids, source_stats, developments
    FROM narratives WHERE status = 'active' AND last_updated >= datetime('now', '-24 hours')
  `).all<any>()
  const narratives = (today.results || []) as any[]

  // 计算每个叙事的当前热度和 24h 内新增文章
  const signals: any[] = []
  for (const n of narratives) {
    const ids: number[] = (() => { try { return JSON.parse(n.article_ids || '[]') } catch { return [] } })()
    const srcs: Record<string, number> = (() => { try { return JSON.parse(n.source_stats || '{}') } catch { return {} } })()
    const devs: any[] = (() => { try { return JSON.parse(n.developments || '[]') } catch { return [] } })()
    const hoursSince = Math.round((Date.now() - new Date(n.last_updated).getTime()) / 3600000)
    const heat = Object.keys(srcs).length * 0.4 + devs.length * 0.3 + ids.length * 0.2 + Math.max(0, 24 - hoursSince) * 0.1
    const newSinceYesterday = Math.max(0, 24 - hoursSince)
    signals.push({
      keyword: n.keyword,
      label: (n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim(),
      heat: Math.round(heat),
      newArticles: newSinceYesterday,
      sourceCount: Object.keys(srcs).length,
      articleCount: ids.length,
      hoursSince,
    })
  }
  // 热度变化（最近更新的排前）
  signals.sort((a, b) => b.heat - a.heat)
  const risingNarratives = signals.filter(s => s.hoursSince <= 24).slice(0, 6)

  // 2. 今日高产信源 + 可信度
  const srcRows: any = await env.DB.prepare(`
    SELECT source, COUNT(*) as cnt FROM news
    WHERE created_at >= datetime('now', '-1 day')
    GROUP BY source ORDER BY cnt DESC LIMIT 8
  `).all()
  const sources = ((srcRows.results || []) as any[]).map(r => ({
    name: r.source,
    count: r.cnt,
    credibility: sourceCredibility(r.source).score,
    trustLabel: sourceCredibility(r.source).label,
  }))

  // 3. 热点实体（从文章实体提取）
  const entityRows: any = await env.DB.prepare(`
    SELECT entities FROM news
    WHERE entities IS NOT NULL AND entities != '' AND created_at >= datetime('now', '-1 day')
    LIMIT 200
  `).all()
  const entityCount = new Map<string, number>()
  for (const r of (entityRows.results || [])) {
    try {
      const parsed = typeof r.entities === 'string' ? JSON.parse(r.entities) : r.entities
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          const name = e?.name?.trim()
          if (name && name.length >= 2) entityCount.set(name, (entityCount.get(name) || 0) + 1)
        }
      }
    } catch {}
  }
  const hotEntities = [...entityCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  return json({ risingNarratives, sources, hotEntities })
}
