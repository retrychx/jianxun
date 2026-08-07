/**
 * tokenize + clusterNews + topics/topic/weekly。
 * 聚类是纯逻辑；topics/topic/weekly 走真实 SQLite，mock fetch 供 AI 标签/前情提要。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { tokenize } from '../src/tokenize.js'
import { clusterNews, topics, topic, weekly } from '../src/topics.js'

let env: any
beforeEach(() => { const { d1 } = createTestDB(); env = makeEnv(d1) })
afterEach(() => { vi.unstubAllGlobals() })

/** DeepSeek mock：话题标签 → JSON 数组；前情提要 → 文本；其他 → 分析 JSON */
function mockAI() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (!String(url).includes('api.deepseek.com/chat/completions')) {
      return new Response('<html></html>', { status: 200 })
    }
    const body = JSON.parse((init?.body as string) || '{}')
    const sys = body?.messages?.[0]?.content || ''
    let content: string
    if (sys.includes('话题标签') || sys.includes('新闻话题编辑')) {
      content = JSON.stringify([{ index: 0, label: 'AI 标签' }, { index: 1, label: '硬件标签' }])
    } else if (sys.includes('前情提要')) {
      content = '这是本话题的前情提要'
    } else {
      content = JSON.stringify({ summary: '摘要', category: 'AI', entities: [], sentiment: { label: 'neutral' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  }))
}

describe('tokenize', () => {
  it('空文本返回空数组', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })

  it('英文/数字词拆出并小写', () => {
    const toks = tokenize('OpenAI 发布 GPT-4o 模型')
    expect(toks).toContain('openai')
    expect(toks).toContain('gpt-4o')
  })

  it('词典长词命中（最长匹配）', () => {
    const toks = tokenize('大语言模型训练成本下降')
    expect(toks).toContain('大语言模型')
  })

  it('非词典中文走 n-gram 兜底', () => {
    const toks = tokenize('量子霸权时代')
    expect(toks.some(w => w.includes('量子'))).toBe(true)
  })
})

describe('clusterNews', () => {
  it('共享关键词的文章聚成一组', () => {
    const clusters = clusterNews([
      { id: 1, title: '英伟达推出新一代GPU芯片' },
      { id: 2, title: '英伟达市值再创新高' },
      { id: 3, title: '苹果加大Vision Pro产线投入' },
    ])
    // 英伟达两篇聚一组，苹果那篇单独不成簇（Pass1 只保留 ≥2 的簇）
    const groups = clusters.filter(c => c.items.length >= 2)
    expect(groups.length).toBe(1)
    expect(groups[0].items.map((i: any) => i.id).sort()).toEqual([1, 2])
  })

  it('完全不相关的文章不产生簇', () => {
    const clusters = clusterNews([
      { id: 1, title: '今天天气很好适合出行' },
      { id: 2, title: '苹果加大Vision Pro产线投入' },
    ])
    expect(clusters.filter(c => c.items.length >= 2).length).toBe(0)
  })
})

describe('topics(env)', () => {
  it('聚类生成话题列表并写缓存（fallback 标签，无 AI 也返回）', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, summary, score, published_at, title_norm) VALUES
       ('英伟达推出新一代GPU芯片', 'https://e.com/1', 'S1', 'zh', '英伟达推出新一代GPU芯片', 90, datetime('now','-1 hour'), 'n1'),
       ('英伟达市值再创新高', 'https://e.com/2', 'S2', 'zh', '英伟达市值再创新高', 85, datetime('now','-2 hours'), 'n2'),
       ('苹果加大Vision Pro产线投入', 'https://e.com/3', 'S3', 'zh', '苹果加大产线投入', 80, datetime('now','-3 hours'), 'n3')`,
    )
    const data = await topics(env)
    const first = data.topics.find((t: any) => t.count >= 2)
    expect(first).toBeTruthy()
    expect(first.count).toBe(2)
    // items 已被 mapNews 归一（camelCase）
    expect(Array.isArray(first.items)).toBe(true)
    expect(first.items[0].title).toBe('英伟达推出新一代GPU芯片')
    // 标签回退到标题片段
    expect(typeof first.label).toBe('string')
  })
})

describe('topic(env, name)', () => {
  it('命中聚类的关键词返回时间线与视角', async () => {
    mockAI()
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, summary, score, published_at, title_norm) VALUES
       ('英伟达发布新GPU', 'https://e.com/1', 'S1', 'zh', '英伟达推出新一代GPU芯片', 90, datetime('now','-2 hour'), 'n1'),
       ('英伟达股价新高', 'https://e.com/2', 'S2', 'zh', '英伟达市值再创新高', 85, datetime('now','-1 hour'), 'n2')`,
    )
    const data = await topic(env, '英伟达')
    expect(data).toBeTruthy()
    expect(data.timeline.length).toBeGreaterThanOrEqual(2)
    expect(data.storyline).toContain('前情提要')
    expect(data.perspectives.length).toBeGreaterThan(0)
  })

  it('无聚类命中时按标题 LIKE 兜底', async () => {
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, summary, published_at, title_norm) VALUES
       ('量子计算突破', 'https://e.com/9', 'S1', 'zh', '量子计算取得突破', datetime('now','-1 hour'), 'n9')`,
    )
    const data = await topic(env, '量子计算突破')
    expect(data.keyword).toBe('量子计算突破')
    expect(data.label).toBe('量子计算突破')
  })
})

describe('weekly(env)', () => {
  it('统计本周新文章/热门实体/活跃叙事/高产源', async () => {
    mockAI()
    env.DB.exec(
      `INSERT INTO news (title, url, source, lang, entities, created_at, title_norm) VALUES
       ('英伟达发布新GPU', 'https://e.com/1', 'S1', 'zh', '[{"name":"英伟达","type":"company"}]', datetime('now'), 'n1'),
       ('英伟达股价新高', 'https://e.com/2', 'S2', 'zh', '[{"name":"英伟达","type":"company"}]', datetime('now'), 'n2'),
       ('苹果发布新手机', 'https://e.com/3', 'S3', 'zh', '[{"name":"苹果","type":"company"}]', datetime('now'), 'n3')`,
    )
    env.DB.exec(
      `INSERT INTO narratives (keyword, label, status, first_seen, last_updated, article_ids, developments, source_stats)
       VALUES ('英伟达', '英伟达新动向', 'active', date('now','-1 day'), datetime('now'), '[1,2]', '[{"date":"2026-08-08","text":"新品发布","articleCount":2,"sources":["S1","S2"]}]', '{"S1":1,"S2":1}')`,
    )
    const data = await weekly(env)
    expect(data.totalNew).toBe(3)
    expect(data.topEntities[0].name).toBe('英伟达')
    expect(data.topEntities[0].count).toBe(2)
    expect(data.narratives.length).toBe(1)
    expect(data.narratives[0].latest).toContain('新品发布')
    expect(data.topSources[0].name).toBe('S1')
  })
})
