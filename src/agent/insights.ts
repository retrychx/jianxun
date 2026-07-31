/**
 * Agent 智能洞察 — 从"记录数据"升级为"产出分析"
 * 1. 叙事前瞻（what to watch next）
 * 2. 实体事件抽取（funding/product/exec/regulatory/financial）
 * 3. 热度解释（why hot）
 */
import type { Env } from '../helpers.js'
import { fetchWithRetry } from '../analysis/deepseek.js'
import { CONFIG } from './config.js'

const MODEL = CONFIG.deepseek.model

/** 通用 AI 调用 */
async function callAI(apiKey: string, system: string, user: string, maxTokens = 256, timeoutMs = 20000): Promise<string | null> {
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens }),
    })
    if (!res?.ok) return null
    return ((await res.json() as any).choices?.[0]?.message?.content || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim() || null
  } catch { return null }
}

/** 生成叙事前瞻：下一步关注什么 */
export async function generateNarrativeOutlook(env: Env, keyword: string, label: string, summary: string, recentDevs: string[]): Promise<string | null> {
  const k = env.DEEPSEEK_API_KEY
  if (!k) return null
  const user = `以下是"${label}"叙事的摘要和近期进展，请输出"下一步值得关注什么"（≤60字中文，前瞻性判断，不要说"继续关注"这类废话）：\n\n摘要：${summary.slice(0,200)}\n\n近期进展：${recentDevs.slice(0,3).map((d,i)=>`${i+1}. ${d.slice(0,120)}`).join('\n')}`
  return callAI(k, '输出≤60字中文前瞻判断', user, 128)
}

/** 抽取实体结构化事件 */
export async function extractEntityEvents(env: Env, entity: string, articles: { title: string; summary: string }[]): Promise<any[]> {
  const k = env.DEEPSEEK_API_KEY
  if (!k || !articles.length) return []
  const user = `从以下与"${entity}"相关的报道中，抽取结构化事件。只输出 JSON 数组（不要其他文字）：\n[{"type":"funding|product|exec|regulatory|financial|partnership|other","title":"事件标题（≤20字）","date":"YYYY-MM-DD（如有）","detail":"≤40字描述"}]\n\n报道：\n${articles.slice(0,8).map(a=>`- ${a.title}\n  ${(a.summary||'').slice(0,100)}`).join('\n')}`
  try {
    const raw = await callAI(k, '抽取结构化事件，只输出 JSON 数组', user, 512, 25000)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 6) : []
  } catch { return [] }
}

/** 生成热度解释 */
export async function explainTrending(env: Env, title: string, sources: string[], heat: number): Promise<string | null> {
  const k = env.DEEPSEEK_API_KEY
  if (!k) return null
  const user = `标题：${title}\n覆盖媒体：${sources.join(',')}\n热度：${heat} 家媒体报道\n\n为什么这条新闻热？`
  return callAI(k, '输出≤40字中文"为什么热"，不要说废话', user, 80, 15000)
}
