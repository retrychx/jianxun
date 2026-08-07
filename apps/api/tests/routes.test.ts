/**
 * API 路由冒烟测试：防止响应被序列化成 {}（tryCatch 二次 JSON.stringify 类 bug）再次上线。
 * 用真实 SQLite + mock context 直接调用路由 handler。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { onRequestGet as insightsGet } from '../functions/api/news/insights'
import { onRequestGet as heatGet } from '../functions/api/news/heat-entities'
import { onRequestPost as signalPost } from '../functions/api/signal/click'
import { onRequestGet as agentGet } from '../functions/api/news/agent'
import { onRequestGet as detailGet } from '../functions/api/news/[id]/detail'
import { onRequestGet as ideasGet } from '../functions/api/news/product-ideas'

let env: any

beforeEach(() => {
  const { d1 } = createTestDB()
  env = makeEnv(d1)
})

// 构造完整 EventContext（handler 参数已类型化为 HandlerContext，需补齐全部字段）
function ctx(overrides: any = {}) {
  return {
    env,
    request: overrides.request ?? new Request('https://x.test/api', { method: 'GET' }),
    params: overrides.params ?? {},
    functionPath: '/api',
    data: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response('next'),
  }
}

describe('缓存端点返回真实 JSON（回归：tryCatch 二次序列化成 {}）', () => {
  it('GET /api/news/insights 返回结构而非 {}', async () => {
    const res = await insightsGet(ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.topEntities)).toBe(true)
    expect(Array.isArray(data.mostRead)).toBe(true)
  })

  it('GET /api/news/heat-entities 返回 entities 数组', async () => {
    const res = await heatGet(ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.entities)).toBe(true)
  })

  it('GET /api/news/product-ideas 返回 ideas 数组', async () => {
    const res = await ideasGet(ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.ideas)).toBe(true)
  })

  it('GET /api/news/1/detail 无此 id 时返回 404 而非 {}', async () => {
    const res = await detailGet(ctx({ params: { id: '1' } }))
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).not.toEqual({})
  })
})

describe('写接口鉴权与校验', () => {
  it('GET /api/news/agent 无 token 返回 401', async () => {
    const res = await agentGet(ctx())
    expect(res.status).toBe(401)
  })

  it('POST /api/signal/click 非法 type 返回 400', async () => {
    const res = await signalPost(ctx({
      request: new Request('https://x.test/api/signal/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'hacker', id: '1' }),
      }),
    }))
    expect(res.status).toBe(400)
  })

  it('POST /api/signal/click 合法请求写入 signals 并返回 200', async () => {
    env.DB.exec(
      "INSERT INTO news (title, url, source, lang, title_norm) VALUES ('a', 'https://e.com/1', 'S1', 'zh', 'na')",
    )
    const res = await signalPost(ctx({
      request: new Request('https://x.test/api/signal/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'article', id: '1' }),
      }),
    }))
    expect(res.status).toBe(200)
    const row = env.DB._db.prepare("SELECT COUNT(*) c FROM signals WHERE target_type='article'").get()
    expect(row.c).toBe(1)
  })
})
