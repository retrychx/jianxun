import { tokenize } from './tokenize.js'

/** DeepSeek model used for all AI analysis calls. Override via DEEPSEEK_MODEL env var. */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'

/**
 * Fetch with automatic retry on transient failures (network errors, 5xx, 429).
 * Does NOT retry on 4xx client errors (they are permanent).
 */
export async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options)
      // 4xx errors are permanent — don't retry
      if (res.status >= 400 && res.status < 500) return res
      if (res.ok || i === retries) return res
    } catch {
      if (i === retries) return null
    }
    // Exponential backoff: 1s, 2s
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

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const pageTitle = titleMatch?.[1]?.trim() || null

    // Extract OG image
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
    const image = imgMatch?.[1] || null

    // Extract meta description (fallback if no article body found)
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    const metaDesc = descMatch?.[1] || null

    // Content extraction: prefer <article>, then <p> blocks, then body fallback
    let text = ''
    const stripTags = (s: string) => s
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#?[a-z0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Strategy A: <article> tag content
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (articleMatch) {
      text = stripTags(articleMatch[1])
    }

    // Strategy B: meaningful <p> blocks (most CMS use <p> for article body)
    if (text.length < 200) {
      const paragraphs: string[] = []
      const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
      let pMatch
      while ((pMatch = pRe.exec(html)) !== null) {
        const clean = stripTags(pMatch[1])
        if (clean.length > 30) paragraphs.push(clean)
      }
      if (paragraphs.length >= 3) {
        text = paragraphs.join('\n')
      }
    }

    // Strategy C: <body> fallback
    if (text.length < 200) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
      text = stripTags(bodyMatch?.[1] || html)
    }

    const content = (text || metaDesc || null)?.slice(0, 8_000) || null
    return { content, image, title: pageTitle }
  } catch {
    return { content: null, image: null, title: null }
  }
}


export interface DeepSeekResult {
  summary: string
  category: string
  entities: { name: string; type: string; weight: number; role?: string }[]
  sentiment: { label: string; scores: { positive: number; negative: number; neutral: number }; perspective: string }
}

/** Enhanced analysis detail stored in news.analysis_detail */
export interface AnalysisDetail {
  keyPoints: string[]
  significance: string
  controversy: boolean
  impact: 'short' | 'medium' | 'high'
}

export async function analyzeWithDeepSeek(title: string, content: string, apiKey: string, pageTitle?: string | null): Promise<{
  base: DeepSeekResult
  detail: AnalysisDetail
} | null> {
  const prompt = `你是一位资深科技新闻分析编辑。深刻理解这篇文章，返回以下 JSON（不要其他文字）：

{
  "summary": "2-3句精炼中文摘要，包含核心事实（谁/什么/影响）",
  "keyPoints": ["要点1（≤20字）", "要点2（≤20字）", "要点3（≤20字）", "要点4", "要点5"],
  "category": "AI|科技|财经|国际|政治|健康|体育|娱乐|游戏|教育|社会",
  "entities": [
    { "name": "实体名", "type": "person|company|product|technology|concept", "weight": 0.8, "role": "角色简述（≤10字）" }
  ],
  "sentiment": {
    "label": "positive|negative|neutral|mixed",
    "scores": { "positive": 0.x, "negative": 0.x, "neutral": 0.x },
    "perspective": "报道角度和倾向简短描述（中文，≤20字）"
  },
  "significance": "这篇文章在当天新闻中的重要性判断（≤40字，说明为什么值得关注）",
  "controversy": false,
  "impact": "short|medium|high"
}

注意：
- summary 必须包含谁/做了什么/影响，不要空泛
- keyPoints 提炼文章的核心论据，每条一个完整信息点
- significance 说明对读者的意义，不只是重复标题
- controversy 为 true 时代表该报道存在争议或正反双方观点`

  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `标题: ${title}${pageTitle && pageTitle !== title ? `\n页面标题: ${pageTitle}` : ''}\n\n正文:\n${content.slice(0, 8000)}` },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null

    const json = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(json)
    return {
      base: {
        summary: parsed.summary || '无法生成摘要',
        category: parsed.category || '科技',
        entities: (parsed.entities || []).slice(0, 6).map((e: any) => ({ name: e.name, type: e.type, weight: e.weight || 0.5, role: e.role })),
        sentiment: parsed.sentiment || { label: 'neutral', scores: { positive: 0.3, negative: 0.3, neutral: 0.4 }, perspective: '' },
      },
      detail: {
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5) : [],
        significance: typeof parsed.significance === 'string' ? parsed.significance.slice(0, 60) : '',
        controversy: !!parsed.controversy,
        impact: ['short', 'medium', 'high'].includes(parsed.impact) ? parsed.impact : 'medium',
      },
    }
  } catch {
    return null
  }
}

