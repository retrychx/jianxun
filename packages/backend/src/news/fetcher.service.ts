import { Injectable, Logger } from '@nestjs/common'
import Parser from 'rss-parser'
import { RSS_SOURCES, RssSource } from './rss-sources.js'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { News } from './news.entity.js'

type FeedItem = {
  title?: string
  link?: string
  contentSnippet?: string
  content?: string
  pubDate?: string
  isoDate?: string
  'media:content'?: { $: { url: string } }
  'media:thumbnail'?: { $: { url: string } }
  enclosure?: { url: string; type: string }
}

/** 每个 RSS 源最多取多少条，避免单源刷屏 */
const MAX_PER_SOURCE = 20

@Injectable()
export class FetcherService {
  private readonly logger = new Logger(FetcherService.name)
  private parser = new Parser({
    timeout: 20_000,
    headers: { 'User-Agent': 'Mozilla/5.0 NewsBot/1.0' },
    customFields: {
      item: ['media:content', 'media:thumbnail', 'enclosure'],
    },
  })

  constructor(
    @InjectRepository(News)
    private newsRepo: Repository<News>,
  ) {}

  /** 抓取所有 RSS 源，返回新条目 */
  async fetchAll(): Promise<Partial<News>[]> {
    const all: Partial<News>[] = []
    for (const source of RSS_SOURCES) {
      try {
        const items = await this.fetchOne(source)
        if (items.length) {
          this.logger.log(`  ✓ ${source.name}: ${items.length} 条`)
        }
        all.push(...items)
      } catch (e) {
        this.logger.warn(`  ✗ ${source.name}: ${(e as Error).message}`)
      }
    }
    this.logger.log(`共抓取 ${all.length} 条新条目`)
    return all
  }

  private async fetchOne(source: RssSource): Promise<Partial<News>[]> {
    const feed = await this.parser.parseURL(source.url)
    if (!feed.items?.length) return []

    const results: Partial<News>[] = []

    for (const item of feed.items as FeedItem[]) {
      if (results.length >= MAX_PER_SOURCE) break

      const title = item.title?.trim()
      const link = item.link?.trim()
      if (!title || !link) continue

      // 去重
      const exists = await this.newsRepo.findOne({ where: { url: link } })
      if (exists) continue

      // 提取图片
      const image = this.extractImage(item)

      results.push({
        title,
        url: link,
        image,
        source: source.name,
        lang: source.lang,
        description: (item.contentSnippet || item.content || '').slice(0, 2000),
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        category: '其他',
        score: 50,
        summary: null,
      })
    }

    return results
  }

  /** 从 RSS 条目中提取 OG 图片 */
  private extractImage(item: FeedItem): string | null {
    // media:content
    const mc = item['media:content']
    if (mc?.$?.url) return mc.$.url
    // media:thumbnail
    const mt = item['media:thumbnail']
    if (mt?.$?.url) return mt.$.url
    // enclosure
    const enc = item.enclosure
    if (enc?.url && enc.type?.startsWith('image')) return enc.url
    // 从 content 中正则提取第一张图片
    const content = item.content || ''
    const m = content.match(/<img[^>]+src=["']([^"']+)["']/)
    return m?.[1] || null
  }
}
