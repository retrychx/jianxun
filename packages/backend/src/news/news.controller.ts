import { Controller, Get, Query, Param, DefaultValuePipe, ParseIntPipe, Inject, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { News } from './news.entity.js'
import { Analysis, EntityItem, SentimentAnalysis } from './analysis.entity.js'
import { FetcherService } from './fetcher.service.js'
import { ClassifierService } from './classifier.service.js'
import { AnalysisService } from './analysis.service.js'

@Controller()
export class NewsController {
  constructor(
    @InjectRepository(News)
    private newsRepo: Repository<News>,
    @InjectRepository(Analysis)
    private analysisRepo: Repository<Analysis>,
    @Inject(FetcherService) private fetcher: FetcherService,
    @Inject(ClassifierService) private classifier: ClassifierService,
    @Inject(AnalysisService) private analyzer: AnalysisService,
  ) {}

  /** 获取新闻列表（支持分类筛选+分页） */
  @Get('news')
  async list(
    @Query('category') category?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize?: number,
  ) {
    const where: Record<string, unknown> = {}
    if (category && category !== '全部') where.category = category

    const [items, total] = await this.newsRepo.findAndCount({
      where,
      order: { score: 'DESC', createdAt: 'DESC' },
      skip: ((page || 1) - 1) * (pageSize || 20),
      take: pageSize || 20,
    })

    return { items, total, page: page || 1, pageSize: pageSize || 20 }
  }

  /** 获取排行榜（按分数） */
  @Get('news/trending')
  async trending() {
    const items = await this.newsRepo.find({
      order: { score: 'DESC' },
      take: 30,
    })
    return { items }
  }

  /** 获取所有分类及计数 */
  @Get('news/categories')
  async categories() {
    const result = await this.newsRepo
      .createQueryBuilder('news')
      .select('news.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('news.category')
      .orderBy('count', 'DESC')
      .getRawMany()

    return { categories: result.map(r => ({ name: r.category, count: Number(r.count) })) }
  }

  /** 手动触发抓取 */
  @Get('news/fetch')
  async fetch() {
    const items = await this.fetcher.fetchAll()
    if (items.length) {
      // 先用关键词分类（立刻保存）
      this.classifier.defaultClassify(items)
      const saved = await this.classifier.saveResults(items)
      // AI 分类后台执行，不阻塞响应
      this.classifier.classify(items).catch(e =>
        console.error('AI分类后台失败:', e.message)
      )
    }
    return { fetched: items.length }
  }

  /** 系统状态 */
  @Get('news/stats')
  async stats() {
    const total = await this.newsRepo.count()
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const today = await this.newsRepo
      .createQueryBuilder('news')
      .where('news.createdAt >= :start', { start: startOfDay })
      .getCount()
    return { total, today }
  }

  /** ===== 分析相关 ===== */

  /** 获取话题聚类 */
  @Get('news/topics')
  async topics() {
    return this.analyzer.getTopics()
  }

  /** 获取新闻详情（含 AI 分析） */
  @Get('news/:id/detail')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const news = await this.newsRepo.findOne({ where: { id } })
    if (!news) throw new NotFoundException()

    // 执行分析
    const analysis = await this.analyzer.analyze(id)
    const related = await this.analyzer.findRelated(id)

    // 格式化实体和情感
    const entities: EntityItem[] = analysis.entities ? JSON.parse(analysis.entities) : []
    const sentiment: SentimentAnalysis | null = analysis.sentiment ? JSON.parse(analysis.sentiment) : null

    return {
      ...news,
      analysis: {
        summary: analysis.summary,
        entities,
        sentiment,
        content: analysis.content?.slice(0, 3000), // 只返回前3000字
      },
      related,
    }
  }

  /** 搜索实体相关新闻 */
  @Get('news/entity/:name')
  async byEntity(@Param('name') name: string) {
    const items = await this.newsRepo
      .createQueryBuilder('n')
      .where('n.title LIKE :q', { q: `%${name}%` })
      .orWhere('n.description LIKE :q', { q: `%${name}%` })
      .orderBy('n.score', 'DESC')
      .take(30)
      .getMany()

    return { items, entity: name }
  }
}
