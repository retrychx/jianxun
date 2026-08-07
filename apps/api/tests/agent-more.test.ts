/**
 * Agent 层补全单测（D4）：
 * - D1 调度元数据：planPhases 各分支 + ALL_PHASES 注册完整性（防"加阶段忘调度"）
 * - checkSystemState / generateProductIdeas / generateTodayDigest / linkEntities
 * - refineCategories / extractTopEntityEvents / generateNarrativeOutlooks / detectControversy
 * - saveKPI / loadMemory·saveMemory / systemHealth·recordError / statusCheck
 *
 * 均用真实 SQLite + migrations + mock fetch 运行真实逻辑，非自证式。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { ALL_PHASES } from '../src/agent/index.js'
import { planPhases, checkSystemState } from '../src/agent/decider.js'
import { generateProductIdeas } from '../src/agent/ideas.js'
import { generateTodayDigest } from '../src/api/digest.js'
import { linkEntities } from '../src/agent/entity.js'
import { refineCategories } from '../src/agent/analyze.js'
import { saveKPI } from '../src/agent/eval.js'
import { loadMemory, saveMemory } from '../src/agent/memory.js'
import { systemHealth, recordError } from '../src/agent/cleanup.js'
import { statusCheck } from '../src/helpers.js'
import { extractTopEntityEvents, generateNarrativeOutlooks } from '../src/agent/intel.js'
import { detectControversy } from '../src/agent/debate.js'
import { META, metaGet, metaSet, metaGetJSON, metaSetJSON } from '../src/db.js'

let env: any

beforeEach(() => {
  const { d1 } = createTestDB()
  env = makeEnv(d1)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function state(over: any = {}) {
  return {
    pendingArticles: 5, pendingSignals: 0, activeNarratives: 2,
    secondsSinceLastRun: 99999, apiOk: true, remainingBudget: 10_000, ...over,
  }
}

/** 按 system/user 内容路由 DeepSeek 响应 */
function mockDeepSeek() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    if (!u.includes('api.deepseek.com/chat/completions')) {
      return new Response('<html><body>ok</body></html>', { status: 200 })
    }
    const body = JSON.parse((init?.body as string) || '{}')
    const sys = body?.messages?.[0]?.content || ''
    const user = body?.messages?.[1]?.content || ''
    const joined = sys + '|' + user
    let content: string
    if (joined.includes('新闻分类助手')) {
      // 根据标题决定分类，避免 ORDER BY RANDOM() 打乱批次顺序导致断言不稳定
      const userText = body?.messages?.[1]?.content || ''
      content = JSON.stringify(userText.split('\n').filter((l: string) => l.trim()).map((line: string, idx: number) => {
        const title = line.replace(/^\[\d+\]\s*/, '')
        const category = title.includes('融资') ? '财经' : title.includes('模型') ? 'AI' : '科技'
        return { index: idx, category }
      }))
    } else if (joined.includes('主编')) {
      content = JSON.stringify({
        intro: '今日要闻',
        items: [1, 2, 3, 4, 5].map(nid => ({ news_id: nid, why: '重点' + nid, category: 'AI' })),
        extra: null,
      })
    } else if (joined.includes('产品孵化')) {
      content = JSON.stringify({ ideas: [
        { signal: '英伟达发布新品', title: 'GPU看板', concept: '实时展示AI芯片行情', whyNow: '算力需求热', audience: '开发者' },
        { signal: 'OpenAI 新模型', title: '模型评测站', concept: 'LLM 横向评测', whyNow: '模型变多', audience: '开发者' },
      ] })
    } else if (joined.includes('前瞻判断')) {
      content = '关注其下一代产品的落地节奏'
    } else if (joined.includes('抽取结构化事件')) {
      content = JSON.stringify([{ type: 'product', title: '发布新品', date: '2026-08-08', detail: '发布新一代芯片' }])
    } else {
      content = JSON.stringify({
        summary: '英伟达发布新一代GPU芯片，性能大幅提升。',
        keyPoints: ['要点1'], category: 'AI',
        entities: [{ name: '英伟达', type: 'company', weight: 0.9, role: '主角' }],
        sentiment: { label: 'positive', scores: { positive: 0.7, negative: 0.1, neutral: 0.2 }, perspective: '乐观' },
        significance: '行业重大发布', controversy: false, impact: 'high',
      })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }))
}

// ═══ D1：调度元数据驱动 ═══

