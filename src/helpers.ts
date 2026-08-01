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
      // API 版本化：当前 /api 即 v1，破坏性变更时前端据响应头区分
      'X-API-Version': 'v1',
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

// SQLite datetime('now') stores "YYYY-MM-DD HH:MM:SS" (UTC). These helpers keep
// JS-side cutoffs in the same format so string comparisons in SQL are correct
// (lexicographic vs. ISO strings would misorder ' ' < 'T' on the same day).

/** Parse a DB datetime("YYYY-MM-DD HH:MM:SS", UTC) into a Date. */
export function parseDBTime(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z')
}

/** Format a Date as DB datetime("YYYY-MM-DD HH:MM:SS", UTC). */
export function toDBTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

/** 客户端 IP（用于限流 scope）。CF 会设置 CF-Connecting-IP。 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown'
}

/**
 * 固定窗口限流（D1 表 rate_limits）。窗口过期行由 agent cleanup 定期清理。
 * 返回 true=放行；false=拒绝（应返回 429）。限流器自身异常时放行，避免误伤正常访问。
 */
export async function rateLimit(env: Env, scope: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM rate_limits WHERE scope = ? AND created_at >= datetime('now', ?)"
    ).bind(scope, `-${windowSeconds} seconds`).first<any>()
    if ((row?.c || 0) >= limit) return false
    await env.DB.prepare("INSERT INTO rate_limits (scope) VALUES (?)").bind(scope).run()
    return true
  } catch { return true }
}

// Report configuration status: which env vars are set + 最近抓取/运行状态（可观测性）。
export async function statusCheck(env: Env) {
  let lastFetch: any = null
  let lastRun: string | null = null
  try {
    const f = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_fetch'").first<any>()
    if (f?.value) { try { lastFetch = JSON.parse(f.value) } catch {} }
    const r = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
    lastRun = r?.value || null
  } catch {}
  return {
    hasDeepSeek: !!env.DEEPSEEK_API_KEY,
    hasAdminToken: !!env.ADMIN_TOKEN,
    hasDB: !!env.DB,
    ok: !!(env.DEEPSEEK_API_KEY && env.ADMIN_TOKEN && env.DB),
    lastFetch,
    lastAgentRun: lastRun,
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
  // 兼容 string[]（旧管理端格式）与 {name,type,weight}[]（AI 管线格式），统一归一
  if (entities !== undefined && (!Array.isArray(entities) || entities.some(e => !(typeof e === 'string' || (typeof e === 'object' && e && typeof (e as any).name === 'string'))))) return 'entities must be string[] or {name}[]'
  if (sentiment !== undefined && !['positive', 'neutral', 'negative'].includes(sentiment)) return 'sentiment must be positive|neutral|negative'
  if (category !== undefined && typeof category !== 'string') return 'category must be a string'
  return null
}
