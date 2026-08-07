/**
 * 通用工具层单测：
 *  - helpers：likeEscape/decodeHtml/tryCatch/requireAdmin/mapNews/isoZ/时间换算/
 *    clientIp/rateLimit/fallbackLabel/validateAnalysisBody/statusCheck
 *  - cache：stub 全局 caches → cacheGet/Set/Delete + singleFlight 并发去重 + SSE 信号
 *  - rss：fetchAllRSS 全源抓取 + saveArticles 批量去重入库 + 失败源记 fail_count
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import {
  likeEscape, decodeHtml, tryCatch, json, requireAdmin, mapNews, isoZ,
  parseDBTime, toDBTime, clientIp, rateLimit, fallbackLabel, validateAnalysisBody, statusCheck,
} from '../src/helpers.js'
import {
  cacheGet, cacheSet, cacheDelete, singleFlight, signalEvent, pollEvent,
} from '../src/cache.js'
import { fetchAllRSS, saveArticles } from '../src/rss.js'
import { RSS_SOURCES } from '../src/sources.js'

let env: any
beforeEach(() => { const { d1 } = createTestDB(); env = makeEnv(d1) })
afterEach(() => { vi.unstubAllGlobals() })

describe('helpers 纯函数', () => {
  it('likeEscape 转义 % _ \\', () => {
    expect(likeEscape('100%_完成\\x')).toBe('100\\%\\_完成\\\\x')
    expect(likeEscape('纯文本')).toBe('纯文本')
  })

  it('decodeHtml 解码命名/数字/十六进制实体', () => {
    expect(decodeHtml('&lt;a&gt; &amp; &quot;x&quot;')).toBe('<a> & "x"')
    expect(decodeHtml('&#39;it&#39;s&#39;')).toBe("'it's'")
    expect(decodeHtml('&#8217;')).toBe('’')
    expect(decodeHtml('&#x4F60;&#x597D;')).toBe('你好')
    expect(decodeHtml('&nbsp;')).toBe(' ')
  })

  it('json/tryCatch：透传 Response，异常转 500 安全错误', async () => {
    const ok = await tryCatch(async () => 42)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toBe(42)
    expect(ok.headers.get('X-API-Version')).toBe('v1')
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('*')

    // 回调返回 Response 时直接透传，避免二次序列化成 {}
    const inner = json({ ok: true }, 201)
    const passthrough = await tryCatch(async () => inner)
    expect(passthrough.status).toBe(201)
    expect(await passthrough.json()).toEqual({ ok: true })

    const err = await tryCatch(async () => { throw new Error('boom') })
    expect(err.status).toBe(500)
    expect(await err.json()).toEqual({ ok: false, error: 'Internal error' })
  })

  it('requireAdmin：未配置 / 错误 token 返回 401，正确 token 放行', () => {
    expect(requireAdmin(new Request('https://x.test', { headers: { Authorization: 'Bearer test-admin' } }), env)).toBeNull()

    const bad = requireAdmin(new Request('https://x.test', { headers: { Authorization: 'Bearer wrong' } }), env)
    expect(bad!.status).toBe(401)

    const noToken = requireAdmin(new Request('https://x.test'), { ...env, ADMIN_TOKEN: undefined })
    expect(noToken!.status).toBe(401)
  })

  it('mapNews：snake_case→camelCase，解析 sentiment/analysis_detail JSON', () => {
    const row = {
      id: 1, title: 't', description: 'd', url: 'u', image: null, source: 'S', lang: 'zh',
      category: 'AI', score: 90, summary: 's', title_zh: '标题', summary_zh: null,
      entities: '[{"name":"英伟达"}]',
      sentiment: '{"label":"positive","perspective":"乐观"}',
      analysis_detail: '{"impact":"high","keyPoints":["k1"],"significance":"重要"}',
      published_at: '2026-08-08 08:00:00', created_at: '2026-08-08 09:00:00',
    }
    const m = mapNews(row)
    expect(m.titleZh).toBe('标题')
    expect(m.sentiment.label).toBe('positive')
    expect(m.impact).toBe('high')
    expect(m.keyPoints).toEqual(['k1'])
    expect(m.publishedAt).toBe('2026-08-08 08:00:00')
    // 损坏的 JSON → null 而不是抛错
    const bad = mapNews({ ...row, sentiment: '{broken', analysis_detail: '{broken' })
    expect(bad.sentiment).toBeNull()
    expect(bad.impact).toBeNull()
    expect(mapNews(null)).toBeNull()
  })

  it('isoZ：DB 无时区时间补 Z；已是 ISO 原样返回；空值返 null', () => {
    expect(isoZ('2026-08-08 08:00:00')).toBe('2026-08-08T08:00:00Z')
    expect(isoZ('2026-08-08T08:00:00.000Z')).toBe('2026-08-08T08:00:00.000Z')
    expect(isoZ(null)).toBeNull()
    expect(isoZ('')).toBeNull()
  })

  it('parseDBTime/toDBTime 时间格式互转可往返', () => {
    expect(toDBTime(parseDBTime('2026-08-08 08:00:00'))).toBe('2026-08-08 08:00:00')
    expect(parseDBTime('2026-08-08 08:00:00').toISOString()).toBe('2026-08-08T08:00:00.000Z')
  })

  it('clientIp：读 CF-Connecting-IP，缺省 unknown', () => {
    expect(clientIp(new Request('https://x.test', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('https://x.test'))).toBe('unknown')
  })

  it('fallbackLabel：过滤英文停用词，取前 3 个关键词', () => {
    expect(fallbackLabel(['OpenAI', 'the', 'new', 'model'])).toBe('OpenAI · model')
    expect(fallbackLabel(['the', 'of'])).toBe('the · of') // 全被过滤 → 回退原文
    expect(fallbackLabel(['量子', '计算', '突破'])).toBe('量子 · 计算 · 突破')
  })

  it('validateAnalysisBody：合法通过，非法给明确错误', () => {
    expect(validateAnalysisBody({ summary: 's', entities: ['a'], sentiment: 'positive', category: 'AI' })).toBeNull()
    expect(validateAnalysisBody({ entities: [{ name: 'a', type: 'company' }] })).toBeNull()
    expect(validateAnalysisBody(null)).toBe('body must be an object')
    expect(validateAnalysisBody([1])).toBe('body must be an object')
    expect(validateAnalysisBody({ summary: 123 })).toBe('summary must be a string')
    expect(validateAnalysisBody({ entities: 'x' })).toBe('entities must be string[] or {name}[]')
    expect(validateAnalysisBody({ entities: [{}] })).toBe('entities must be string[] or {name}[]')
    expect(validateAnalysisBody({ sentiment: 'angry' })).toBe('sentiment must be positive|neutral|negative')
    expect(validateAnalysisBody({ category: 1 })).toBe('category must be a string')
  })

  it('statusCheck：汇总环境变量与最近运行状态', async () => {
    const s = await statusCheck(env)
    expect(s.hasDeepSeek).toBe(true)
    expect(s.hasAdminToken).toBe(true)
    expect(s.hasDB).toBe(true)
    expect(s.ok).toBe(true)
    expect(s.lastFetch).toBeNull()

    const bare = await statusCheck({ ...env, DEEPSEEK_API_KEY: '', ADMIN_TOKEN: undefined })
    expect(bare.hasDeepSeek).toBe(false)
    expect(bare.hasAdminToken).toBe(false)
    expect(bare.ok).toBe(false)
  })
})

describe('rateLimit（D1 固定窗口）', () => {
  it('窗口内超限拒绝，跨 scope 独立', async () => {
    expect(await rateLimit(env, 'ask', 3, 60)).toBe(true)
    expect(await rateLimit(env, 'ask', 3, 60)).toBe(true)
    expect(await rateLimit(env, 'ask', 3, 60)).toBe(true)
    expect(await rateLimit(env, 'ask', 3, 60)).toBe(false) // 第 4 次拒绝
    expect(await rateLimit(env, 'other', 3, 60)).toBe(true) // 别的 scope 不受影响
  })
})

describe('cache 层（stub 全局 caches）', () => {
  function stubCaches() {
    const store = new Map<string, { data: any; cc: string | null }>()
    const caches: any = {
      default: {
        match: async (req: Request) => {
          const v = store.get(req.url)
          return v !== undefined
            ? new Response(JSON.stringify(v.data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': v.cc || '' } })
            : null
        },
        put: async (req: Request, res: Response) => {
          store.set(req.url, { data: await res.json(), cc: res.headers.get('Cache-Control') })
        },
        delete: async (req: Request) => store.delete(req.url),
      },
    }
    vi.stubGlobal('caches', caches)
    return store
  }

  it('cacheSet → cacheGet 往返；cacheDelete 清除', async () => {
    stubCaches()
    await cacheSet('news:1', { id: 1, title: 't' }, 120)
    const v = await cacheGet<{ id: number; title: string }>('news:1')
    expect(v?.id).toBe(1)
    expect(v?.title).toBe('t')
    await cacheDelete('news:1')
    expect(await cacheGet('news:1')).toBeNull()
  })

  it('无全局 caches 时静默返回 null（best-effort）', async () => {
    // 不 stub，node 环境没有 caches → 内部异常被吞掉
    await cacheSet('x', { a: 1 }, 10)
    expect(await cacheGet('x')).toBeNull()
  })

  it('singleFlight：并发同 key 只执行一次，完成后可再执行', async () => {
    let calls = 0
    const f = () => new Promise<number>(r => setTimeout(() => r(++calls), 10))
    const [a, b] = await Promise.all([singleFlight('k', f), singleFlight('k', f)])
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(calls).toBe(1)
    expect(await singleFlight('k', f)).toBe(2) // 完成后新调用重新执行
  })

  it('signalEvent/pollEvent：只返回比 since 新的事件', async () => {
    stubCaches()
    const ts = await signalEvent('digest-ready', { date: '2026-08-08' })
    const evt = await pollEvent<{ date: string }>('digest-ready', ts - 1)
    expect(evt?.data.date).toBe('2026-08-08')
    expect(await pollEvent('digest-ready', ts)).toBeNull() // 同 ts 不算新
    expect(await pollEvent('never-fired', 0)).toBeNull() // 无事件
  })
})

describe('rss 管道', () => {
  it('fetchAllRSS 抓全源候选并写 source_stats；saveArticles 去重入库', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const items = [1, 2].map(i => `
        <item>
          <title>科技头条 源${i}</title>
          <link>https://feed.example/${encodeURIComponent(String(url))}/${i}</link>
          <pubDate>Thu, 06 Aug 2026 10:00:0${i} GMT</pubDate>
          <description>测试摘要</description>
        </item>`).join('')
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>测试</title>${items}</channel></rss>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } },
      )
    }))

    const articles = await fetchAllRSS(env.DB)
    expect(articles.length).toBe(RSS_SOURCES.length * 2)

    const saved = await saveArticles(env.DB, articles)
    expect(saved).toBe(RSS_SOURCES.length * 2)
    // INSERT OR IGNORE：同 URL 再次入库不计
    expect(await saveArticles(env.DB, articles)).toBe(0)

    const stats = await env.DB.prepare('SELECT COUNT(*) as c FROM source_stats').first()
    expect(stats.c).toBe(RSS_SOURCES.length)

    // 二次抓取：全部已在库 → 无新候选（幂等）
    expect((await fetchAllRSS(env.DB)).length).toBe(0)
  })

  it('抓取失败的源记 fail_count，不阻断其他源', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('waf blocked', { status: 403 })))
    expect(await fetchAllRSS(env.DB)).toEqual([])
    const rows = await env.DB.prepare('SELECT COUNT(*) as c FROM source_stats WHERE fail_count > 0').first()
    expect(rows.c).toBe(RSS_SOURCES.length)
  })
})