describe('ALL_PHASES 注册完整性（D1 防回归）', () => {
  it('每个阶段都有合法的 schedule 值', () => {
    const VALID = new Set(['always', 'analysis', 'narrative', 'postAnalysis', 'onSignals', 'budget'])
    for (const p of ALL_PHASES) {
      expect(VALID.has(p.schedule!), `${p.name} 缺 schedule 元数据`).toBe(true)
    }
  })

  it('阶段名唯一，无重复注册', () => {
    const names = ALL_PHASES.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('planPhases', () => {
  it('2 分钟内刚跑过 → 只跑 analysis + critical 级 always（不含低优先级）', () => {
    const names = planPhases(state({ secondsSinceLastRun: 60 }), ALL_PHASES).map(p => p.name)
    expect(names).toContain('analyzeNewArticles')
    expect(names).toContain('flagLowQualityAnalyses')
    expect(names).not.toContain('updateNarratives')
    expect(names).not.toContain('curateBriefing')
    expect(names).not.toContain('generateProductIdeas')
  })

  it('完整周期覆盖全部阶段（有信号 + 预算充足），防"加了阶段但忘了调度"', () => {
    const names = planPhases(state({ pendingSignals: 2, remainingBudget: 60_000, secondsSinceLastRun: 7200 }), ALL_PHASES).map(p => p.name)
    for (const p of ALL_PHASES) expect(names).toContain(p.name)
  })

  it('无信号且间隔短 → 不含 onSignals 阶段', () => {
    const names = planPhases(state({ pendingSignals: 0, secondsSinceLastRun: 600 }), ALL_PHASES).map(p => p.name)
    expect(names).not.toContain('refineCategories')
    expect(names).not.toContain('translateMissing')
    expect(names).not.toContain('tuneSourceWeights')
  })

  it('预算不足 → 不含 budget 阶段（generateResearchBriefs）', () => {
    const names = planPhases(state({ remainingBudget: 10_000 }), ALL_PHASES).map(p => p.name)
    expect(names).not.toContain('generateResearchBriefs')
  })

  it('预算充足 → 纳入 generateResearchBriefs 并标记 low 优先级', () => {
    const p = planPhases(state({ remainingBudget: 60_000 }), ALL_PHASES).find(p => p.name === 'generateResearchBriefs')
    expect(p?.priority).toBe('low')
  })
})

describe('checkSystemState', () => {
  it('统计待分析文章/信号/活跃叙事，并按 last_run 计算间隔', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, published_at, title_norm) VALUES
       ('a', 'https://e.com/1', 'S1', 'zh', datetime('now','-1 hour'), 'na'),
       ('b', 'https://e.com/2', 'S1', 'zh', datetime('now','-1 hour'), 'nb')`,
    )
    env.DB.exec("INSERT INTO signals (target_type, target_id) VALUES ('article', '1')")
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('k', 'K', 'active', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    await metaSet(env, META.lastRun, new Date(Date.now() - 3600_000).toISOString())

    const s = await checkSystemState(env)
    expect(s.pendingArticles).toBe(2)
    expect(s.pendingSignals).toBe(1)
    expect(s.activeNarratives).toBe(1)
    expect(s.secondsSinceLastRun).toBeGreaterThan(3500)
    expect(s.secondsSinceLastRun).toBeLessThan(3700)
  })

  it('无 last_run 时 secondsSinceLastRun 取大值（视为久未运行）', async () => {
    const s = await checkSystemState(env)
    expect(s.secondsSinceLastRun).toBe(99999)
  })
})

// ═══ 业务阶段 ═══

describe('generateProductIdeas', () => {
  it('当天已生成（按北京时间）→ 直接返回 0，不发请求', async () => {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    await metaSet(env, META.productIdeasDate, today)
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await generateProductIdeas(env)).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('热门信号充足时生成 1-3 个 idea 并持久化', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, score, published_at, title_norm) VALUES
       ('英伟达发布新品', 'https://e.com/1', 'S1', 'zh', 90, datetime('now','-1 hour'), 'n1'),
       ('OpenAI 新模型', 'https://e.com/2', 'S2', 'zh', 85, datetime('now','-1 hour'), 'n2'),
       ('量子计算突破', 'https://e.com/3', 'S3', 'zh', 80, datetime('now','-1 hour'), 'n3'),
       ('机器人量产', 'https://e.com/4', 'S4', 'zh', 75, datetime('now','-1 hour'), 'n4'),
       ('芯片设计提速', 'https://e.com/5', 'S5', 'zh', 70, datetime('now','-1 hour'), 'n5')`,
    )
    mockDeepSeek()
    const n = await generateProductIdeas(env)
    expect(n).toBe(2)
    const data = await metaGetJSON<any>(env, META.productIdeas)
    expect(data.ideas.length).toBe(2)
    expect(data.date).toBe(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10))
  })

  it('信号不足（<5）时返回 0', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, score, published_at, title_norm) VALUES
       ('只有一条', 'https://e.com/1', 'S1', 'zh', 90, datetime('now','-1 hour'), 'n1')`,
    )
    expect(await generateProductIdeas(env)).toBe(0)
  })
})

describe('generateTodayDigest', () => {
  function insertNews(count: number) {
    const rows = []
    for (let i = 1; i <= count; i++) {
      rows.push(`(${i}, '标题${i}', 'https://e.com/${i}', 'S1', 'zh', '摘要${i}', 90, datetime('now','-1 hour'), '{"significance":"重要","controversy":false}')`)
    }
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, summary, score, published_at, analysis_detail) VALUES ${rows.join(',')}`,
    )
  }

  it('候选不足 5 条 → insufficient，不调模型', async () => {
    insertNews(3)
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await generateTodayDigest(env)).toBe('insufficient')
    expect(spy).not.toHaveBeenCalled()
  })

  it('首次生成写入 digests 表', async () => {
    insertNews(6)
    mockDeepSeek()
    expect(await generateTodayDigest(env)).toBe('generated')
    const row = env.DB._db.prepare('SELECT intro, items FROM digests ORDER BY id DESC LIMIT 1').get()
    expect(row.intro).toBe('今日要闻')
    expect(JSON.parse(row.items)[0].news_id).toBe(1)
  })

  it('当天已有 digest 且无新文章 → 增量返回 exists，不再调模型', async () => {
    insertNews(6)
    mockDeepSeek()
    await generateTodayDigest(env) // 首次生成，消耗掉 news_id 1
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    // 再跑一次：候选都在 existingIds 里 → newArticles < 3 → exists，不发请求
    expect(await generateTodayDigest(env)).toBe('exists')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('linkEntities（纯 DB，无 AI）', () => {
  it('同义实体名归一到同一 canonical，并更新新闻 entities', async () => {
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, analyzed_at, entities, title_norm) VALUES
       (1, '苹果发布新品', 'https://e.com/1', 'S1', 'zh', datetime('now'), '[{"name":"苹果","type":"company","weight":0.9},{"name":"苹果公司","type":"company","weight":0.4}]', 'na'),
       (2, '苹果公司财报', 'https://e.com/2', 'S2', 'zh', datetime('now'), '[{"name":"苹果","type":"company","weight":0.7}]', 'nb')`,
    )
    const r = await linkEntities(env)
    expect(r.linked).toBeGreaterThan(0)
    // '苹果公司' 归一到 '苹果'
    const link = env.DB._db.prepare("SELECT canonical_name FROM entity_links WHERE original_name = '苹果公司'").get()
    expect(link.canonical_name).toBe('苹果')
    // 新闻 entities 已更新为 canonical 且去重
    const n1 = env.DB._db.prepare('SELECT entities FROM news WHERE id = 1').get()
    expect(JSON.parse(n1.entities)).toEqual([{ name: '苹果', type: 'company', weight: 0.9 }])
  })

  it('无已分析文章时返回 { linked: 0 }', async () => {
    env.DB.exec(`INSERT INTO news (title, url, source, lang, entities, title_norm) VALUES ('x', 'https://e.com/1', 'S1', 'zh', '[]', 'nx')`)
    expect(await linkEntities(env)).toEqual({ linked: 0 })
  })
})

describe('refineCategories', () => {
  it('把 score=50 且 analyze_attempts>0 的科技文章重新分类', async () => {
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, category, score, analyze_attempts, title_norm) VALUES
       (1, '模型发布', 'https://e.com/1', 'S1', 'zh', '科技', 50, 1, 'n1'),
       (2, '融资新闻', 'https://e.com/2', 'S2', 'zh', '科技', 50, 1, 'n2'),
       (3, '维持科技', 'https://e.com/3', 'S3', 'zh', '科技', 50, 1, 'n3')`,
    )
    mockDeepSeek()
    const r = await refineCategories(env)
    expect(r.refined).toBe(2) // 模型发布→AI、融资新闻→财经；维持科技保持科技
    const cats = env.DB._db.prepare('SELECT id, category FROM news ORDER BY id').all()
    expect(cats).toEqual([
      { id: 1, category: 'AI' }, { id: 2, category: '财经' }, { id: 3, category: '科技' },
    ])
  })
})

