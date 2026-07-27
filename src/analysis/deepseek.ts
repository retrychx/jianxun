/**
 * DeepSeek AI integration — all news-specific API calls.
 * Extracted from the former monolithic analysis.ts for clarity.
 *
 * Functions:
 *  - fetchWithRetry, extractContent
 *  - analyzeWithDeepSeek (summary, entities, sentiment, keyPoints)
 *  - generateTopicLabels, generateDigest, translateBatch
 *  - generateStoryline, generateAnswer
 *  - crossRefAnalysis (multi-source angle comparison)
 *  - titleSimilarity
 */

import { tokenize } from '../tokenize.js'
import { CONFIG } from '../agent/config.js'
import {
  ANALYSIS_PROMPT, TOPIC_LABELS_PROMPT, DIGEST_PROMPT, TRANSLATION_PROMPT,
  STORYLINE_PROMPT, ANSWER_PROMPT, CROSSREF_PROMPT, CLASSIFY_PROMPT,
} from './prompts.js'

export const DEEPSEEK_MODEL = CONFIG.deepseek.model

export async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.status >= 400 && res.status < 500) return res
      if (res.ok || i === retries) return res
    } catch { if (i === retries) return null }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)))
  }
  return null
}

export async function extractContent(url: string): Promise<{ content: string | null; image: string | null; title: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return { content: null, image: null, title: null }
    const html = await res.text()
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const pageTitle = titleMatch?.[1]?.trim() || null
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
    const image = imgMatch?.[1] || null
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    const metaDesc = descMatch?.[1] || null
    let text = ''
    const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<nav[\s\S]*?<\/nav>/gi,' ').replace(/<footer[\s\S]*?<\/footer>/gi,' ').replace(/<header[\s\S]*?<\/header>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&#?[a-z0-9]+;/gi,' ').replace(/\s+/g,' ').trim()
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (articleMatch) text = strip(articleMatch[1])
    if (text.length < 200) {
      const p: string[] = []; const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi; let m
      while ((m = pRe.exec(html)) !== null) { const c = strip(m[1]); if (c.length > 30) p.push(c) }
      if (p.length >= 3) text = p.join('\n')
    }
    if (text.length < 200) { const b = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i); text = strip(b?.[1] || html) }
    return { content: (text || metaDesc || null)?.slice(0, 8_000) || null, image, title: pageTitle }
  } catch { return { content: null, image: null, title: null } }
}

export interface DeepSeekResult {
  summary: string
  category: string
  entities: { name: string; type: string; weight: number; role?: string }[]
  sentiment: { label: string; scores: { positive: number; negative: number; neutral: number }; perspective: string }
}

export interface AnalysisDetail {
  keyPoints: string[]
  significance: string
  controversy: boolean
  impact: 'short' | 'medium' | 'high'
}

export async function analyzeWithDeepSeek(title: string, content: string, apiKey: string, pageTitle?: string | null): Promise<{ base: DeepSeekResult; detail: AnalysisDetail } | null> {
  const prompt = `你是一位资深科技新闻分析编辑。深刻理解这篇文章，返回以下 JSON（不要其他文字）：\n\n{\n  "summary": "2-3句精炼中文摘要，包含核心事实（谁/什么/影响）",\n  "keyPoints": ["要点1（≤20字）","要点2","要点3","要点4","要点5"],\n  "category": "AI|科技|财经|国际|政治|健康|体育|娱乐|游戏|教育|社会",\n  "entities": [\n    { "name": "实体名", "type": "person|company|product|technology|concept", "weight": 0.8, "role": "角色简述（≤10字）" }\n  ],\n  "sentiment": {\n    "label": "positive|negative|neutral|mixed",\n    "scores": { "positive": 0.x, "negative": 0.x, "neutral": 0.x },\n    "perspective": "报道角度和倾向简短描述（中文，≤20字）"\n  },\n  "significance": "这篇文章在当天新闻中的重要性判断（≤40字）",\n  "controversy": false,\n  "impact": "short|medium|high"\n}`
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: prompt }, { role: 'user', content: `标题: ${title}${pageTitle && pageTitle !== title ? `\n页面标题: ${pageTitle}` : ''}\n\n正文:\n${content.slice(0, 8000)}` }], temperature: 0.3, max_tokens: 1024 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content; if (!raw) return null
    const parsed = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim())
    return {
      base: { summary: parsed.summary || '无法生成摘要', category: parsed.category || '科技', entities: (parsed.entities || []).slice(0,6).map((e: any) => ({ name: e.name, type: e.type, weight: e.weight || 0.5, role: e.role })), sentiment: parsed.sentiment || { label:'neutral', scores:{ positive:0.3, negative:0.3, neutral:0.4 }, perspective:'' } },
      detail: { keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0,5) : [], significance: typeof parsed.significance === 'string' ? parsed.significance.slice(0,60) : '', controversy: !!parsed.controversy, impact: ['short','medium','high'].includes(parsed.impact) ? parsed.impact : 'medium' },
    }
  } catch { return null }
}

