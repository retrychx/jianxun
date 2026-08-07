/**
 * RSS/Atom 解析 + 标题归一 + 关键词分类。
 * 纯逻辑测试：mock fetch 返回 XML，验证 parseRSS 输出与降级路径。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseRSS } from '../src/parse-rss.js'
import { normalizeTitle } from '../src/title-norm.js'
import { keywordClassify } from '../src/classifier.js'

afterEach(() => { vi.unstubAllGlobals() })

function stubFeed(xml: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status, headers: { 'Content-Type': 'application/xml' } })))
}

const RSS2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>测试源</title>
    <item>
      <title>英伟达发布新一代GPU &amp; 芯片</title>
      <link>https://example.com/a1</link>
      <description><![CDATA[<p>性能提升 <b>大幅</b></p><p>这是第二段。</p>]]></description>
      <pubDate>Tue, 06 Aug 2026 10:00:00 GMT</pubDate>
      <media:content url="https://img.example.com/a1.jpg" medium="image"/>
      <media:thumbnail url="https://img.example.com/a1-thumb.jpg"/>
      <enclosure url="https://audio.example.com/a1.mp3" type="audio/mpeg"/>
    </item>
    <item>
      <title>没有链接的条目</title>
      <description>这条没有 link，不应被收录</description>
    </item>
  </channel>
</rss>`

const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 测试源</title>
  <entry>
    <title>OpenAI 发布新模型</title>
    <link rel="alternate" href="https://example.com/a2"/>
    <summary>这是一个<b>带HTML</b>的摘要。</summary>
    <updated>2026-08-07T08:30:00Z</updated>
    <media:content url="https://img.example.com/a2.jpg" xmlns:media="http://search.yahoo.com/mrss/"/>
    <link rel="enclosure" href="https://img.example.com/a2-enclosure.jpg" type="image/jpeg"/>
  </entry>
  <entry>
    <title>只有标题</title>
    <updated>2026-08-07T09:00:00Z</updated>
  </entry>
</feed>`

describe('parseRSS — RSS 2.0', () => {
  it('解析标题/link/日期/描述/媒体/附件', async () => {
    stubFeed(RSS2_XML)
    const feed = await parseRSS('https://example.com/feed')
    expect(feed.feedTitle).toBe('测试源')
    expect(feed.items.length).toBe(2) // 第二个条目有 title，被保留

    const it = feed.items[0]
    expect(it.title).toContain('GPU')
    expect(it.link).toBe('https://example.com/a1')
    expect(it.isoDate).toBe('2026-08-06T10:00:00.000Z')
    // description 去 HTML 标签
    expect(it.contentSnippet).toContain('性能提升')
    expect(it.contentSnippet).not.toContain('<p>')
    expect(it.mediaContent).toBe('https://img.example.com/a1.jpg')
    expect(it.mediaThumbnail).toBe('https://img.example.com/a1-thumb.jpg')
    expect(it.enclosureUrl).toBe('https://audio.example.com/a1.mp3')
    expect(it.enclosureType).toBe('audio/mpeg')
  })

  it('HTTP 非 2xx 时抛出（供 fetchAllRSS 记 fail_count）', async () => {
    stubFeed('<html>waf block</html>', 403)
    await expect(parseRSS('https://example.com/feed')).rejects.toThrow(/403/)
  })
})

describe('parseRSS — Atom', () => {
  it('解析 entry 的 alternate link / summary / updated / media', async () => {
    stubFeed(ATOM_XML)
    const feed = await parseRSS('https://example.com/atom')
    expect(feed.feedTitle).toBe('Atom 测试源')
    expect(feed.items.length).toBe(2)

    const first = feed.items[0]
    expect(first.title).toBe('OpenAI 发布新模型')
    expect(first.link).toBe('https://example.com/a2')
    // textNode 拼接 Atom 文本内容（fast-xml-parser 会把 <b> 子节点并入文本）
    expect(first.contentSnippet).toContain('摘要')
    expect(first.contentSnippet).not.toContain('<b>')
    expect(first.isoDate).toBe('2026-08-07T08:30:00.000Z')
    expect(first.mediaContent).toBe('https://img.example.com/a2.jpg')
    expect(first.mediaThumbnail).toBeUndefined()
  })

  it('用 updated 兜底日期', async () => {
    stubFeed(ATOM_XML)
    const feed = await parseRSS('https://example.com/atom')
    expect(feed.items[1].isoDate).toBe('2026-08-07T09:00:00.000Z')
  })
})

describe('parseRSS — 降级路径', () => {
  it('XML 解析失败时用正则兜底提取 item', async () => {
    // 缺一个尖括号，fast-xml-parser 会抛错
    stubFeed(`<rss><channel><item><title>回退条目</title><link>https://e.com/fb</link><pubDate>Thu, 01 Aug 2026 00:00:00 GMT</pubDate><description>回归正文</description></item></channel></rss>`.replace('</rss>', '<rss'))
    const feed = await parseRSS('https://example.com/feed')
    expect(feed.items.length).toBe(1)
    expect(feed.items[0].title).toBe('回退条目')
    expect(feed.items[0].link).toBe('https://e.com/fb')
    expect(feed.items[0].contentSnippet).toBe('回归正文')
  })

  it('空 feed 返回空数组', async () => {
    stubFeed('')
    const feed = await parseRSS('https://example.com/feed')
    expect(feed.items).toEqual([])
  })

  it('RSS link 采用 href 属性形式', async () => {
    stubFeed(`<rss><channel><title>t</title>
      <item><title>带属性链接</title><link href="https://e.com/href"/><pubDate>Thu, 01 Aug 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`)
    const feed = await parseRSS('https://example.com/feed')
    expect(feed.items[0].link).toBe('https://e.com/href')
  })
})

describe('normalizeTitle', () => {
  it('去除中文全角标点与空格并转小写', () => {
    expect(normalizeTitle('  Apple 发布新款iPhone！ ')).toBe('apple发布新款iphone！')
    expect(normalizeTitle('英伟达，发布新GPU。')).toBe('英伟达发布新gpu')
    expect(normalizeTitle('  ')).toBe('')
  })
})

describe('keywordClassify', () => {
  it('AI 关键词 → AI/80', () => {
    expect(keywordClassify('大模型训练成本下降', '')).toEqual({ category: 'AI', score: 80 })
    expect(keywordClassify('OpenAI 发布 o3 推理模型', '')).toEqual({ category: 'AI', score: 80 })
  })

  it('硬件/公司关键词 → 科技/70', () => {
    expect(keywordClassify('苹果发布 iPhone 17', '')).toEqual({ category: '科技', score: 70 })
  })

  it('财经关键词 → 财经/70', () => {
    expect(keywordClassify('某公司完成 C 轮融资，估值 10 亿美元', '')).toEqual({ category: '财经', score: 70 })
  })

  it('未命中 → 科技/50（低置信度）', () => {
    expect(keywordClassify('一段无关紧要的日常文字', null)).toEqual({ category: '科技', score: 50 })
  })
})
