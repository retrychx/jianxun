/**
 * Agent 真实逻辑测试：真实 SQLite（node:sqlite）+ migrations/*.sql + mock fetch。
 * 取代旧的自证式测试（内联拷贝 / 手写 Map / 真实联网 ping）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { analyzeNewArticles } from '../src/agent/analyze.js'
import { updateNarratives } from '../src/agent/narrative.js'
import { mergeOverlappingNarratives, flagLowQualityAnalyses } from '../src/agent/quality.js'
import { ingestSignals } from '../src/agent/memory.js'
import { tuneSourceWeights } from '../src/agent/health.js'
import { detectBreakingNews } from '../src/agent/breaking.js'
import { acquireAgentLock, releaseAgentLock, initSubrequestBudget } from '../src/agent/state.js'
import { runAgent } from '../src/agent/index.js'
import { runPhases } from '../src/agent/scheduler.js'
import { META, metaGet } from '../src/db.js'

const ANALYSIS_JSON = JSON.stringify({
  summary: '英伟达发布新一代GPU芯片，性能大幅提升。',
  keyPoints: ['要点1', '要点2'],
  category: 'AI',
  entities: [{ name: '英伟达', type: 'company', weight: 0.9, role: '主角' }],
  sentiment: { label: 'positive', scores: { positive: 0.7, negative: 0.1, neutral: 0.2 }, perspective: '乐观' },
  significance: '行业重大发布',
  controversy: false,
  impact: 'high',
})

const TOPIC_LABELS_JSON = JSON.stringify([{ index: 0, label: '英伟达新GPU' }])

let env: any

beforeEach(() => {
  const { d1 } = createTestDB()
  env = makeEnv(d1)
  initSubrequestBudget()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** mock fetch：api.deepseek.com → AI 结果；其他 URL → 文章 HTML */
function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    if (u.includes('api.deepseek.com/chat/completions')) {
      const body = JSON.parse((init?.body as string) || '{}')
      const system = body?.messages?.[0]?.content || ''
      let content = ANALYSIS_JSON
      if (system.includes('话题标签') || system.includes('新闻话题编辑')) content = TOPIC_LABELS_JSON
      else if (system.includes('叙事')) content = '这是一条关键进展'
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // 文章页：og:image + 正文
    return new Response(
      '<html><head><title>Page</title><meta property="og:image" content="https://img.example.com/x.png"></head><body><p>这是一段足够长的正文内容，用来验证内容抽取。</p></body></html>',
      { status: 200 },
    )
  }))
}

describe('analyzeNewArticles', () => {
  it('分析待处理文章并写入 summary/analyzed_at，analyze_attempts +1', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, description, score, published_at, title_norm)
       VALUES ('英伟达发布GPU', 'https://example.com/a1', '测试', 'zh', 'short', 80, datetime('now','-1 hour'), 'n1')`,
    )
    mockFetch()
    const done = await analyzeNewArticles(env, 10)
    expect(done).toBe(1)
    const row = env.DB._db.prepare('SELECT summary, analyzed_at, analyze_attempts FROM news WHERE id = 1').get()
    expect(row.summary).toContain('英伟达')
    expect(row.analyzed_at).toBeTruthy()
    expect(row.analyze_attempts).toBe(1)
  })

  it('无 API key 时直接返回 0', async () => {
    env.DEEPSEEK_API_KEY = ''
    const done = await analyzeNewArticles(env, 10)
    expect(done).toBe(0)
  })

  it('限并发池能处理多篇文章', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, description, score, published_at, title_norm) VALUES
       ('文章甲', 'https://example.com/a1', '测试', 'zh', 'short', 80, datetime('now','-1 hour'), 'n1'),
       ('文章乙', 'https://example.com/a2', '测试', 'zh', 'short', 79, datetime('now','-1 hour'), 'n2'),
       ('文章丙', 'https://example.com/a3', '测试', 'zh', 'short', 78, datetime('now','-1 hour'), 'n3')`,
    )
    mockFetch()
    const done = await analyzeNewArticles(env, 10)
    expect(done).toBe(3)
    const analyzed = env.DB._db.prepare('SELECT COUNT(*) c FROM news WHERE analyzed_at IS NOT NULL').get()
    expect(analyzed.c).toBe(3)
  })
})