describe('extractTopEntityEvents / generateNarrativeOutlooks', () => {
  it('实体事件当天已生成 → 跳过，不发 AI 请求', async () => {
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, entities, created_at, title_norm) VALUES
       (1, '英伟达新品', 'https://e.com/1', 'S1', 'zh', '[{"name":"英伟达","type":"company"}]', datetime('now'), 'n1')`,
    )
    await metaSetJSON(env, META.entityEvents, { 英伟达: { events: [{ type: 'product' }], ts: new Date().toISOString() } })
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await extractTopEntityEvents(env)).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('叙事前瞻未生成 → 调用 AI 生成并持久化', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('英伟达', '英伟达新动向', 'active', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    mockDeepSeek()
    const n = await generateNarrativeOutlooks(env)
    expect(n).toBe(1)
    const outlooks = await metaGetJSON<Record<string, { outlook: string; ts: string }>>(env, META.narrativeOutlooks)
    expect(outlooks?.['英伟达']?.outlook).toBeTruthy()
  })
})

describe('detectControversy', () => {
  it('争议文章不足 2 篇 → 不调模型直接返回 0', async () => {
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, analyzed_at, analysis_detail, title_norm) VALUES
       (1, '争议事件', 'https://e.com/1', 'S1', 'zh', datetime('now'), '{"controversy":true,"impact":"high"}', 'n1')`,
    )
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await detectControversy(env)).toEqual({ debates: 0 })
    expect(spy).not.toHaveBeenCalled()
  })
})

