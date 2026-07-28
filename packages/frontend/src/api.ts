export interface NewsItem {
  id: number
  title: string
  description: string | null
  url: string
  image?: string | null
  source: string
  lang: string
  category: string
  score: number
  summary: string | null
  publishedAt: string | null
  createdAt: string
  /** 同源跨媒体计数（增量字段，旧 API 可能不返回） */
  heat?: number
  /** 中文译题（增量字段，仅英文文章可能有值） */
  titleZh?: string | null
  /** 中文摘要（增量字段，仅英文文章可能有值） */
  summaryZh?: string | null
  /** 原始 entities JSON 字符串（增量字段；关注加权做包含匹配用，不解析） */
  entities?: string | null
  /** AI 分析关键要点（分析后才会有） */
  keyPoints?: string[]
  /** AI 分析影响级别（分析后才会有） */
  impact?: 'short' | 'medium' | 'high'
}

export interface EntityItem {
  name: string
  type: 'person' | 'company' | 'product' | 'technology' | 'concept'
  weight: number
}

export interface SentimentData {
  label?: 'positive' | 'negative' | 'neutral' | 'mixed'
  scores?: { positive: number; negative: number; neutral: number }
  perspective?: string
}

export interface AnalysisDetail {
  keyPoints: string[]
  significance: string
  controversy: boolean
  impact: 'short' | 'medium' | 'high'
}

export interface NewsDetail extends NewsItem {
  analysis: {
    summary: string
    entities: EntityItem[]
    sentiment: SentimentData | string | null
    content: string | null
  }
  related: NewsItem[]
  /** Enhanced AI analysis fields (may be null for unanalyzed articles) */
  analysisDetail: AnalysisDetail | null
}

export interface NewsListResponse {
  items: NewsItem[]
  total: number
  page: number
  pageSize: number
}

export interface CategoryCount {
  name: string
  count: number
}

const BASE = '/api'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function getNews(params: {
  category?: string
  page?: number
  pageSize?: number
}): Promise<NewsListResponse> {
  const q = new URLSearchParams()
  if (params.category && params.category !== '全部') q.set('category', params.category)
  if (params.page) q.set('page', String(params.page))
  if (params.pageSize) q.set('pageSize', String(params.pageSize))
  return fetchJson(`${BASE}/news?${q}`)
}

export function getTrending(): Promise<{ items: NewsItem[] }> {
  return fetchJson(`${BASE}/news/trending`)
}

export function getCategories(): Promise<{ categories: CategoryCount[] }> {
  return fetchJson(`${BASE}/news/categories`)
}

export function getStats(): Promise<{ total: number; today: number }> {
  return fetchJson(`${BASE}/news/stats`)
}

export interface TopicCluster {
  keyword: string
  /** 中文话题名（增量字段，兜底用 keyword 拼接） */
  label?: string
  count: number
  sources: string[]
  sourcePerspectives?: { name: string; angle: string }[]
  dateRange?: string
  narrative?: string
  items: NewsItem[]
}

export function getTopics(): Promise<{ topics: TopicCluster[] }> {
  return fetchJson(`${BASE}/news/topics`)
}

export interface BriefingItem extends NewsItem {
  reason: string
}

export function getBriefing(): Promise<{ items: BriefingItem[] }> {
  return fetchJson(`${BASE}/news/briefing`)
}

export function getDetail(id: number): Promise<NewsDetail> {
  return fetchJson(`${BASE}/news/${id}/detail`)
}

export function getByEntity(name: string): Promise<{ items: NewsItem[]; entity: string }> {
  return fetchJson(`${BASE}/news/entity/${encodeURIComponent(name)}`)
}

export function searchNews(q: string): Promise<{ items: NewsItem[]; query: string }> {
  return fetchJson(`${BASE}/news/search?q=${encodeURIComponent(q)}`)
}

/* ===== 日报 / 话题深挖 / 信源（增量接口，404 或字段缺失时调用方需兜底） ===== */

export interface DigestItem {
  id: number
  title: string
  titleZh?: string | null
  /** 「为什么重要」一句话 */
  why: string
  category: string
  source: string
  heat?: number
}