describe('flagLowQualityAnalyses', () => {
  it('把摘要过短/实体为空的已分析文章重置为待分析', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, summary, entities, analyzed_at, title_norm)
       VALUES ('a', 'https://e.com/1', 'S1', 'zh', 'too short', '[]', datetime('now'), 'na')`,
    )
    const flagged = await flagLowQualityAnalyses(env)
    expect(flagged).toBe(1)
    const row = env.DB._db.prepare('SELECT analyzed_at, analyze_attempts FROM news WHERE id = 1').get()
    expect(row.analyzed_at).toBeNull()
    expect(row.analyze_attempts).toBe(1)
  })
})

describe('mergeOverlappingNarratives', () => {
  it('合并文章重叠 ≥60% 的两个叙事，并归档被合并方', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('k1', 'K1', 'active', date('now'), datetime('now'), '[1,2,3]', '[]', '{}'),
              ('k2', 'K2', 'active', date('now'), datetime('now'), '[2,3,4]', '[]', '{}')`,
    )
    const merged = await mergeOverlappingNarratives(env)
    expect(merged).toBe(1)
    const k2 = env.DB._db.prepare("SELECT status FROM narratives WHERE keyword = 'k2'").get()
    expect(k2.status).toBe('archived')
  })

  it('重叠不足时不合并', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('k1', 'K1', 'active', date('now'), datetime('now'), '[1]', '[]', '{}'),
              ('k2', 'K2', 'active', date('now'), datetime('now'), '[9,8,7]', '[]', '{}')`,
    )
    const merged = await mergeOverlappingNarratives(env)
    expect(merged).toBe(0)
  })
})

describe('ingestSignals', () => {
  it('按来源计算点击率', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, click_count, created_at, title_norm)
       VALUES ('a', 'https://e.com/1', 'S1', 'zh', 3, datetime('now'), 'na'),
              ('b', 'https://e.com/2', 'S1', 'zh', 0, datetime('now'), 'nb')`,
    )
    const sig = await ingestSignals(env)
    const s = sig.sourceCTR.get('S1')!
    expect(s.total).toBe(2)
    expect(s.clicks).toBe(3)
    expect(s.rate).toBeCloseTo(1.5)
  })
})

describe('tuneSourceWeights', () => {
  it('按连续失败次数下调来源权重', async () => {
    env.DB.exec("INSERT INTO source_stats (source, fail_count) VALUES ('S1', 3)")
    env.DB.exec("INSERT INTO source_weights (source, weight) VALUES ('S1', 1.0)")
    const r = await tuneSourceWeights(env)
    expect(r.tuned).toBe(1)
    const row = env.DB._db.prepare("SELECT weight FROM source_weights WHERE source = 'S1'").get()
    expect(row.weight).toBeLessThan(1.0)
    expect(row.weight).toBeGreaterThan(0)
  })

  it('M1: 低点击率来源不被恢复分支抬高（单次计算防双调整）', async () => {
    env.DB.exec("INSERT INTO source_stats (source, fail_count) VALUES ('S1', 0)")
    env.DB.exec("INSERT INTO source_weights (source, weight) VALUES ('S1', 0.8)")
    env.DB.exec(`INSERT INTO news (title, url, source, lang, click_count, created_at, title_norm) VALUES
      ('a', 'https://e.com/1', 'S1', 'zh', 0, datetime('now'), 'n1'),
      ('b', 'https://e.com/2', 'S1', 'zh', 0, datetime('now'), 'n2')`)
    const r = await tuneSourceWeights(env)
    expect(r.tuned).toBe(1)
    const row = env.DB._db.prepare("SELECT weight FROM source_weights WHERE source = 'S1'").get()
    // 低 CTR（0%）→ 降 0.1 → 0.9。旧逻辑的"恢复分支"会把权重再抬回 1.0（覆盖降权），
    // 此处断言 0.9 即拒绝该回归。
    expect(row.weight).toBe(0.9)
  })
})

