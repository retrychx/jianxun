/** Phase: Controversy detection — extracts pro/con stances from disputed articles. */

import { fetchWithRetry } from '../analysis/deepseek.js'
import { DEEPSEEK_MODEL } from '../analysis/deepseek.js'
import { signalEvent } from '../cache.js'
import type { Env } from '../helpers.js'
import { CONFIG } from './config.js'

export async function detectControversy(env: Env) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { debates: 0 }

  // Find recently analyzed articles flagged as controversial
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, source, analysis_detail FROM news
     WHERE analyzed_at >= datetime('now', '-24 hours')
       AND analysis_detail LIKE '%controversy%true%'
     ORDER BY score DESC LIMIT 20`
  ).all<any>()
  const articles = (rows.results || []).filter(a => {
    try { const d = JSON.parse(a.analysis_detail); return d.controversy === true } catch { return false }
  })

  if (articles.length < 2) return { debates: 0 }

  // Group by shared topic (rough dedup by first 25 chars of title)
  const groups = new Map<string, any[]>()
  for (const a of articles) {
    const key = (a.title || '').slice(0, 25).toLowerCase().replace(/[^\w一-鿿]/g, '')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }

  let debates = 0
  for (const [, group] of groups) {
    if (group.length < 2) continue

    try {
      const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [{
            role: 'system',
            content: `你是新闻争议分析编辑。以下是多家媒体对同一争议事件的报道。提取核心争议点，归纳正反两方观点。只返回 JSON（不要其他文字）：

{
  "topic": "争议话题（≤20字中文）",
  "stancePro": "正方观点：≤60字，谁持什么立场",
  "stanceCon": "反方观点：≤60字，谁持什么立场",
  "keyDisagreement": "核心分歧点（≤40字）"
}`,
          }, {
            role: 'user',
            content: group.map(a => `[${a.source}]\n标题：${a.title}\n摘要：${(a.summary || '').slice(0, 200)}`).join('\n\n'),
          }],
          temperature: 0.2,
          max_tokens: 512,
        }),
      })
      if (!res?.ok) continue
      const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (!parsed.stancePro && !parsed.stanceCon) continue

      const keyword = `__debate__${parsed.topic || group[0].title.slice(0, 30)}`
      const ids = group.map(a => a.id)
      const summary = `正方: ${parsed.stancePro || ''}\n反方: ${parsed.stanceCon || ''}\n分歧: ${parsed.keyDisagreement || ''}`

      // Store as debate narrative
      await env.DB.prepare(
        `INSERT OR IGNORE INTO narratives (keyword,label,first_seen,last_updated,status,summary,developments,article_ids,source_stats)
         VALUES (?,?,date('now'),datetime('now'),'active',?,'[]',?,?)`
      ).bind(
        keyword,
        `⚡ 争议: ${parsed.topic || group[0].title.slice(0, 30)}`,
        summary.slice(0, 300),
        JSON.stringify(ids),
        JSON.stringify(Object.fromEntries([...new Set(group.map(a => a.source))].map(s => [s, 1]))),
      ).run()

      signalEvent('debate', {
        topic: parsed.topic || group[0].title.slice(0, 40),
        pro: (parsed.stancePro || '').slice(0, 100),
        con: (parsed.stanceCon || '').slice(0, 100),
      }).catch(() => {})

      debates++
    } catch {}
  }
  return { debates }
}
