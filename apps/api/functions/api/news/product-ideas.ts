import type { HandlerContext } from '../../../src/pages.js'
// GET /api/news/product-ideas — 每日产品灵感（agent 每天基于热门新闻生成）
import { json, tryCatch } from '../../../src/handler'
import { cacheGet, cacheSet, CACHE_TTL } from '../../../src/cache.js'
import { META, metaGetJSON } from '../../../src/db.js'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(async () => {
    const { env } = context
    const cached = await cacheGet<any>('product_ideas')
    if (cached) return cached

    const data = await metaGetJSON(env, META.productIdeas)
    const payload = data || { date: null, ideas: [] }
    await cacheSet('product_ideas', payload, CACHE_TTL.briefing)
    return payload
  })
}