describe('detectBreakingNews', () => {
  it('多来源 high-impact 文章被创建为突发叙事', async () => {
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, analyzed_at, analysis_detail, title_norm)
       VALUES (1, 'Breaking Event Happened Now', 'https://e.com/1', 'S1', 'zh', datetime('now'), '{"impact":"high"}', 'be1'),
              (2, 'Breaking Event Happened Now', 'https://e.com/2', 'S2', 'zh', datetime('now'), '{"impact":"high"}', 'be2')`,
    )
    const r = await detectBreakingNews(env)
    expect(r.breaking).toBe(1)
    const narr = env.DB._db.prepare("SELECT keyword FROM narratives WHERE keyword LIKE '__breaking__%'").get()
    expect(narr.keyword).toContain('__breaking__')
  })
})

describe('updateNarratives', () => {
  it('返回 KPI 计数并跑完既有叙事匹配', async () => {
    mockFetch()
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, description, score, published_at, created_at, title_norm)
       VALUES (1, '英伟达发布GPU芯片', 'https://e.com/1', 'S1', 'zh', '一篇关于英伟达新产品的报道内容', 90,
               datetime('now','-1 hour'), datetime('now'), 'n1')`,
    )
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('英伟达 · GPU', '英伟达新动向', 'active', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    const result = await updateNarratives(env)
    // 至少能跑完并返回计数（具体数值取决于语义匹配，不锁死）
    expect(typeof result.matched).toBe('number')
    expect(typeof result.created).toBe('number')
  })

  it('M3: 无可匹配内容时不再写 last_run（last_run 与运行锁解耦）', async () => {
    // 空库 → updateNarratives 提前返回；内部不应触碰 last_run
    // （旧逻辑在 updateNarratives 里写 last_run，会让并发守卫误以为"刚跑过"）
    await updateNarratives(env)
    expect(await metaGet(env, META.lastRun)).toBeNull()
  })

  it('覆盖度匹配：文章与叙事共享 ≥3 token 且覆盖 ≥35% 时追加进展', async () => {
    // 根因回归：旧 jaccard 匹配被叙事千级 token 集稀释到阈值不可达，developments 永不积累。
    // 覆盖度用文章侧做分母：标题 10 token 中 8 个命中叙事集 → ratio 0.8 ≥ 0.35、shared 8 ≥ 3 → 匹配。
    mockFetch()
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, description, score, published_at, created_at, title_norm)
       VALUES (1, '英伟达发布新一代GPU芯片', 'https://e.com/1', 'S1', 'zh', '一篇关于英伟达新产品的报道内容', 90,
               datetime('now','-1 hour'), datetime('now'), 'n1')`,
    )
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats, summary)
       VALUES ('英伟达', '英伟达新动向', 'active', date('now'), datetime('now'), '[]', '[]', '{}', '英伟达正在发布新一代GPU芯片，性能大幅提升')`,
    )
    const result = await updateNarratives(env)
    expect(result.matched).toBe(1)
    const narr = env.DB._db.prepare("SELECT developments FROM narratives WHERE keyword = '英伟达'").get()
    expect(JSON.parse(narr.developments).length).toBe(1)
  })

  it('覆盖度不足时不匹配（文章与叙事共享 token 太少）', async () => {
    mockFetch()
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, description, score, published_at, created_at, title_norm)
       VALUES (1, '英伟达发布新一代GPU芯片', 'https://e.com/1', 'S1', 'zh', '一篇关于英伟达新产品的报道内容', 90,
               datetime('now','-1 hour'), datetime('now'), 'n1')`,
    )
    // 无关叙事：token 集与文章几乎没有交集（无 summary，仅标签"天气"）
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('天气', '天气变化', 'active', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    const result = await updateNarratives(env)
    expect(result.matched).toBe(0)
  })

  it('种子叙事（article_ids 已有文章但 developments 为空）重新匹配时也落库首条进展', async () => {
    // 回归：appendDevelopment 旧守卫 `if (!newIds.length) return` 在文章已在 article_ids 时
    // 直接丢弃进展，导致种子叙事 / 被重播的叙事 developments 永远为空、故事永不更新。
    // 种子叙事的文章在 24h 窗口内会被重新匹配，此时 newIds 为空但 existing 为空，
    // 必须把这条进展写入，否则故事永远没有进展。
    mockFetch()
    env.DB.exec(
      `INSERT INTO news (id, title, url, source, lang, description, score, published_at, created_at, title_norm)
       VALUES (1, '英伟达发布新一代GPU芯片', 'https://e.com/1', 'S1', 'zh', '一篇关于英伟达新产品的报道内容', 90,
               datetime('now','-1 hour'), datetime('now'), 'n1')`,
    )
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats, summary)
       VALUES ('英伟达', '英伟达新动向', 'active', date('now'), datetime('now'), '[1]', '[]', '{}', '英伟达正在发布新一代GPU芯片，性能大幅提升')`,
    )
    const result = await updateNarratives(env)
    expect(result.matched).toBe(1)
    const narr = env.DB._db.prepare("SELECT developments FROM narratives WHERE keyword = '英伟达'").get()
    const devs = JSON.parse(narr.developments)
    expect(devs.length).toBe(1)
    expect(devs[0].text).toContain('关键进展')
  })
})