export interface DigestExtra {
  id: number
  title: string
  titleZh?: string | null
  why: string
}

export interface DigestResponse {
  date: string
  intro?: string | null
  items: DigestItem[]
  extra?: DigestExtra | null
}

export function getDigest(date?: string): Promise<DigestResponse> {
  return fetchJson(`${BASE}/news/digest${date ? `?date=${encodeURIComponent(date)}` : ''}`)
}

export function getDigests(): Promise<{ dates: string[] }> {
  return fetchJson(`${BASE}/news/digests`)
}

export interface TopicPerspective {
  source: string
  /** 立场标签（正/负/中…）；可能为 null（无情感数据） */
  label?: string | null
  count: number
}

export interface TopicDetail {
  keyword: string
  label?: string | null
  storyline?: string | null
  timeline: NewsItem[]
  perspectives?: TopicPerspective[]
}

export function getTopic(name: string): Promise<TopicDetail> {
  return fetchJson(`${BASE}/news/topic?name=${encodeURIComponent(name)}`)
}

export interface SourceHealth {
  name: string
  weight: number
  total: number
  today: number
  lastOk?: string | null
  lastError?: string | null
  failCount: number
  topEntities?: { name: string; count: number }[]
  topCategories?: string[]
}

export function getSources(): Promise<{ items: SourceHealth[] }> {
  return fetchJson(`${BASE}/news/sources`)
}

/* ===== 问答搜索 / 周报（增量接口，调用方需处理 answer/totalNew 为空的情况） ===== */

export interface AskRef {
  /** 候选数组下标，对应回答文本里的 [n] */
  ref: number
  id: number
  title: string
  titleZh?: string | null
  source: string
}

export interface AskResponse {
  /** LLM 失败或无相关报道时为 null */
  answer: string | null
  refs: AskRef[]
}

export function askNews(q: string): Promise<AskResponse> {
  return fetchJson(`${BASE}/news/ask?q=${encodeURIComponent(q)}`)
}

/* ===== Deep Research ===== */

export interface ResearchSection {
  heading: string
  body: string
  refs: number[]
}

export interface ResearchReport {
  title: string
  summary: string
  sections: ResearchSection[]
  outlook: string
}

export interface ResearchRef {
  ref: number
  id: number
  title: string
  titleZh?: string | null
  source: string
}

export interface ResearchResponse {
  report: ResearchReport | null
  refs: ResearchRef[]
  candidateCount: number
}

export function researchNews(q: string): Promise<ResearchResponse> {
  return fetchJson(`${BASE}/news/research?q=${encodeURIComponent(q)}`)
}

export interface WeeklyResponse {
  totalNew: number
  topEntities: { name: string; count: number }[]
  topTopics: { label: string; count: number }[]
}

export function getWeekly(): Promise<WeeklyResponse> {
  return fetchJson(`${BASE}/news/weekly`)
}

/* ===== 叙事追踪（增量接口） ===== */

export interface NarrativeSummary {
  keyword: string
  label: string
  status: 'active' | 'stale' | 'archived'
  firstSeen: string
  lastUpdated: string
  summary: string | null
  developmentCount: number
  articleCount: number
  sourceStats: Record<string, number>
}

export interface NarrativeEntity {
  name: string
  type: string
}

export interface RelatedNarrative {
  keyword: string
  label: string
  overlap: number
  articleCount: number
}

export interface NarrativeDetail extends NarrativeSummary {
  developments: { date: string; text: string; articleCount: number; sources: string[] }[]
  articles: NewsItem[]
  entities: NarrativeEntity[]
  related: RelatedNarrative[]
}

export interface NarrativesTimeline {
  timeline: { date: string; items: { keyword: string; label: string; text: string; articleCount: number; sources: string[] }[] }[]
}

export function getNarratives(): Promise<{ narratives: NarrativeSummary[] }> {
  return fetchJson(`${BASE}/news/narrative`)
}

export function getNarrative(keyword: string): Promise<NarrativeDetail> {
  return fetchJson(`${BASE}/news/narrative?keyword=${encodeURIComponent(keyword)}`)
}

export function getNarrativesTimeline(): Promise<NarrativesTimeline> {
  return fetchJson(`${BASE}/news/narratives`)
}