// One DeepSeek call names every topic cluster with a short Chinese label (<=10 chars).
// Returns a sparse array aligned with titleGroups, or null when the call is unavailable/fails;
// callers fall back to keyword labels per cluster.
export async function generateTopicLabels(titleGroups: string[][], apiKey: string | undefined): Promise<string[] | null> {
  if (!apiKey || !titleGroups.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是新闻话题编辑。根据每组新闻标题为每组起一个话题标签：不超过10个字的中文短句，像人话，不要关键词堆砌，不要标点。只返回JSON数组：[{"index":0,"label":"..."},...]'
          },
          {
            role: 'user',
            content: titleGroups.map((titles, i) => `[${i}]\n${titles.join('\n')}`).join('\n\n')
          }
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!raw) return null

    const parsed = JSON.parse(raw) as { index: number; label: string }[]
    const labels: string[] = []
    for (const r of parsed) {
      if (r && typeof r.label === 'string' && r.label.trim() && r.index >= 0 && r.index < titleGroups.length) {
        labels[r.index] = r.label.trim().slice(0, 20)
      }
    }
    return labels
  } catch {
    return null
  }
}

export interface DigestCandidate {
  id: number
  title: string
  summary?: string | null
  category?: string
  source?: string
  heat?: number
  /** Enriched by caller from analysis_detail */
  _significance?: string
  _controversy?: boolean
}

export interface DigestResult {
  intro: string
  items: { news_id: number; why: string; category: string }[]
  extra: { news_id: number; why: string } | null
}

// Picks the day's 10-20 most important AI/tech stories plus one lighthearted extra.
// Returns null when the call is unavailable/fails; ids are validated against candidates.
export async function generateDigest(candidates: DigestCandidate[], apiKey: string | undefined): Promise<DigestResult | null> {
  if (!apiKey || !candidates.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是中文科技日报主编。从候选新闻中挑出今天最重要的 10-20 条，做成一期"AI/科技行业日报"。只返回 JSON（不要其他文字）：
{
  "intro": "≤120字中文开场白，总览今日行业动态",
  "items": [{ "news_id": 数字, "why": "≤30字，这条为什么重要", "category": "分类" }],
  "extra": { "news_id": 数字, "why": "≤30字" } 或 null
}
items 按重要性排序，尽可能多选但有价值的才选；extra 是最有趣/最轻松的一条番外，不得与 items 重复。news_id 必须来自候选列表。`
          },
          {
            role: 'user',
            content: candidates.slice(0, 30).map(c => {
              let detail = `[${c.id}] ${c.title}（${c.source || '未知来源'}/${c.category || '科技'}/热度${c.heat || 1}`
              if (c._significance) detail += `｜${c._significance}`
              if (c._controversy) detail += '｜有争议'
              detail += `）\n${(c.summary || '').slice(0, 200)}`
              return detail
            }).join('\n\n')
          }
        ],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const validIds = new Set(candidates.map(c => c.id))
    const seen = new Set<number>()
    const items: DigestResult['items'] = []
    for (const it of (Array.isArray(parsed.items) ? parsed.items : [])) {
      const id = Number(it?.news_id)
      if (!validIds.has(id) || seen.has(id)) continue
      seen.add(id)
      items.push({ news_id: id, why: String(it.why || '').slice(0, 60), category: String(it.category || '科技') })
      if (items.length >= 20) break
    }
    if (!items.length) return null

    let extra: DigestResult['extra'] = null
    const extraId = Number(parsed.extra?.news_id)
    if (parsed.extra && validIds.has(extraId) && !seen.has(extraId)) {
      extra = { news_id: extraId, why: String(parsed.extra.why || '').slice(0, 60) }
    }
    return { intro: String(parsed.intro || '').slice(0, 200), items, extra }
  } catch {
    return null
  }
}

// Translates English titles/summaries into Chinese in one call.
// Returns null when the call fails; entries with unknown ids or empty title_zh are dropped.
export async function translateBatch(articles: { id: number; title: string; summary: string }[], apiKey: string | undefined): Promise<{ id: number; title_zh: string; summary_zh: string }[] | null> {
  if (!apiKey || !articles.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是翻译助手。把以下英文新闻的标题和摘要翻译成中文，summary_zh 不超过80字、忠实原意。只返回 JSON 数组：[{"id":数字,"title_zh":"...","summary_zh":"..."},...]'
          },
          {
            role: 'user',
            content: articles.map(a => `[${a.id}] ${a.title}\n${(a.summary || '').slice(0, 300)}`).join('\n\n')
          }
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const validIds = new Set(articles.map(a => a.id))
    const out: { id: number; title_zh: string; summary_zh: string }[] = []
    for (const r of (Array.isArray(parsed) ? parsed : [])) {
      const id = Number(r?.id)
      if (!validIds.has(id) || typeof r.title_zh !== 'string' || !r.title_zh.trim()) continue
      out.push({ id, title_zh: r.title_zh.trim(), summary_zh: typeof r.summary_zh === 'string' ? r.summary_zh.trim() : '' })
    }
    return out
  } catch {
    return null
  }
}

// Writes a <=150字 "前情提要" for a topic cluster from its top titles/summaries.
// Returns null when unavailable; callers degrade to showing the article list only.
export async function generateStoryline(articles: { title: string; summary: string }[], apiKey: string | undefined): Promise<string | null> {
  if (!apiKey || !articles.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是新闻专题编辑。根据同一话题的多篇报道，写一段"前情提要"：不超过150字中文，按时间脉络讲清这件事的来龙去脉。只返回提要正文，不要 JSON、不要引号。'
          },
          {
            role: 'user',
            content: articles.map(a => `${a.title}\n${(a.summary || '').slice(0, 200)}`).join('\n\n')
          }
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.trim()
    if (!raw) return null
    return raw.replace(/```[a-z]*\n?/g, '').replace(/^["「]|["」]$/g, '').trim().slice(0, 300) || null
  } catch {
    return null
  }
}

