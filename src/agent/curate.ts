/** Phase 11: AI-curated daily briefing — replaces the rule-based selection. */

import { fetchWithRetry } from '../analysis/deepseek.js'
import { DEEPSEEK_MODEL } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'
import { CONFIG } from './config.js'

const BRIEFING_META_KEY = 'briefing_curated'

export async function curateBriefing(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { briefing: 0 }

  // Gather candidates from agent-enriched data
  const candidates: any[] = []

  // ── Breaking news (top priority) ──
  const breaking = await env.DB.prepare(
    "SELECT keyword, label FROM narratives WHERE keyword LIKE '__breaking__%' AND status = 'active' ORDER BY last_updated DESC LIMIT 5"
  ).all<any>()
  for (const n of (breaking.results || [])) {
    const ids = await env.DB.prepare("SELECT id, title, summary, source, score, published_at, analysis_detail FROM news WHERE id IN (SELECT value FROM json_each((SELECT article_ids FROM narratives WHERE keyword = ?)))").bind(n.keyword).all<any>()
    for (const a of (ids.results || [])) {
      try { const d = JSON.parse(a.analysis_detail || '{}'); a._isBreaking = true; a._significance = d.significance || ''; a._impact = d.impact; a._controversy = d.controversy } catch {}
      candidates.push(a)
    }
  }

  // ── High-impact articles ──
  const highImpact = await env.DB.prepare(
    `SELECT id, title, summary, source, score, published_at, analysis_detail FROM news
     WHERE analyzed_at >= datetime('now', '-24 hours') AND analysis_detail IS NOT NULL
     ORDER BY score DESC LIMIT 30`
  ).all<any>()
  for (const a of (highImpact.results || [])) {
    try { const d = JSON.parse(a.analysis_detail); a._significance = d.significance || ''; a._impact = d.impact; a._controversy = d.controversy } catch {}
    if (!candidates.some(c => c.id === a.id)) candidates.push(a)
  }

  // ── Narrative-tracked stories ──
  const narratives = await env.DB.prepare(
    "SELECT keyword, article_ids FROM narratives WHERE status = 'active' AND keyword NOT LIKE '__%' ORDER BY last_updated DESC LIMIT 10"
  ).all<any>()
  for (const n of (narratives.results || [])) {
    const ids = await env.DB.prepare("SELECT id, title, summary, source, score, published_at FROM news WHERE id IN (SELECT value FROM json_each((SELECT article_ids FROM narratives WHERE keyword = ?))) ORDER BY score DESC LIMIT 3").bind(n.keyword).all<any>()
    for (const a of (ids.results || [])) {
      if (!candidates.some(c => c.id === a.id)) { a._narrative = n.keyword; candidates.push(a) }
    }
  }

  if (candidates.length < 3) return { briefing: 0 }

  // Dedup by id
  const seen = new Set<number>()
  const deduped = candidates.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true }).slice(0, 25)

  // Send to DeepSeek for curation
  const prompt = `你是"简讯"的主编。从候选新闻中挑出今天最重要的 7-10 条做简报。

每个候选附带标签：
- 📰 来源
- 🔥 热度
- ⭐ 重要性判断
- 🚨 突发
- 📖 有叙事追踪
- ⚡ 有争议

选择原则：
1. 🚨 突发新闻优先
2. ⭐ 重要性高的优先（impact=high）
3. 📖 有持续叙事价值的优先
4. 同一事件保留最多 2 条不同来源
5. 覆盖不同类别

只返回 JSON 数组（不要其他文字）：
[{ "id": 数字, "why": "≤30字中文，为什么重要" }]`

  const articlesText = deduped.map(a => {
    let tags = `[${a.id}] ${a.title}（${a.source || '未知'}`
    if (a.score) tags += `/🔥${a.score}`
    if (a._isBreaking || a.keyword?.startsWith('__breaking__')) tags += '/🚨突发'
    if (a._impact === 'high') tags += '/⭐重要'
    if (a._controversy) tags += '/⚡争议'
    if (a._narrative) tags += '/📖叙事'
    if (a._significance) tags += `｜${a._significance.slice(0, 30)}`
    tags += `）\n${(a.summary || '').slice(0, 150)}`
    return tags
  }).join('\n\n')

  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: prompt }, { role: 'user', content: articlesText }], temperature: 0.2, max_tokens: 2048 }),
    })
    if (!res?.ok) return { briefing: 0 }
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
    if (!raw) return { briefing: 0 }
    const items = JSON.parse(raw) as { id: number; why: string }[]
    if (!Array.isArray(items) || !items.length) return { briefing: 0 }

    // Validate IDs and build enriched response
    const validIds = items.map(i => i.id).filter(Boolean)
    const rows = await env.DB.prepare(
      `SELECT id, title, title_zh, source, score, heat FROM (
        SELECT n.*, (SELECT COUNT(*) FROM news n2 WHERE n2.title_norm = n.title_norm) AS heat FROM news n WHERE n.id IN (${validIds.map(() => '?').join(',')})
      )`
    ).bind(...validIds).all<any>()
    const articleMap = new Map((rows.results || []).map(r => [r.id, r]))

    const curated = items.flatMap(i => {
      const a = articleMap.get(i.id)
      if (!a) return []
      return [{ id: a.id, title: a.title, titleZh: a.title_zh || null, source: a.source, heat: a.heat || 1, score: a.score, reason: (i.why || '').slice(0, 60) }]
    })

    if (!curated.length) return { briefing: 0 }

    // Store in cache-friendly format
    await env.DB.prepare(
      "INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)"
    ).bind(BRIEFING_META_KEY, JSON.stringify({ items: curated, updatedAt: new Date().toISOString() })).run()

    return { briefing: curated.length }
  } catch {
    return { briefing: 0 }
  }
}
