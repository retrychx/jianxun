/**
 * 读接口数据层（src/api/read.ts + src/api/digest.ts 读取端）。
 * 真实 SQLite：listNews/trending/categories/stats/search/detail/briefing/sources/digest。
 * 缓存 API 在 node 下不可用 → cacheGet 返回 null，每次走真实计算（恰好覆盖计算路径）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import {
  listNews, trending, categories, stats, search, detail, briefing, sources,
} from '../src/api/read.js'
import { digest, digests } from '../src/api/digest.js'
import { META, metaSetJSON } from '../src/db.js'

let env: any
beforeEach(() => { const { d1 } = createTestDB(); env = makeEnv(d1) })
afterEach(() => { vi.unstubAllGlobals() })

function insertNews(title: string, url: string, over: any = {}) {
  env.DB.prepare(
    `INSERT INTO news (title, url, source, lang, category, score, published_at, title_norm, entities, sentiment, analysis_detail, summary, created_at, analyzed_at)
     VALUES (?, ?, ?, 'zh', ?, ?, datetime('now', ?), ?, ?, ?, ?, ?, datetime('now','+8 hours'), datetime('now'))`
  ).bind(
    title, url, over.source || 'S1', over.category || '科技', over.score ?? 80,
    over.hoursAgo != null ? `-${over.hoursAgo} hours` : '-1 hour', over.titleNorm || title.toLowerCase(),
    over.entities || null, over.sentiment || null, over.analysisDetail || null, over.summary || null,
  ).run()
}

describe('listNews', () => {
  it('返回分页结果，含 total/page；分类过滤生效', async () => {
    insertNews('量子计算突破', 'https://e.com/1', { category: 'AI', score: 90 })
    insertNews('苹果发布新机', 'https://e.com/2', { category: '科技', score: 80 })
    insertNews('融资事件', 'https://e.com/3', { category: '财经', score: 70 })

    const all = await listNews(env, new URL('https://x.test/api/news?page=1&pageSize=10'))
    expect(all.total).toBe(3)
    expect(all.items.length).toBe(3)
    expect(all.page).toBe(1)

    const ai = await listNews(env, new URL('https://x.test/api/news?category=AI'))
    expect(ai.total).toBe(1)
    expect(ai.items[0].title).toBe('量子计算突破')

    const p2 = await listNews(env, new URL('https://x.test/api/news?page=2&pageSize=2'))
    expect(p2.items.length).toBe(1)
  })
})

describe('trending', () => {
  it('按 title_norm 去重，多源实体产生热度', async () => {
    insertNews('英伟达发布新品', 'https://e.com/1', { entities: '[{"name":"英伟达","type":"company"}]' })
    // 同一 title_norm 的重复文章被去重
    insertNews('英伟达发布新品', 'https://e.com/2', { entities: '[{"name":"英伟达","type":"company"}]', source: 'S2' })
    const data = await trending(env)
    expect(data.items.length).toBe(1)
    // 实体被两个来源报道 → heat ≥ 2，trendingScore 高于基准
    expect(data.items[0].heat).toBeGreaterThanOrEqual(2)
  })
})

describe('categories / stats', () => {
  it('categories 聚合分类计数；stats 统计总量与今日', async () => {
    insertNews('a', 'https://e.com/1', { category: 'AI' })
    insertNews('b', 'https://e.com/2', { category: 'AI' })
    insertNews('c', 'https://e.com/3', { category: '科技' })

    const cat = await categories(env)
    expect(cat.categories.find((r: any) => r.name === 'AI')?.count).toBe(2)

    const st = await stats(env)
    expect(st.total).toBe(3)
    // created_at 强制为 now+8h（保证落在北京"今天"），today 与 total 一致且不受测试时刻影响
    expect(st.today).toBe(3)
  })
})

describe('search', () => {
  it('按标题命中（FTS 或 LIKE 兜底都算）', async () => {
    insertNews('量子计算突破性进展', 'https://e.com/1', { score: 90 })
    const data = await search(env, '量子计算')
    expect(data.items.length).toBeGreaterThanOrEqual(1)
    expect(data.items[0].title).toContain('量子计算')
  })

  it('查询少于 2 字符返回空', async () => {
    expect((await search(env, 'a')).items).toEqual([])
  })
})

describe('detail', () => {
  it('返回归一化文章 + 解析后的 analysis + 相关推荐', async () => {
    insertNews('英伟达推出新一代GPU芯片', 'https://e.com/1', {
      summary: '英伟达发布新GPU',
      entities: '[{"name":"英伟达","type":"company","weight":0.9}]',
      sentiment: '{"label":"positive","scores":{"positive":0.7,"negative":0.1,"neutral":0.2},"perspective":"乐观"}',
      analysisDetail: '{"keyPoints":["要点1"],"significance":"重要","controversy":false,"impact":"high"}',
    })
    insertNews('英伟达市值再创新高', 'https://e.com/2', { score: 85 })

    const d = await detail(env, 1)
    expect(d.title).toBe('英伟达推出新一代GPU芯片')
    expect(d.analysis.summary).toBe('英伟达发布新GPU')
    expect(d.analysis.entities[0].name).toBe('英伟达')
    expect(d.analysisDetail.significance).toBe('重要')
    expect(d.analysisDetail.impact).toBe('high')
    // 相关推荐命中共享「英伟达」token 的文章
    expect(d.related.map((r: any) => r.id)).toContain(2)
  })

  it('不存在的 id 返回 null', async () => {
    expect(await detail(env, 999)).toBeNull()
  })
})

describe('briefing', () => {
  it('无 agent 精选时走规则回退，至少 3 条且带 reason', async () => {
    for (let i = 1; i <= 6; i++) insertNews(`标题${i}`, `https://e.com/${i}`, { source: `S${i}`, score: 90 - i })
    const data = await briefing(env)
    expect(data.items.length).toBeGreaterThanOrEqual(3)
    for (const item of data.items) {
      expect(typeof item.reason).toBe('string')
      expect(item.reason.length).toBeGreaterThan(0)
    }
  })

  it('有 agent 精选（≥3 条）时优先返回 curated 列表', async () => {
    for (let i = 1; i <= 3; i++) insertNews(`精选文章${i}`, `https://e.com/${i}`, { score: 90 - i })
    await metaSetJSON(env, META.briefingCurated, {
      items: [
        { id: 1, reason: '主编精选一' },
        { id: 2, reason: '主编精选二' },
        { id: 3, reason: '主编精选三' },
      ],
      updatedAt: new Date().toISOString(),
    })
    const data = await briefing(env)
    expect(data.items.length).toBe(3)
    expect(data.items[0].reason).toBe('主编精选一')
  })
})

describe('sources', () => {
  it('合并 news 计数、source_stats 与预设来源权重', async () => {
    insertNews('a', 'https://e.com/1', { source: '36氪' })
    insertNews('b', 'https://e.com/2', { source: '36氪' })
    env.DB.exec("INSERT INTO source_stats (source, last_ok, fail_count) VALUES ('36氪', datetime('now'), 0)")
    const data = await sources(env)
    const it = data.items.find((s: any) => s.name === '36氪')
    expect(it.total).toBe(2)
    expect(it.weight).toBe(0.9) // RSS_SOURCES 里的权重
    expect(it.lastOk).toBeTruthy()
  })
})

describe('digest / digests 读取端', () => {
  it('digest(date) 还原 items 并关联 news；digests() 列出日期', async () => {
    insertNews('被收进日报的文章', 'https://e.com/1', { score: 90 })
    env.DB.prepare(
      "INSERT INTO digests (date, intro, items, extra) VALUES ('2026-08-08', '今日要闻', ?, NULL)"
    ).bind(JSON.stringify([{ news_id: 1, why: '重大', category: 'AI' }])).run()

    const d = await digest(env, '2026-08-08')
    expect(d.intro).toBe('今日要闻')
    expect(d.items.length).toBe(1)
    expect(d.items[0].title).toBe('被收进日报的文章')
    expect(d.items[0].why).toBe('重大')

    const ds = await digests(env)
    expect(ds.dates).toContain('2026-08-08')
  })

  it('digest(无日期) 取最新一条', async () => {
    env.DB.prepare(
      "INSERT INTO digests (date, intro, items, extra) VALUES ('2026-08-08', '昨日', '[]', NULL), ('2026-08-09', '今日', '[]', NULL)"
    ).run()
    const d = await digest(env, null)
    expect(d.date).toBe('2026-08-09')
  })
})
