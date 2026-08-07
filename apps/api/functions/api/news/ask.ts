import { ask, tryCatch, rateLimit, clientIp } from '../../../src/handler'

export async function onRequestGet(context: any) {
  const { request, env } = context
  const q = new URL(request.url).searchParams.get('q') || ''
  if (!q) return new Response(JSON.stringify({ error: 'missing q' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  // 付费 LLM 端点限流（未命中缓存时同步调 DeepSeek）
  if (!(await rateLimit(env, `ask:${clientIp(request)}`, 10, 60))) {
    return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
  }
  return tryCatch(() => ask(env, q))
}
