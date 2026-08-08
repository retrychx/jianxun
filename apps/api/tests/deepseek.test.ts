/**
 * DeepSeek 客户端层单测（纯 mock fetch，不联网）：
 *  - fetchWithRetry：429/5xx 重试、非重试 4xx 直接放弃、网络错误耗尽重试返回 null
 *  - extractContent：SSRF 防护（内网地址拒绝） + 标题/og:image/正文提取
 *  - 各解析函数：analyzeWithDeepSeek / generateTopicLabels / generateDigest /
 *    translateBatch / generateAnswer / crossRefAnalysis / generateStoryline / batchClassify
 *  - token 记账 + agent 级中止信号
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchWithRetry, extractContent, analyzeWithDeepSeek, generateTopicLabels,
  generateDigest, translateBatch, generateAnswer, crossRefAnalysis,
  generateStoryline, batchClassify, resetTokenCount, getTokenCount, setAgentAbort,
  callDeepSeekText, callDeepSeekJSON,
} from '../src/analysis/deepseek.js'
import { initSubrequestBudget } from '../src/agent/state.js'

beforeEach(() => { resetTokenCount(); setAgentAbort(null); initSubrequestBudget() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** 让 DeepSeek 返回给定 content（可选 usage 记账） */
function stubAI(content: string, status = 200, usage?: { total_tokens: number }) {
  const body: any = { choices: [{ message: { content } }] }
  if (usage) body.usage = usage
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

describe('fetchWithRetry', () => {
  it('首次成功直接返回', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mock)
    const res = await fetchWithRetry('https://api.deepseek.com/x', {})
    expect(res!.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('429 限流重试，耗尽后返回最后一次响应', async () => {
    vi.useFakeTimers()
    const mock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))
    vi.stubGlobal('fetch', mock)
    const p = fetchWithRetry('https://api.deepseek.com/x', {})
    await vi.advanceTimersByTimeAsync(5_000)
    const res = await p
    expect(res!.status).toBe(429)
    expect(mock).toHaveBeenCalledTimes(3) // 1 + 2 次退避重试
  })

  it('非重试 4xx（如 400 鉴权失败）直接返回，不重试', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }))
    vi.stubGlobal('fetch', mock)
    const res = await fetchWithRetry('https://api.deepseek.com/x', {})
    expect(res!.status).toBe(400)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('5xx 重试后成功；网络错误耗尽后返回 null', async () => {
    vi.useFakeTimers()
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mock)
    const p = fetchWithRetry('https://api.deepseek.com/x', {})
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await p)!.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(3)

    const fail = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fail)
    const p2 = fetchWithRetry('https://api.deepseek.com/x', {})
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await p2).toBeNull()
    expect(fail).toHaveBeenCalledTimes(3)
  })
})

