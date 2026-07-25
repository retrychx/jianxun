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
}

export interface EntityItem {
  name: string
  type: 'person' | 'company' | 'product' | 'technology' | 'concept'
  weight: number
}

export interface SentimentData {
  label: 'positive' | 'negative' | 'neutral' | 'mixed'
  scores: { positive: number; negative: number; neutral: number }
  perspective: string
}

export interface NewsDetail extends NewsItem {
  analysis: {
    summary: string
    entities: EntityItem[]
    sentiment: SentimentData | null
    content: string | null
  }
  related: NewsItem[]
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
  const res = await fetch(url)
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

export function triggerFetch(): Promise<{ fetched: number }> {
  return fetchJson(`${BASE}/news/fetch`)
}

export interface TopicCluster {
  keyword: string
  count: number
  sources: string[]
  sourcePerspectives?: { name: string; angle: string }[]
  dateRange?: string
  items: NewsItem[]
}

export function getTopics(): Promise<{ topics: TopicCluster[] }> {
  return fetchJson(`${BASE}/news/topics`)
}

export function getDetail(id: number): Promise<NewsDetail> {
  return fetchJson(`${BASE}/news/${id}/detail`)
}

export function getByEntity(name: string): Promise<{ items: NewsItem[]; entity: string }> {
  return fetchJson(`${BASE}/news/entity/${encodeURIComponent(name)}`)
}
