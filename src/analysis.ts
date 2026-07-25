export async function extractContent(url: string): Promise<{ content: string | null; image: string | null }> {
  try {
    // Fetch only first 30KB to stay under Worker CPU limits
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Range': 'bytes=0-30000'
      },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { content: null, image: null }
    const html = await res.text()

    // Extract OG image
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
    const image = imgMatch?.[1] || null

    // Fast text extraction: strip HTML tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(?:lt|gt|amp|quot|nbsp|#\d+);/g, ' ')
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
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `标题: ${title}\n\n正文:\n${content.slice(0, 8000)}` },
        ],
        temperature: 0.1,
        max_tokens: 2048,
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
