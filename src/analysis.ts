export async function extractContent(url: string): Promise<{ content: string | null; image: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { content: null, image: null }
    const html = await res.text()

    // Extract OG image
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
    const image = imgMatch?.[1] || null

    // Simple text extraction
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#?[a-z0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5_000)

    return { content: text || null, image }
  } catch {
    return { content: null, image: null }
  }
}


interface DeepSeekResult {
  summary: string
  category: string
  entities: { name: string; type: string; weight: number }[]
  sentiment: { label: string; scores: { positive: number; negative: number; neutral: number }; perspective: string }
}

export async function analyzeWithDeepSeek(title: string, content: string, apiKey: string): Promise<DeepSeekResult | null> {
  const prompt = `你是一个智能新闻分析助手。分析以下新闻文章的全文，返回 JSON（不要其他文字）：

{
  "summary": "2-3句话的简洁中文摘要",
  "category": "AI|科技|财经|国际|政治|健康|体育|娱乐|游戏|教育|社会",
  "entities": [
    { "name": "实体名称", "type": "person|company|product|technology|concept", "weight": 0.8 }
  ],
  "sentiment": {
    "label": "positive|negative|neutral|mixed",
    "scores": { "positive": 0.x, "negative": 0.x, "neutral": 0.x },
    "perspective": "报道角度和倾向简短描述（中文）"
  }
}`

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `标题: ${title}\n\n正文:\n${content.slice(0, 8000)}` },
        ],
        temperature: 0.01,
        max_tokens: 1024,
      }),
    })
    if (!res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null

    const json = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(json)
    return {
      summary: parsed.summary || '无法生成摘要',
      category: parsed.category || '科技',
      entities: (parsed.entities || []).slice(0, 6),
      sentiment: parsed.sentiment || { label: 'neutral', scores: { positive: 0.3, negative: 0.3, neutral: 0.4 }, perspective: '' },
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
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
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
    if (!res.ok) return null

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
}

export interface DigestResult {
  intro: string
  items: { news_id: number; why: string; category: string }[]
  extra: { news_id: number; why: string } | null
}

// Picks the day's 5-8 most important AI/tech stories plus one lighthearted extra.
// Returns null when the call is unavailable/fails; ids are validated against candidates.
export async function generateDigest(candidates: DigestCandidate[], apiKey: string | undefined): Promise<DigestResult | null> {
  if (!apiKey || !candidates.length) return null
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content: `你是中文科技日报主编。从候选新闻中挑出今天最重要的 5-8 条，做成一期"AI/科技行业日报"。只返回 JSON（不要其他文字）：
{
  "intro": "≤120字中文开场白，总览今日行业动态",
  "items": [{ "news_id": 数字, "why": "≤30字，这条为什么重要", "category": "分类" }],
  "extra": { "news_id": 数字, "why": "≤30字" } 或 null
}
items 按重要性排序；extra 是最有趣/最轻松的一条番外，不得与 items 重复。news_id 必须来自候选列表。`
          },
          {
            role: 'user',
            content: candidates.slice(0, 30).map(c =>
              `[${c.id}] ${c.title}（${c.source || '未知来源'}/${c.category || '科技'}/热度${c.heat || 1}）\n${(c.summary || '').slice(0, 200)}`
            ).join('\n\n')
          }
        ],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    })
    if (!res.ok) return null

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
      if (items.length >= 8) break
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
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
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
    if (!res.ok) return null

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
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
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
    if (!res.ok) return null

    const data = await res.json() as any
    const raw = data.choices?.[0]?.message?.content?.trim()
    if (!raw) return null
    return raw.replace(/```[a-z]*\n?/g, '').replace(/^["「]|["」]$/g, '').trim().slice(0, 300) || null
  } catch {
    return null
  }
}

// Simple text similarity for related articles
function tokenize(text: string): string[] {
  const clean = text.replace(/[^\w一-鿿\s]/g, ' ')
  const words = clean.split(/\s+/).filter(w => w.length > 1)
  const cn = clean.replace(/[a-zA-Z0-9]/g, '')
  for (let i = 0; i < cn.length - 1; i++) {
    const seg = cn.slice(i, i + 3)
    if (seg.length >= 2 && seg.trim()) words.push(seg)
  }
  return [...new Set(words)].filter(w => w.length > 1)
}

export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (!setA.size || !setB.size) return 0
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return intersection.size / union.size
}
