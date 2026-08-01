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
})
