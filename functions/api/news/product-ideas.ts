// GET /api/news/product-ideas — 每日产品灵感（agent 每天基于热门新闻生成）
import { json, tryCatch } from '../../../src/handler'
import { cacheGet, cacheSet, CACHE_TTL } from '../../../src/cache.js'

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
    const { env } = context
    const cached = await cacheGet<any>('product_ideas')
    if (cached) return cached

    const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'product_ideas'").first()
    const data = row?.value ? (() => { try { return JSON.parse(row.value) } catch { return null } })() : null
    const payload = data || { date: null, ideas: [] }
    await cacheSet('product_ideas', payload, CACHE_TTL.briefing)
    return payload
  })
}
