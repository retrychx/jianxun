import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

export type Env = { DB: D1Database; KV?: KVNamespace; DEEPSEEK_API_KEY?: string; ADMIN_TOKEN?: string }

/** Escape % and _ in user input for SQL LIKE queries (ESCAPE '\' required in the query). */
export function likeEscape(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

export async function tryCatch(fn: () => Promise<any>, fallback: any = { ok: false, error: 'Internal error' }): Promise<Response> {
  try { return json(await fn()) } catch (e: any) { return json(fallback, 500) }
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

// Write endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.
export function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    console.warn('ADMIN_TOKEN not set — all write endpoints are disabled. Add via: npx wrangler pages secret put ADMIN_TOKEN')
    return json({ error: 'Unauthorized: ADMIN_TOKEN not configured' }, 401)
  }
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

// Map snake_case DB fields to camelCase for frontend
export function mapNews(row: any) {
  if (!row) return row
  let sentiment: any = row.sentiment
  if (typeof sentiment === 'string') { try { sentiment = JSON.parse(sentiment) } catch { sentiment = null } }
  let analysisDetail: any = row.analysis_detail
  if (typeof analysisDetail === 'string') { try { analysisDetail = JSON.parse(analysisDetail) } catch { analysisDetail = null } }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    image: row.image,
    source: row.source,
    lang: row.lang,
    category: row.category,
    score: row.score,
    summary: row.summary,
    titleZh: row.title_zh || null,
    summaryZh: row.summary_zh || null,
    entities: row.entities || null,
    sentiment,
    impact: analysisDetail?.impact || null,
    keyPoints: analysisDetail?.keyPoints || null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }
}

// SQLite datetime('now') outputs "YYYY-MM-DD HH:MM:SS" (no timezone marker).
// Add Z to make it proper ISO for the frontend.
export function isoZ(ts: string | null | undefined): string | null {
  if (!ts) return null
  if (ts.includes('T') || ts.includes('Z') || ts.includes('+')) return ts
  const m = ts.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/)
  if (m) return `${m[1]}T${m[2]}Z`
  return ts.replace(' ', 'T') + 'Z'
}

// Report configuration status: which env vars are set.
export async function statusCheck(env: Env) {
  return {
    hasDeepSeek: !!env.DEEPSEEK_API_KEY,
    hasAdminToken: !!env.ADMIN_TOKEN,
    hasDB: !!env.DB,
    ok: !!(env.DEEPSEEK_API_KEY && env.ADMIN_TOKEN && env.DB),
  }
}

// English stopwords excluded from fallback topic labels
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'how', 'why', 'what', 'is', 'in', 'on', 'for', 'with', 'and', 'or',
  'next', 'new', 'at', 'by', 'from', 'as', 'are', 'was', 'be', 'it', 'its', 'this', 'that', 'will',
  'can', 'not', 'but', 'if', 'so', 'into', 'over', 'about', 'after', 'via', 'vs', 'your', 'we',
  'their', 'has', 'have', 'do', 'does', 'get', 'may', 'now', 'more', 'most', 'all', 'also', 'just',
  'say', 'says', 'make', 'use', 'using', 'first', 'best', 'top', 'when', 'which', 'who',
])

// Fallback topic label: up to 3 meaningful keywords (stopwords filtered)
export function fallbackLabel(words: string[]): string {
  const kept = words.filter(w => !STOPWORDS.has(w.toLowerCase()))
  return (kept.length ? kept : words).slice(0, 3).join(' · ')
}

export const PERSPECTIVES: Record<string, string> = {
  '36氪': '商业', '少数派': '效率', '爱范儿': '消费',
  '量子位': 'AI', '钛媒体': '产业', '雷锋网': '技术',
  '品玩': '趋势', 'Solidot': '开源', 'V2EX 热榜': '社区',
  '开源中国': '开源', '投资界': '创投', '中国新闻网': '综合',
  '美团技术': '工程', '凤凰网科技': '科技', '动点科技': '科技',
  'Hacker News': '社区', 'GitHub Trending': '开源',
  'TechCrunch': '创投', 'The Verge': '消费', 'Ars Technica': '深度',
  'Wired': '文化', 'Engadget': '消费', 'Dev.to': '社区',
  'Android Central': '消费', 'New Scientist': '科学',
  'ScienceDaily': '科学', 'Space.com': '科学', 'MIT Tech Review': 'AI',
  '机器之心': 'AI', 'arXiv AI': '研究', 'arXiv Robot': '研究', 'OpenAI': 'AI',
  'NPR': '综合', 'BBC Tech': '综合',
  'GitHub Blog': '开源', 'Simon Willison': 'AI', 'Quanta Magazine': '科学',
  'IEEE Spectrum': '工程', 'Nature': '科学', 'Physics World': '科学',
  'IT之家': '科技', '掘金': '技术', '博客园': '社区', '小众软件': '效率',
  'ZDNet': '科技', 'MarketWatch': '财经',
}

// Validate the body of POST /api/news/:id/detail. Returns an error message or null.
export function validateAnalysisBody(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object'
  const { summary, entities, sentiment, category } = body
  if (summary !== undefined && typeof summary !== 'string') return 'summary must be a string'
  if (entities !== undefined && (!Array.isArray(entities) || entities.some(e => typeof e !== 'string'))) return 'entities must be a string array'
  if (sentiment !== undefined && !['positive', 'neutral', 'negative'].includes(sentiment)) return 'sentiment must be positive|neutral|negative'
  if (category !== undefined && typeof category !== 'string') return 'category must be a string'
  return null
}