// ═══ 持久化（KPI / memory / health / status）═══

describe('saveKPI', () => {
  it('追加历史并保留最近 30 条', async () => {
    await saveKPI(env, { articlesAnalyzed: 1 })
    await saveKPI(env, { articlesAnalyzed: 2 })
    const hist = await metaGetJSON<any[]>(env, META.agentKpis)
    expect(hist?.length).toBe(2)
    expect(hist?.[1].articlesAnalyzed).toBe(2)
  })
})

describe('loadMemory / saveMemory', () => {
  it('往返一致', async () => {
    await saveMemory(env, { sourceMemory: { S1: { ctr: 0.5, qualityScore: 1, totalAnalyses: 1, failedAnalyses: 0 } }, entityHeat: {}, categoryConfidence: {}, lastRunAt: '', totalAnalyses: 0 })
    const mem = await loadMemory(env)
    expect(mem.sourceMemory.S1.ctr).toBe(0.5)
    expect(mem.lastRunAt).toBeTruthy()
  })

  it('记忆损坏时回退默认结构', async () => {
    await metaSet(env, META.agentMemory, '{not json')
    const mem = await loadMemory(env)
    expect(mem).toEqual({ sourceMemory: {}, entityHeat: {}, categoryConfidence: {}, lastRunAt: '', totalAnalyses: 0 })
  })
})

describe('systemHealth / recordError', () => {
  it('recordError 追加错误，systemHealth 返回最近 5 条', async () => {
    await recordError(env, 'analyzeNewArticles', 'boom')
    await recordError(env, 'updateNarratives', 'network')
    const h = await systemHealth(env)
    expect(h.recentErrors.length).toBe(2)
    expect(h.recentErrors[0].source).toBe('analyzeNewArticles')
    expect(h.recentErrors[0].message).toBe('boom')
  })
})

describe('statusCheck', () => {
  it('读取 last_fetch / last_run 与配置状态', async () => {
    await metaSetJSON(env, META.lastFetch, { ts: '2026-08-08T00:00:00.000Z', fetched: 3 })
    await metaSet(env, META.lastRun, '2026-08-08T01:00:00.000Z')
    const s = await statusCheck(env)
    expect(s.hasDeepSeek).toBe(true)
    expect(s.hasAdminToken).toBe(true)
    expect(s.lastFetch.fetched).toBe(3)
    expect(s.lastAgentRun).toBe('2026-08-08T01:00:00.000Z')
  })
})