export async function generateTopicLabels(titleGroups: string[][], apiKey: string | undefined): Promise<string[] | null> {
  if (!apiKey || !titleGroups.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: TOPIC_LABELS_PROMPT }, { role: 'user', content: titleGroups.map((titles, i) => `[${i}]\n${titles.join('\n')}`).join('\n\n') }], temperature: 0.2, max_tokens: 1024 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) return null
    const parsed = JSON.parse(raw) as { index: number; label: string }[]
    const labels: string[] = []
    for (const r of parsed) { if (r && typeof r.label === 'string' && r.label.trim() && r.index >= 0 && r.index < titleGroups.length) labels[r.index] = r.label.trim().slice(0, 20) }
    return labels
  } catch { return null }
}

export interface DigestCandidate { id: number; title: string; summary?: string | null; category?: string; source?: string; heat?: number; _significance?: string; _controversy?: boolean }
export interface DigestResult { intro: string; items: { news_id: number; why: string; category: string }[]; extra: { news_id: number; why: string } | null }

export async function generateDigest(candidates: DigestCandidate[], apiKey: string | undefined): Promise<DigestResult | null> {
  if (!apiKey || !candidates.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: '你是中文科技日报主编。从候选新闻中挑出今天最重要的 10-20 条，做成一期"AI/科技行业日报"。只返回 JSON（不要其他文字）：\n{\n  "intro": "≤120字中文开场白，总览今日行业动态",\n  "items": [{ "news_id": 数字, "why": "≤30字，这条为什么重要", "category": "分类" }],\n  "extra": { "news_id": 数字, "why": "≤30字" } 或 null\n}\nitems 按重要性排序，尽可能多选但有价值的才选；extra 是最有趣/最轻松的一条番外，不得与 items 重复。news_id 必须来自候选列表。' }, { role: 'user', content: candidates.slice(0,30).map(c => { let d = `[${c.id}] ${c.title}（${c.source||'未知来源'}/${c.category||'科技'}/热度${c.heat||1}`; if (c._significance) d += `｜${c._significance}`; if (c._controversy) d += '｜有争议'; d += `）\n${(c.summary||'').slice(0,200)}`; return d }).join('\n\n') }], temperature: 0.2, max_tokens: 4096 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) return null
    const parsed = JSON.parse(raw); const validIds = new Set(candidates.map(c => c.id)); const seen = new Set<number>(); const items: DigestResult['items'] = []
    for (const it of (Array.isArray(parsed.items) ? parsed.items : [])) { const id = Number(it?.news_id); if (!validIds.has(id) || seen.has(id)) continue; seen.add(id); items.push({ news_id: id, why: String(it.why||'').slice(0,60), category: String(it.category||'科技') }); if (items.length >= 20) break }
    if (!items.length) return null
    let extra: DigestResult['extra'] = null; const extraId = Number(parsed.extra?.news_id)
    if (parsed.extra && validIds.has(extraId) && !seen.has(extraId)) extra = { news_id: extraId, why: String(parsed.extra.why||'').slice(0,60) }
    return { intro: String(parsed.intro||'').slice(0,200), items, extra }
  } catch { return null }
}

export async function translateBatch(articles: { id: number; title: string; summary: string }[], apiKey: string | undefined): Promise<{ id: number; title_zh: string; summary_zh: string }[] | null> {
  if (!apiKey || !articles.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: TRANSLATION_PROMPT }, { role: 'user', content: articles.map(a => `[${a.id}] ${a.title}\n${(a.summary||'').slice(0,300)}`).join('\n\n') }], temperature: 0.1, max_tokens: 2048 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) return null
    const parsed = JSON.parse(raw); const validIds = new Set(articles.map(a => a.id)); const out: { id: number; title_zh: string; summary_zh: string }[] = []
    for (const r of (Array.isArray(parsed) ? parsed : [])) { const id = Number(r?.id); if (!validIds.has(id) || typeof r.title_zh !== 'string' || !r.title_zh.trim()) continue; out.push({ id, title_zh: r.title_zh.trim(), summary_zh: typeof r.summary_zh === 'string' ? r.summary_zh.trim() : '' }) }
    return out
  } catch { return null }
}

