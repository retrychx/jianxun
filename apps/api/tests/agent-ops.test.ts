/**
 * 补全：curateBriefing / generateResearchBriefs / runCrossRefAnalysis / translateMissing
 * + 调度器 runPhases / cleanup / eval 纯函数 / state 记账 / ask / saveAnalysis。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { curateBriefing } from '../src/agent/curate.js'
import { generateResearchBriefs } from '../src/agent/research.js'
import { runCrossRefAnalysis } from '../src/agent/crossref.js'
import { translateMissing } from '../src/agent/translate.js'
import { runPhases } from '../src/agent/scheduler.js'
import { cleanup } from '../src/agent/cleanup.js'
import { estimateAPICost, generateReport, saveReport } from '../src/agent/eval.js'
import { markAgentRun, shouldSkipDueToConcurrency, pingDeepSeek, initBudget, checkBudget } from '../src/agent/state.js'
import { ask, saveAnalysis } from '../src/api/write.js'
import { META, metaGet, metaGetJSON } from '../src/db.js'

let env: any
beforeEach(() => { const { d1 } = createTestDB(); env = makeEnv(d1) })
afterEach(() => { vi.unstubAllGlobals() })

function insertNews(id: number, title: string, source: string, over: any = {}) {
  env.DB.prepare(
    `INSERT INTO news (id, title, url, source, lang, summary, score, published_at, analyzed_at, analysis_detail, entities, title_norm)
     VALUES (?, ?, ?, ?, 'zh', ?, ?, datetime('now', ?), datetime('now'), ?, ?, ?)`
  ).bind(
    id, title, over.url || `https://e.com/${id}`, source, over.summary || '摘要文本',
    over.score ?? 80, over.hoursAgo != null ? `-${over.hoursAgo} hours` : '-1 hour',
    over.analysisDetail || null, over.entities || null, over.titleNorm || title,
  ).run()
}

/** DeepSeek 按 system 关键词路由 */
function mockAI() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (!String(url).includes('api.deepseek.com/chat/completions')) {
      return new Response('<html></html>', { status: 200 })
    }
    const body = JSON.parse((init?.body as string) || '{}')
    const sys = body?.messages?.[0]?.content || ''
    let content: string
    if (sys.includes('从候选新闻中挑出')) {
      content = JSON.stringify([{ id: 1, why: '最重要' }, { id: 2, why: '第二重要' }])
    } else if (sys.includes('深度研究')) {
      content = JSON.stringify({
        title: '研究报告', summary: '概览',
        sections: [{ heading: '第一章', body: '正文', refs: [0, 1] }], outlook: '展望',
      })
    } else if (sys.includes('对比分析')) {
      // crossRefAnalysis 解析单个对象（parsed.comparison），不是数组
      content = JSON.stringify({ keyword: '英伟达事件', comparison: '两家媒体角度不同' })
    } else if (sys.includes('专业科技翻译')) {
      content = JSON.stringify([{ id: 1, title_zh: '标题一', summary_zh: '摘要一' }])
    } else if (sys.includes('根据候选新闻回答')) {
      content = JSON.stringify({ answer: '英伟达发布了新一代GPU芯片。', refs: [0] })
    } else {
      content = JSON.stringify({ summary: '默认', category: 'AI', entities: [] })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  }))
}