export interface AskCandidate {
  id: number
  title: string
  titleZh?: string | null
  summary?: string | null
  summaryZh?: string | null
  source?: string
  publishedAt?: string | null
}

export interface AskAnswer {
  answer: string
  /** 引用的候选数组下标（已按 candidates 范围校验、去重） */
  refs: number[]
}

// Answers a reader question in Chinese (<=250字) from up to 30 candidate articles,
// citing them as [n] where n is the candidate array index.
// Returns null when the call is unavailable/fails; callers degrade to answer:null.
export async function generateAnswer(question: string, candidates: AskCandidate[], apiKey: string | undefined): Promise<AskAnswer | null> {
  if (!apiKey || !question || !candidates.length) return null
  try {
    const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是中文科技新闻编辑。根据候选新闻回答读者问题：不超过250字中文，事实必须来自候选新闻，候选里没有的信息就明说"暂无相关报道"。引用候选时在句末用 [n] 标注，n 为候选编号。只返回 JSON（不要其他文字）：
{ "answer": "≤250字中文回答，含 [n] 引用", "refs": [被引用的候选编号] }`
          },
          {
            role: 'user',
            content: `问题：${question}\n\n候选新闻：\n` + candidates.slice(0, 30).map((c, i) =>
              `[${i}] ${c.titleZh || c.title}（${c.source || '未知来源'}${c.publishedAt ? '/' + c.publishedAt.slice(0, 10) : ''}）\n${((c.summaryZh || c.summary) || '').slice(0, 200)}`
            ).join('\n\n')
          }
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    })
    if (!res || !res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const answer = String(parsed.answer || '').trim()
    if (!answer) return null
    const rawRefs: any[] = Array.isArray(parsed.refs) ? parsed.refs : []
    const refs: number[] = [...new Set(
      rawRefs
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n >= 0 && n < candidates.length)
    )]
    return { answer: answer.slice(0, 500), refs }
  } catch {
    return null
  }
}

export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (!setA.size || !setB.size) return 0
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return intersection.size / union.size
}

// ─── Cross-source comparison analysis ────────────────────────────

export interface CrossRefResult {
  keyword: string
  sources: { name: string; angle: string }[]
  comparison: string
  articleIds: number[]
}

// Given articles from different sources covering the same story,
// generates a comparison of their angles and reporting differences.
export async function crossRefAnalysis(
  groups: { source: string; title: string; summary: string }[][],
  apiKey: string | undefined,
): Promise<CrossRefResult[] | null> {
  if (!apiKey || !groups.length) return null

  const results: CrossRefResult[] = []

  for (const group of groups) {
    if (group.length < 2) continue
    const sources = group.map(g => g.source)
    const jointTitle = group.map(g => g.title).join(' | ')

    try {
      const res = await fetchWithRetry('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            {
              role: 'system',
              content: `你是新闻对比分析编辑。以下是多家媒体对同一事件的报道。比较各家的报道角度、侧重点和潜在倾向差异。只返回 JSON（不要其他文字）：

{
  "keyword": "报道的事件关键词（≤20字中文）",
  "comparison": "≤100字对比分析：指出各源报道角度的关键差异"
}`,
            },
            {
              role: 'user',
              content: group.map(g => `[${g.source}]\n标题：${g.title}\n摘要：${(g.summary || '').slice(0, 200)}`).join('\n\n'),
            },
          ],
          temperature: 0.2,
          max_tokens: 512,
        }),
      })
      if (!res?.ok) continue

      const data = (await res.json()) as any
      const raw = data.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      if (!raw) continue

      const parsed = JSON.parse(raw)
      if (parsed.comparison) {
        results.push({
          keyword: parsed.keyword || jointTitle.slice(0, 60),
          sources: sources.map(s => ({ name: s, angle: '' })),
          comparison: parsed.comparison.slice(0, 200),
          articleIds: [],
        })
      }
    } catch { /* skip failed group */ }
  }

  return results.length ? results : null
}