export async function generateStoryline(articles: { title: string; summary: string }[], apiKey: string | undefined): Promise<string | null> {
  if (!apiKey || !articles.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: STORYLINE_PROMPT }, { role: 'user', content: articles.map(a => `${a.title}\n${(a.summary||'').slice(0,200)}`).join('\n\n') }], temperature: 0.2, max_tokens: 512 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.trim(); if (!raw) return null
    return raw.replace(/```[a-z]*\n?/g,'').replace(/^["「]|["」]$/g,'').trim().slice(0,300) || null
  } catch { return null }
}

export interface AskCandidate { id: number; title: string; titleZh?: string | null; summary?: string | null; summaryZh?: string | null; source?: string; publishedAt?: string | null }
export interface AskAnswer { answer: string; refs: number[] }

export async function generateAnswer(question: string, candidates: AskCandidate[], apiKey: string | undefined): Promise<AskAnswer | null> {
  if (!apiKey || !question || !candidates.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: '你是中文科技新闻编辑。根据候选新闻回答读者问题：不超过250字中文，事实必须来自候选新闻，候选里没有的信息就明说"暂无相关报道"。引用候选时在句末用 [n] 标注，n 为候选编号。只返回 JSON（不要其他文字）：\n{ "answer": "≤250字中文回答，含 [n] 引用", "refs": [被引用的候选编号] }' }, { role: 'user', content: `问题：${question}\n\n候选新闻：\n` + candidates.slice(0,30).map((c,i) => `[${i}] ${c.titleZh||c.title}（${c.source||'未知来源'}${c.publishedAt ? '/'+c.publishedAt.slice(0,10) : ''}）\n${((c.summaryZh||c.summary)||'').slice(0,200)}`).join('\n\n') }], temperature: 0.2, max_tokens: 1024 }),
    })
    if (!res || !res.ok) return null
    const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) return null
    const parsed = JSON.parse(raw); const answer = String(parsed.answer||'').trim(); if (!answer) return null
    const refs: number[] = [...new Set((Array.isArray(parsed.refs) ? parsed.refs : []).map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < candidates.length))]
    return { answer: answer.slice(0,500), refs }
  } catch { return null }
}

export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a)); const setB = new Set(tokenize(b))
  if (!setA.size || !setB.size) return 0
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  return intersection.size / new Set([...setA, ...setB]).size
}

export interface CrossRefResult { keyword: string; sources: { name: string; angle: string }[]; comparison: string; articleIds: number[] }

export async function crossRefAnalysis(groups: { source: string; title: string; summary: string }[][], apiKey: string | undefined): Promise<CrossRefResult[] | null> {
  if (!apiKey || !groups.length) return null
  const results: CrossRefResult[] = []
  for (const group of groups) {
    if (group.length < 2) continue
    const sources = group.map(g => g.source)
    try {
      const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: '你是新闻对比分析编辑。以下是多家媒体对同一事件的报道。比较各家的报道角度、侧重点和潜在倾向差异。只返回 JSON（不要其他文字）：\n{\n  "keyword": "报道的事件关键词（≤20字中文）",\n  "comparison": "≤100字对比分析：指出各源报道角度的关键差异"\n}' }, { role: 'user', content: group.map(g => `[${g.source}]\n标题：${g.title}\n摘要：${(g.summary||'').slice(0,200)}`).join('\n\n') }], temperature: 0.2, max_tokens: 512 }),
      })
      if (!res?.ok) continue
      const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed.comparison) results.push({ keyword: parsed.keyword || group.map(g => g.title).join(' | ').slice(0,60), sources: sources.map(s => ({ name: s, angle: '' })), comparison: parsed.comparison.slice(0,200), articleIds: [] })
    } catch {}
  }
  return results.length ? results : null
}

/** Batch reclassify low-confidence articles by title. */
export async function batchClassify(
  articles: { id: number; title: string }[],
  apiKey: string,
): Promise<{ index: number; category: string }[]> {
  const { CLASSIFY_PROMPT } = await import('./prompts.js')
  const texts = articles.map((a, idx) => `[${idx}] ${a.title}`).join('\n')
  const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: CLASSIFY_PROMPT }, { role: 'user', content: texts }], temperature: CONFIG.deepseek.temperature.classification, max_tokens: 1024 }),
  })
  if (!res?.ok) return []
  const raw = (await res.json() as any).choices?.[0]?.message?.content?.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
  if (!raw) return []
  try { return JSON.parse(raw) as { index: number; category: string }[] } catch { return [] }
}

/** Generate a narrative "development" text from new articles for a tracked story. */
export async function generateNarrativeDevelopment(
  articles: { source: string; title: string; summary: string }[],
  label: string,
  apiKey: string,
): Promise<string | null> {
  const { NARRATIVE_PROMPT } = await import('./prompts.js')
  const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(CONFIG.deepseek.timeouts.narrative),
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: NARRATIVE_PROMPT(label) }, { role: 'user', content: articles.map(a => `[${a.source}] ${a.title}\n${a.summary.slice(0,200)}`).join('\n\n') }], temperature: CONFIG.deepseek.temperature.narrative, max_tokens: 256 }),
  })
  if (!res?.ok) return null
  const raw = (await res.json() as any).choices?.[0]?.message?.content?.trim()
  return raw?.replace(/```[a-z]*\n?/g,'').replace(/^["\u201c]|["\u201d]$/g,'').trim().slice(0,200) || null
}

/** Generate or refresh a narrative summary from all associated articles. */
export async function generateNarrativeSummary(
  articles: { title: string; summary: string }[],
  label: string,
  apiKey: string,
): Promise<string | null> {
  const { NARRATIVE_SUMMARY_PROMPT } = await import('./prompts.js')
  const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(CONFIG.deepseek.timeouts.narrative),
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: NARRATIVE_SUMMARY_PROMPT(label) }, { role: 'user', content: articles.slice(0,20).map(a => `${a.title}\n${a.summary.slice(0,200)}`).join('\n\n') }], temperature: CONFIG.deepseek.temperature.narrative, max_tokens: 256 }),
  })
  if (!res?.ok) return null
  return (await res.json() as any).choices?.[0]?.message?.content?.trim()?.slice(0,300) || null
}