describe('curateBriefing', () => {
  it('候选充足时按 AI 精选写入 briefingCurated', async () => {
    insertNews(1, '英伟达发新芯片', 'S1', { analysisDetail: '{"significance":"重大","impact":"high","controversy":false}' })
    insertNews(2, '苹果出新机', 'S2', { analysisDetail: '{"significance":"重要","impact":"high","controversy":false}' })
    insertNews(3, '融资事件', 'S3', { analysisDetail: '{"significance":"一般","impact":"medium","controversy":false}' })
    mockAI()
    const r = await curateBriefing(env)
    expect(r.briefing).toBe(2)
    const data = await metaGetJSON<{ items: { id: number; reason: string }[] }>(env, META.briefingCurated)
    expect(data?.items.length).toBe(2)
    expect(data?.items[0].reason).toBe('最重要')
    expect(data?.items[1].id).toBe(2)
  })

  it('候选不足 3 条时返回 0，不发请求', async () => {
    insertNews(1, '孤文', 'S1', { analysisDetail: '{}' })
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await curateBriefing(env)).toEqual({ briefing: 0 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('generateResearchBriefs', () => {
  it('为活跃叙事预生成研究简报并落 __research__ 叙事', async () => {
    for (let i = 1; i <= 3; i++) insertNews(i, `相关报道${i}`, `S${i}`)
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('英伟达', '英伟达新动向', 'active', date('now'), datetime('now'), '[1,2,3]', '[]', '{}')`,
    )
    mockAI()
    const r = await generateResearchBriefs(env)
    expect(r.briefs).toBe(1)
    const row = env.DB._db.prepare("SELECT status FROM narratives WHERE keyword = '__research__英伟达'").get()
    expect(row.status).toBe('active')
  })

  it('真实叙事查询只选真实关键词，排除 __ 合成叙事（GLOB 回归）', async () => {
    // 回归：SQLite LIKE 的 _ 按字节匹配，'__%' 会把所有 ≥2 字节关键词（如 '英伟达'）误排除，
    // 导致研究/简报永远选不中任何中文叙事。GLOB 的 _ 是字面量，'__*' 只排除 __ 前缀。
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats) VALUES
       ('英伟达', 'K1', 'active', date('now'), datetime('now'), '[1,2,3]', '[]', '{}'),
       ('__research__英伟达', 'K2', 'active', date('now'), datetime('now'), '[1,2,3]', '[]', '{}')`,
    )
    const rows = await env.DB.prepare(
      `SELECT keyword FROM narratives WHERE status = 'active' AND keyword NOT GLOB '__*' ORDER BY keyword`
    ).all()
    expect(rows.results?.map((r: any) => r.keyword)).toEqual(['英伟达'])
  })

  it('article_ids 少于 3 时跳过', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('英伟达', 'K', 'active', date('now'), datetime('now'), '[1]', '[]', '{}')`,
    )
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await generateResearchBriefs(env)).toEqual({ briefs: 0 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('runCrossRefAnalysis', () => {
  it('多来源同题文章生成跨源对比叙事', async () => {
    insertNews(1, '英伟达事件报道', 'S1', { titleNorm: 'evt-nvidia' })
    insertNews(2, '英伟达事件报道', 'S2', { titleNorm: 'evt-nvidia' })
    insertNews(3, '苹果事件报道', 'S3', { titleNorm: 'evt-apple' })
    insertNews(4, '苹果事件报道', 'S4', { titleNorm: 'evt-apple' })
    mockAI()
    const r = await runCrossRefAnalysis(env)
    expect(r.crossRefs).toBeGreaterThanOrEqual(1)
    const row = env.DB._db.prepare("SELECT label FROM narratives WHERE keyword LIKE '__cross__%'").get()
    expect(row.label).toContain('英伟达事件')
  })

  it('文章不足 4 篇时返回 0', async () => {
    insertNews(1, '单篇', 'S1')
    insertNews(2, '另一篇', 'S2')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await runCrossRefAnalysis(env)).toEqual({ crossRefs: 0 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('translateMissing', () => {
  it('为英文文章批量补中文标题', async () => {
    env.DB.prepare(
      `INSERT INTO news (id, title, url, source, lang, summary, score, published_at, title_norm)
       VALUES (1, 'Nvidia launches new GPU', 'https://e.com/1', 'S1', 'en', 'English summary', 90, datetime('now','-1 hour'), 'n1'),
              (2, 'Apple unveils iPhone', 'https://e.com/2', 'S2', 'en', 'Another summary', 85, datetime('now','-1 hour'), 'n2')`,
    ).run()
    mockAI()
    const r = await translateMissing(env)
    expect(r.translated).toBe(1) // mock 只回 id=1
    const row = env.DB._db.prepare('SELECT title_zh FROM news WHERE id = 1').get()
    expect(row.title_zh).toBe('标题一')
  })
})

describe('runPhases（调度器）', () => {
  it('按依赖顺序执行：依赖先于被依赖', async () => {
    const order: string[] = []
    const phases = [
      { name: 'A', run: async () => { order.push('A'); return 1 } },
      { name: 'B', dependsOn: ['A'], run: async () => { order.push('B'); return 2 } },
    ]
    const results = await runPhases(phases as any, env)
    expect(order).toEqual(['A', 'B'])
    expect(results.A.ok).toBe(true)
    expect(results.B.ok).toBe(true)
  })

  it('shouldSkip 阶段不执行函数但记为 ok', async () => {
    const run = vi.fn(async () => 'x')
    const results = await runPhases([{ name: 'S', shouldSkip: true, run }] as any, env)
    expect(run).not.toHaveBeenCalled()
    expect(results.S.ok).toBe(true)
    expect(results.S.result).toBeUndefined()
  })

  it('超时阶段返回 ok:false 且带错误信息', async () => {
    const results = await runPhases([{
      name: 'T', timeout: 40,
      run: async () => new Promise(() => {}), // 永不 resolve
    }] as any, env)
    expect(results.T.ok).toBe(false)
    expect(results.T.error).toContain('Timed out')
  })

  it('预算耗尽时跳过 low 优先级阶段', async () => {
    // 预算依据真实 CPU（process.cpuUsage）；mock 一个每次读数 +26s CPU 的单调读数，
    // initBudget 基线 0 → checkBudget 读到 26s ≥ 25s 上限 → 耗尽。
    // Worker 类型不含 process，经 globalThis 访问（运行时 nodejs_compat / vitest 下都有）。
    const cpuSpy = vi.spyOn((globalThis as any).process, 'cpuUsage')
    let cpuUs = 0
    cpuSpy.mockImplementation(() => { cpuUs += 26_000_000; return { user: cpuUs, system: 0 } })
    try {
      initBudget()
      checkBudget() // 触发 _budgetExhausted = true
      const run = vi.fn(async () => 1)
      const results = await runPhases([{ name: 'Low', priority: 'low', run }] as any, env)
      expect(run).not.toHaveBeenCalled()
      expect(results.Low.ok).toBe(true)
      expect(results.Low.result).toBeUndefined()
    } finally {
      cpuSpy.mockRestore()
    }
  })
})

describe('cleanup', () => {
  it('归档过期 stale 叙事并清理超龄信号', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('stale1', 'K1', 'stale', date('now','-20 days'), datetime('now','-20 days'), '[]', '[]', '{}'),
              ('fresh', 'K2', 'stale', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    env.DB.exec("INSERT INTO signals (target_type, target_id, created_at) VALUES ('article', '1', datetime('now','-15 days'))")
    const r = await cleanup(env)
    expect(r.archivedNarratives).toBe(1)
    expect(r.deletedSignals).toBe(1)
    const stale = env.DB._db.prepare("SELECT status FROM narratives WHERE keyword = 'stale1'").get()
    expect(stale.status).toBe('archived')
    const fresh = env.DB._db.prepare("SELECT status FROM narratives WHERE keyword = 'fresh'").get()
    expect(fresh.status).toBe('stale') // 新鲜的不归档
  })
})

describe('eval 纯函数', () => {
  it('estimateAPICost 按 token 与按调用数估算', () => {
    // 修正后的成本估算：$0.5/M × 1000 token = $0.0005（此前误算成 $0.5，夸大 1000 倍）
    expect(estimateAPICost(0, 1000)).toBeCloseTo(0.0005, 4)
    expect(estimateAPICost(0, 1_000_000)).toBeCloseTo(0.5, 3)
    expect(estimateAPICost(5)).toBe(0.01) // 5 × $0.002
  })

  it('generateReport 汇总 KPI；空 KPI 给默认文案', () => {
    const r = generateReport({ articlesAnalyzed: 3, avgSummaryLength: 120, totalMs: 5000 }, {})
    expect(r.summary).toContain('3 篇分析')
    expect(r.details.some((d: string) => d.includes('5000'))).toBe(false) // ms 显示为秒
    expect(r.details.some((d: string) => d.includes('5.0 秒'))).toBe(true)
    const empty = generateReport({}, {})
    expect(empty.summary).toBe('本次运行未产生新内容')
  })

  it('saveReport 写入 agentReport', async () => {
    await saveReport(env, { timestamp: 'x', summary: '报告', details: [], kpi: {} })
    const r = await metaGetJSON<{ summary: string }>(env, META.agentReport)
    expect(r?.summary).toBe('报告')
  })
})

describe('agent state', () => {
  it('markAgentRun 写 last_run，并发守卫据此判定', async () => {
    await markAgentRun(env)
    const v = await metaGet(env, META.lastRun)
    expect(v).toBeTruthy()
    expect(isNaN(Date.parse(v!))).toBe(false)
    // 刚跑过 → 并发守卫 true
    expect(await shouldSkipDueToConcurrency(env)).toBe(true)
    // 10 分钟前的运行 → 不再守卫
    env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)")
      .bind(new Date(Date.now() - 10 * 60_000).toISOString()).run()
    expect(await shouldSkipDueToConcurrency(env)).toBe(false)
  })

  it('pingDeepSeek 探测 API 可用性', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await pingDeepSeek('k')).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await pingDeepSeek('k')).toBe(false)
  })
})

describe('saveAnalysis / ask（写层）', () => {
  it('saveAnalysis 归一化 string[] 实体为对象数组', async () => {
    insertNews(1, '待分析', 'S1', { entities: null, analysisDetail: null })
    const r = await saveAnalysis(env, 1, { summary: '新摘要', entities: ['英伟达'], category: 'AI' })
    expect(r.ok).toBe(true)
    const row = env.DB._db.prepare('SELECT entities, category, analyzed_at FROM news WHERE id = 1').get()
    expect(JSON.parse(row.entities)).toEqual([{ name: '英伟达', type: 'concept', weight: 0.5 }])
    expect(row.category).toBe('AI')
    expect(row.analyzed_at).toBeTruthy()
  })

  it('saveAnalysis 异常返回安全错误', async () => {
    // 循环引用让 JSON.stringify 抛错，触发 catch 返回安全错误
    const c: any = {}
    c.self = c
    const r = await saveAnalysis(env, 999, { summary: 'x', entities: [c] })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('分析保存失败')
  })

  it('ask 校验长度：过短返回 400', async () => {
    const res = await ask(env, 'a')
    expect(res.status).toBe(400)
  })

  it('ask 命中候选时返回答案与引用', async () => {
    insertNews(1, '英伟达发布新芯片', 'S1')
    insertNews(2, '量子计算突破', 'S2')
    mockAI()
    const res = await ask(env, '英伟达芯片')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.answer).toContain('GPU')
    expect(data.refs[0].id).toBe(1)
  })

  it('ask 无候选时返回空答案', async () => {
    insertNews(1, '量子计算突破', 'S1')
    const res = await ask(env, '马拉松比赛')
    const data = await res.json()
    expect(data.answer).toBeNull()
    expect(data.refs).toEqual([])
  })
})
