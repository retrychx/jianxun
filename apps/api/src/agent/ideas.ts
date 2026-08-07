/**
 * 每日产品灵感（孵化 demo 的信号源）——
 * agent 每天基于当日热门新闻/叙事，用 DeepSeek flash 生成 1-3 个产品 idea。
 * 存进 agent_meta，前端"灵感"视图展示。
 */

import { fetchWithRetry, DEEPSEEK_MODEL } from '../analysis/deepseek.js'
import type { Env } from '../helpers.js'

const IDEAS_KEY = 'product_ideas'
const DATE_KEY = 'product_ideas_date'

export async function generateProductIdeas(env: Env): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 0

  // 每天一次（按北京时间）
  const dateRow = await env.DB.prepare("SELECT date('now', '+8 hours') as d").first<any>()
  const today = dateRow?.d
  if (!today) return 0
  const doneRow = await env.DB.prepare('SELECT value FROM agent_meta WHERE key = ?').bind(DATE_KEY).first<any>()
  if (doneRow?.value === today) return 0

  // 收集今日热门信号：高分文章 + 升温叙事
  const [articles, narrs] = await Promise.all([
    env.DB.prepare(
      `SELECT title, summary, category, source FROM news
       WHERE published_at >= datetime('now', '-48 hours') AND score >= 60
       ORDER BY score DESC LIMIT 15`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT label FROM narratives WHERE status = 'active'
       ORDER BY last_updated DESC LIMIT 8`,
    ).all<any>(),
  ])
  const hotList = [
    ...(articles.results || []).map((a: any) => `[${a.category}/${a.source}] ${a.title}`),
    ...(narrs.results || []).map((n: any) => `[叙事] ${n.label || ''}`),
  ].slice(0, 20)
  if (hotList.length < 5) return 0

  const prompt = `你是产品孵化顾问。基于以下今天的热门科技新闻，给出 1-3 个可以做成独立产品 demo 的想法。注意：不是给现有新闻产品加功能，而是从这些信号里发现可以孵化成全新小产品的机会。

每个想法输出 JSON（只输出 JSON，不要其他文字）：
{
  "ideas": [
    {
      "signal": "哪条新闻/信号启发你（≤40字）",
      "title": "产品名（≤20字）",
      "concept": "一句话产品概念（≤80字）",
      "whyNow": "为什么现在值得做（≤40字）",
      "audience": "目标用户（≤30字）"
    }
  ]
}

选最有孵化价值的 1-3 个，宁缺毋滥。今天的热门：
${hotList.join('\n')}`

  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'system', content: '你只输出合法 JSON，不要任何其他文字。' }, { role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 1200,
      }),
    })
    if (!res?.ok) return 0
    const raw = (await res.json() as any).choices?.[0]?.message?.content
      ?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, 3).filter((i: any) => i?.title && i?.concept) : []
    if (!ideas.length) return 0

    await env.DB.prepare('INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)')
      .bind(IDEAS_KEY, JSON.stringify({ date: today, ideas })).run()
    await env.DB.prepare('INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)')
      .bind(DATE_KEY, today).run()
    return ideas.length
  } catch (e: any) {
    console.error('[ideas] generate failed:', e?.message)
    return 0
  }
}
