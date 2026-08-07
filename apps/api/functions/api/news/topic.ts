import type { HandlerContext } from '../../../src/pages.js'
import { topic, json, tryCatch, rateLimit, clientIp } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  const { request, env } = context
  const name = new URL(request.url).searchParams.get('name') || ''
  if (!name) return json({ error: 'missing name' }, 400)
  // 缓存未命中时该端点会同步调 DeepSeek 生成故事线——限流防滥用
  if (!(await rateLimit(env, `topic:${clientIp(request)}`, 30, 60))) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429)
  }
  const result = await topic(env, name).catch(() => null)
  if (!result) return json({ error: 'topic not found' }, 404)
  return json(result)
}