describe('fetchWithRetry 中止短路', () => {
  it('signal 已中止时立即返回 null，不做退避重试', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('aborted'))
    vi.stubGlobal('fetch', mock)
    const ac = new AbortController()
    ac.abort()
    expect(await fetchWithRetry('https://api.deepseek.com/x', { signal: ac.signal })).toBeNull()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('phaseSignal 中止也短路（阶段超时经组合信号传导）', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('aborted'))
    vi.stubGlobal('fetch', mock)
    const phase = new AbortController()
    phase.abort()
    expect(await fetchWithRetry('https://api.deepseek.com/x', { phaseSignal: phase.signal })).toBeNull()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('agent 级中止信号经 callDeepSeekText 短路（新 run 顶替旧 run）', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('aborted'))
    vi.stubGlobal('fetch', mock)
    const ac = new AbortController()
    setAgentAbort(ac)
    ac.abort()
    expect(await callDeepSeekText('key', 'sys', 'user')).toBeNull()
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('callDeepSeekText / callDeepSeekJSON（通用助手）', () => {
  it('callDeepSeekText 剥代码围栏并 trim，累计 token 用量', async () => {
    stubAI('```json\n{\n  "a": 1\n}\n```', 200, { total_tokens: 7 })
    const text = await callDeepSeekText('key', 'sys', 'user')
    expect(text).toBe('{\n  "a": 1\n}')
    expect(getTokenCount()).toBe(7)
  })

  it('callDeepSeekText 非 2xx 立即返回 null（不重试）；空内容重试耗尽后返回 null', async () => {
    vi.useFakeTimers()
    try {
      // 非重试 4xx → 立即失败，只请求 1 次（fetchWithRetry 不重试 400）
      const bad400 = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 400 }))
      vi.stubGlobal('fetch', bad400)
      expect(await callDeepSeekText('key', 'sys', 'user')).toBeNull()
      expect(bad400).toHaveBeenCalledTimes(1)

      // HTTP 200 空内容 → 空响应重试 3 次后仍 null
      // 注意：Response 体只能读一次，每次 fetch 必须返回全新实例
      const empty = vi.fn().mockImplementation(() =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))
      vi.stubGlobal('fetch', empty)
      const p = callDeepSeekText('key', 'sys', 'user')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await p).toBeNull()
      expect(empty).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })

  it('callDeepSeekText 空内容后重试成功（HTTP 200 空 content → 第 2 次拿到结果）', async () => {
    vi.useFakeTimers()
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '正常文本' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', mock)
    try {
      const p = callDeepSeekText('key', 'sys', 'user')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await p).toBe('正常文本')
      expect(mock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('callDeepSeekJSON 解析合法 JSON；坏 JSON 返回 null', async () => {
    stubAI(JSON.stringify({ ideas: [1, 2] }))
    expect(await callDeepSeekJSON<{ ideas: number[] }>('key', 'sys', 'user')).toEqual({ ideas: [1, 2] })
    stubAI('not json')
    expect(await callDeepSeekJSON('key', 'sys', 'user')).toBeNull()
  })

  it('callDeepSeekJSON 坏 JSON 重试后成功', async () => {
    vi.useFakeTimers()
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', mock)
    try {
      const p = callDeepSeekJSON('key', 'sys', 'user')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await p).toEqual({ ok: 1 })
      expect(mock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('无 apiKey 时返回 null 且不调 fetch', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await callDeepSeekText('', 'sys', 'user')).toBeNull()
    expect(await callDeepSeekJSON('', 'sys', 'user')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('extractContent + SSRF 防护', () => {
  it('拒绝内网/环回/非 http(s) 地址，不发请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    for (const url of ['http://127.0.0.1/x', 'http://10.0.0.1/x', 'http://192.168.1.1/x', 'http://localhost/x', 'ftp://example.com/x']) {
      expect(await extractContent(url)).toEqual({ content: null, image: null, title: null })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('安全地址提取标题 / og:image / 正文段落', async () => {
    const html = `<html><head><title>测试页面</title>
      <meta property="og:image" content="https://img.example.com/og.jpg"/>
      <meta name="description" content="页面描述"/></head>
      <body><article><h1>标题</h1>
        <p>这是第一段正文内容，长度足够超过三十个字符以便被收集进来。</p>
        <p>这是第二段正文内容，同样保持足够长的段落文本方便提取。</p>
        <p>第三段正文内容，继续维持长度以满足正文提取的判定阈值。</p>
      </article></body></html>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })))
    const r = await extractContent('https://example.com/a1')
    expect(r.title).toBe('测试页面')
    expect(r.image).toBe('https://img.example.com/og.jpg')
    expect(r.content).toContain('第一段正文内容')
  })

  it('HTTP 非 2xx 或网络错误返回空结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    expect(await extractContent('https://example.com/x')).toEqual({ content: null, image: null, title: null })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect(await extractContent('https://example.com/x')).toEqual({ content: null, image: null, title: null })
  })
})

describe('analyzeWithDeepSeek', () => {
  it('解析摘要/分类/实体/情绪/要点，实体截断到 6 个，impact 白名单', async () => {
    const entities = Array.from({ length: 8 }, (_, i) => ({ name: `实体${i}`, type: 'company', weight: 0.5 }))
    stubAI(JSON.stringify({
      summary: '一段摘要', category: 'AI', entities,
      sentiment: { label: 'positive', perspective: '乐观' },
      keyPoints: ['k1', 'k2'], significance: '重要', controversy: true, impact: 'high',
    }))
    const r = await analyzeWithDeepSeek('标题', '正文', 'key')
    expect(r?.base.summary).toBe('一段摘要')
    expect(r?.base.category).toBe('AI')
    expect(r?.base.entities.length).toBe(6)
    expect(r?.base.sentiment.label).toBe('positive')
    expect(r?.detail.keyPoints).toEqual(['k1', 'k2'])
    expect(r?.detail.controversy).toBe(true)
    expect(r?.detail.impact).toBe('high')

    // 非法 impact → medium；空 keyPoints → []
    stubAI(JSON.stringify({ summary: 's', impact: 'urgent', controversy: 0 }))
    const r2 = await analyzeWithDeepSeek('t', 'c', 'key')
    expect(r2?.detail.impact).toBe('medium')
    expect(r2?.detail.keyPoints).toEqual([])
    expect(r2?.detail.controversy).toBe(false)
  })

  it('非 2xx / 空 content 返回 null', async () => {
    vi.useFakeTimers()
    stubAI('{}', 500)
    const p = analyzeWithDeepSeek('t', 'c', 'key')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await p).toBeNull()
    stubAI('')
    expect(await analyzeWithDeepSeek('t', 'c', 'key')).toBeNull()
  })
})

describe('generateTopicLabels', () => {
  it('按 index 填标签，越界忽略；无 apiKey 不发请求', async () => {
    stubAI(JSON.stringify([{ index: 0, label: 'AI 标签' }, { index: 9, label: '越界' }, { index: 1, label: ' 硬件 ' }]))
    const labels = await generateTopicLabels([['a'], ['b']], 'key')
    expect(labels).toEqual(['AI 标签', '硬件'])
  })

  it('无 apiKey 时返回 null 且不调用 fetch', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await generateTopicLabels([['a']], undefined)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('generateDigest', () => {
  it('过滤未知 id 与重复 id，extra 不在已选内', async () => {
    stubAI(JSON.stringify({
      intro: '今日要点',
      items: [
        { news_id: 1, why: '重大', category: 'AI' },
        { news_id: 99, why: '无效', category: 'X' },
        { news_id: 1, why: '重复', category: 'Y' },
      ],
      extra: { news_id: 2, why: '深度' },
    }))
    const r = await generateDigest(
      [{ id: 1, title: 'a' }, { id: 2, title: 'b' }, { id: 3, title: 'c' }],
      'key',
    )
    expect(r?.intro).toBe('今日要点')
    expect(r?.items).toEqual([{ news_id: 1, why: '重大', category: 'AI' }])
    expect(r?.extra).toEqual({ news_id: 2, why: '深度' })
  })

  it('items 为空返回 null；无 apiKey 返回 null', async () => {
    stubAI(JSON.stringify({ intro: 'x', items: [{ news_id: 99, why: 'w' }], extra: null }))
    expect(await generateDigest([{ id: 1, title: 'a' }], 'key')).toBeNull()
    expect(await generateDigest([{ id: 1, title: 'a' }], undefined)).toBeNull()
  })

  it('空 content 重试后成功（根因回归：HTTP 200 空响应曾致日报 failed）', async () => {
    vi.useFakeTimers()
    const empty = new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intro: '今日', items: [{ news_id: 1, why: 'w', category: 'AI' }], extra: null }) } }] }), { status: 200 })
    const mock = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', mock)
    try {
      const p = generateDigest([{ id: 1, title: 'a' }], 'key')
      await vi.advanceTimersByTimeAsync(5_000)
      const r = await p
      expect(r?.intro).toBe('今日')
      expect(r?.items).toEqual([{ news_id: 1, why: 'w', category: 'AI' }])
      expect(mock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('坏 JSON 重试后成功', async () => {
    vi.useFakeTimers()
    const bad = new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 })
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intro: 'i', items: [{ news_id: 1, why: 'w', category: 'AI' }], extra: null }) } }] }), { status: 200 })
    const mock = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', mock)
    try {
      const p = generateDigest([{ id: 1, title: 'a' }], 'key')
      await vi.advanceTimersByTimeAsync(5_000)
      expect((await p)?.intro).toBe('i')
      expect(mock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
})

describe('translateBatch', () => {
  it('只保留有效 id 且 title_zh 非空', async () => {
    stubAI(JSON.stringify([
      { id: 1, title_zh: '标题一', summary_zh: '摘要一' },
      { id: 99, title_zh: '无效id', summary_zh: '' },
      { id: 2, title_zh: '', summary_zh: '空标题' },
    ]))
    const r = await translateBatch([{ id: 1, title: 'a', summary: 's' }, { id: 2, title: 'b', summary: 't' }], 'key')
    expect(r).toEqual([{ id: 1, title_zh: '标题一', summary_zh: '摘要一' }])
  })
})

describe('generateAnswer', () => {
  it('refs 只保留范围内整数索引并去重；空答案返回 null', async () => {
    stubAI(JSON.stringify({ answer: '这是答案', refs: [0, 5, 0, -1, 2] }))
    const r = await generateAnswer('问题', [{ id: 1, title: 'a' }, { id: 2, title: 'b' }, { id: 3, title: 'c' }], 'key')
    expect(r?.answer).toBe('这是答案')
    expect(r?.refs).toEqual([0, 2])

    stubAI(JSON.stringify({ answer: '', refs: [] }))
    expect(await generateAnswer('q', [{ id: 1, title: 'a' }], 'key')).toBeNull()
  })
})

describe('crossRefAnalysis', () => {
  it('单对象解析；少于 2 篇的组跳过', async () => {
    stubAI(JSON.stringify({ keyword: '英伟达事件', comparison: '两家媒体角度不同' }))
    const r = await crossRefAnalysis([
      [{ source: 'S1', title: 'a', summary: 's' }, { source: 'S2', title: 'b', summary: 't' }],
      [{ source: 'S3', title: 'c', summary: 'u' }], // 单篇 → 跳过
    ], 'key')
    expect(r?.length).toBe(1)
    expect(r![0].keyword).toBe('英伟达事件')
    expect(r![0].sources.map((s: any) => s.name)).toEqual(['S1', 'S2'])
    expect(r![0].comparison).toContain('角度不同')
  })

  it('无合法组返回 null', async () => {
    stubAI(JSON.stringify({ comparison: 'x' }))
    expect(await crossRefAnalysis([[{ source: 'S1', title: 'a', summary: 's' }]], 'key')).toBeNull()
  })
})

describe('generateStoryline / batchClassify', () => {
  it('去除代码围栏与首尾引号', async () => {
    stubAI('“这是前情提要”')
    expect(await generateStoryline([{ title: 'a', summary: 'b' }], 'key')).toBe('这是前情提要')
  })

  it('batchClassify 解析分类结果；非 2xx 返回空数组', async () => {
    stubAI(JSON.stringify([{ index: 0, category: 'AI' }, { index: 1, category: '财经' }]))
    expect(await batchClassify([{ id: 1, title: 'a' }, { id: 2, title: 'b' }], 'key')).toEqual([
      { index: 0, category: 'AI' }, { index: 1, category: '财经' },
    ])
    vi.useFakeTimers()
    stubAI('{}', 500)
    const p = batchClassify([{ id: 1, title: 'a' }], 'key')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await p).toEqual([])
  })
})

describe('token 记账与 agent 级中止', () => {
  it('usage.total_tokens 累计可统计；reset 清零', async () => {
    stubAI(JSON.stringify({ summary: 's' }), 200, { total_tokens: 42 })
    await analyzeWithDeepSeek('t', 'c', 'key')
    expect(getTokenCount()).toBe(42)
    resetTokenCount()
    expect(getTokenCount()).toBe(0)
  })

  it('setAgentAbort：新 run 启动时中止上一个 controller', () => {
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const abortSpy = vi.spyOn(ac1, 'abort')
    setAgentAbort(ac1)
    setAgentAbort(ac2) // 顶掉 ac1 并中止它
    expect(abortSpy).toHaveBeenCalledTimes(1)
    setAgentAbort(null) // 清空不中止当前
    expect(abortSpy).toHaveBeenCalledTimes(1)
  })
})
