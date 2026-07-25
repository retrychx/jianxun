import type { D1Database } from '@cloudflare/workers-types'

export interface NewsRow {
  id: number
  title: string
  description: string | null
  url: string
  image: string | null
  source: string
  lang: string
  category: string
  score: number
  summary: string | null
  published_at: string | null
  created_at: string
}

export interface AnalysisRow {
  id: number
  news_id: number
  content: string | null
  summary: string | null
  entities: string | null
  sentiment: string | null
  analyzed: number
  created_at: string
}

export function getDB(env: { DB: D1Database }) {
  return env.DB
}