describe('breaking 关键词 LIKE 转义（M5 回归）', () => {
  it('转义下划线后只匹配 __breaking__ 前缀，误写的 xxbreakingXX 不再被选中', async () => {
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats) VALUES
       ('__breaking__真事件', 'K1', 'active', date('now'), datetime('now'), '[]', '[]', '{}'),
       ('xxbreakingYY', 'K2', 'active', date('now'), datetime('now'), '[]', '[]', '{}')`,
    )
    // 反证：未转义的旧写法（_ 是单字符通配符）会把 xxbreakingYY 也选中
    const old = await env.DB.prepare("SELECT keyword FROM narratives WHERE keyword LIKE '__breaking__%' ORDER BY keyword").all()
    expect(old.results?.map((r: any) => r.keyword)).toHaveLength(2)
    // 修复后的查询（curate.ts 现用此 SQL）：只命中真正的 __breaking__ 前缀
    const rows = await env.DB.prepare("SELECT keyword FROM narratives WHERE keyword LIKE '\\_\\_breaking\\_\\_%' ESCAPE '\\' ORDER BY keyword").all()
    expect(rows.results?.map((r: any) => r.keyword)).toEqual(['__breaking__真事件'])
  })
})

describe('runAgent 异常路径（M2）', () => {
  it('中途抛异常仍释放运行锁，后续可立即重新获取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    // 让 checkSystemState 抛错：删掉 signals 表（M4 后 checkSystemState 只查 signals + last_run）
    env.DB.exec('DROP TABLE signals')
    await expect(runAgent(env)).rejects.toThrow()
    // finally 释放了 running 锁 → 立即可重新获取（旧逻辑异常时锁残留卡 30 分钟）
    expect(await acquireAgentLock(env)).toBe(true)
    await releaseAgentLock(env)
  })
})

describe('runPhases 阶段中止（M6）', () => {
  it('超时时 abort 传入的 signal，底层工作真正停止', async () => {
    let aborted = false
    const results = await runPhases([{
      name: 'AbortMe', timeout: 30,
      // 模拟真实 AI 阶段：不监听 abort 就永不返回（fetchWithRetry 中止后短路返回 null）
      run: (_env: any, signal: any) => new Promise(() => {
        signal.addEventListener('abort', () => { aborted = true })
      }),
    }] as any, env)
    expect(results.AbortMe.ok).toBe(false)
    expect(results.AbortMe.error).toContain('Timed out')
    // 关键断言：超时不再是"Promise.race 假中止"，而是真的 abort 了底层 signal
    expect(aborted).toBe(true)
  })
})

describe('agent run lock', () => {
  it('未占用时可获取；占用后拒绝；释放后可再获取', async () => {
    expect(await acquireAgentLock(env)).toBe(true)
    expect(await acquireAgentLock(env)).toBe(false)
    await releaseAgentLock(env)
    expect(await acquireAgentLock(env)).toBe(true)
    await releaseAgentLock(env)
  })

  it('残留锁超过 30 分钟视为过期可重新获取', async () => {
    // 手动写一个 40 分钟前的 running 锁
    env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('running', ?)")
      .bind(String(Date.now() - 40 * 60_000)).run()
    expect(await acquireAgentLock(env)).toBe(true)
    await releaseAgentLock(env)
  })
})

describe('tryCatch', () => {
  it('回调返回 Response 时透传，不再二次 JSON.stringify 成 {}', async () => {
    const { tryCatch, json } = await import('../src/helpers.js')
    const r = await tryCatch(async () => json({ a: 1 }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ a: 1 })
    // 回调返回数据时仍正常 json 序列化
    const r2 = await tryCatch(async () => ({ b: 2 }))
    expect(await r2.json()).toEqual({ b: 2 })
    // 非 200 的 Response 透传
    const r3 = await tryCatch(async () => json({ error: 'x' }, 400))
    expect(r3.status).toBe(400)
    expect(await r3.json()).toEqual({ error: 'x' })
  })
})
