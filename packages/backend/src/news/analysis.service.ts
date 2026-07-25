import { Injectable, Logger, Inject } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Analysis, EntityItem, SentimentAnalysis } from './analysis.entity.js'
import { ContentService } from './content.service.js'
import { News } from './news.entity.js'

/** DeepSeek API 响应 */
interface DeepSeekResponse {
  choices: { message: { content: string } }[]
}

const ANALYSIS_PROMPT = `你是一个智能新闻分析助手。分析以下新闻文章的全文，返回 JSON（不要其他文字）：

{
  "summary": "2-3句话的简洁中文摘要，覆盖核心事件、背景和影响",
  "entities": [
    { "name": "实体名称", "type": "person|company|product|technology|concept", "weight": 0.8 }
  ],
  "sentiment": {
    "label": "positive|negative|neutral|mixed",
    "scores": { "positive": 0.x, "negative": 0.x, "neutral": 0.x },
    "perspective": "报道角度和倾向简短描述（中文）"
  }
}

要求：
- entities 列出最重要的3-6个实体，weight 表示与文章的相关性(0-1)
- sentiment.scores 总和为 1.0
- perspective 用一句话描述该报道的切入角度和情绪倾向`
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name)
  private readonly apiUrl = 'https://api.deepseek.com/chat/completions'

  constructor(
    @InjectRepository(Analysis)
    private analysisRepo: Repository<Analysis>,
    @InjectRepository(News)
    private newsRepo: Repository<News>,
    @Inject(ContentService) private contentService: ContentService,
  ) {}

  /** 对一篇新闻执行全部分析 */
  async analyze(newsId: number): Promise<Analysis> {
    // 查缓存
    let analysis = await this.analysisRepo.findOne({ where: { newsId } })
    if (analysis?.analyzed) return analysis

    const news = await this.newsRepo.findOne({ where: { id: newsId } })
    if (!news) throw new Error('新闻不存在')

    // 抓取正文 + 图片
    const { content, image } = await this.contentService.extractAll(news.url)
    if (image && !news.image) {
      news.image = image
      await this.newsRepo.save(news)
    }

    // 创建/更新记录
    if (!analysis) {
      analysis = this.analysisRepo.create({ newsId, content, analyzed: false })
    } else {
      analysis.content = content
    }

    // AI 分析
    if (process.env.DEEPSEEK_API_KEY && content) {
      try {
        const result = await this.callAI(content, news.title)
        analysis.summary = result.summary
        analysis.entities = JSON.stringify(result.entities)
        analysis.sentiment = JSON.stringify(result.sentiment)
        analysis.analyzed = true
      } catch (e) {
        this.logger.error(`AI 分析失败 news#${newsId}: ${(e as Error).message}`)
        analysis.summary = this.fallbackSummary(content)
        analysis.analyzed = false
      }
    } else {
      analysis.summary = this.fallbackSummary(content || news.title)
      analysis.entities = JSON.stringify(this.guessEntities(news.title))
      analysis.sentiment = JSON.stringify({ label: 'neutral', scores: { positive: 0.3, negative: 0.3, neutral: 0.4 }, perspective: '无 AI API 配置，无法分析' })
      analysis.analyzed = false
    }

    return this.analysisRepo.save(analysis)
  }

  /** 分析并保存（供批量调用） */
  async analyzeBatch(newsList: News[]): Promise<void> {
    for (const news of newsList) {
      try {
        await this.analyze(news.id)
      } catch (e) {
        this.logger.warn(`批量分析失败 news#${news.id}: ${(e as Error).message}`)
      }
    }
  }

  /** 通过 DeepSeek API 调用 AI */
  private async callAI(content: string, title: string): Promise<{
    summary: string
    entities: EntityItem[]
    sentiment: SentimentAnalysis
  }> {
    const text = `标题: ${title}\n\n正文:\n${content.slice(0, 8000)}`

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: ANALYSIS_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    })

    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)

    const data = (await res.json()) as DeepSeekResponse
    const raw = data.choices?.[0]?.message?.content
    if (!raw) throw new Error('空响应')

    // 提取 JSON（AI 可能返回 markdown 代码块）
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      summary: parsed.summary || '无法生成摘要',
      entities: (parsed.entities || []).slice(0, 6),
      sentiment: parsed.sentiment || { label: 'neutral', scores: { positive: 0.3, negative: 0.3, neutral: 0.4 }, perspective: '' },
    }
  }

  /** 无 AI 时的后备摘要 */
  private fallbackSummary(text: string): string {
    return text.slice(0, 200).replace(/\s+/g, ' ').trim() + '...'
  }

  /** 从标题猜测实体 */
  private guessEntities(title: string): EntityItem[] {
    const entities: EntityItem[] = []
    const patterns: { re: RegExp; type: EntityItem['type'] }[] = [
      { re: /苹果|华为|小米|微软|谷歌|Google|Apple|Meta|Tesla|OpenAI|DeepSeek/gi, type: 'company' },
      { re: /iPhone|ChatGPT|GPT|iOS|Android|Windows/gi, type: 'product' },
      { re: /AI|人工智能|大模型|机器学习|LLM|AGI/gi, type: 'technology' },
    ]
    for (const { re, type } of patterns) {
      const match = title.match(re)
      if (match) {
        entities.push({ name: match[0], type, weight: 0.7 })
      }
    }
    return entities
  }

  /** 获取分析结果 */
  async getAnalysis(newsId: number): Promise<Analysis | null> {
    return this.analysisRepo.findOne({ where: { newsId } })
  }

  /** 查找相似新闻（多源对比用） */
  async findRelated(newsId: number, limit = 5): Promise<News[]> {
    const news = await this.newsRepo.findOne({ where: { id: newsId } })
    if (!news) return []

    // 从标题提取关键词（简单分词）
    const words = this.tokenize(news.title)
    if (!words.length) return []

    // 模糊匹配标题含相同关键词的
    const params: Record<string, string> = {}
    const clauses = words.map((w, i) => {
      params[`kw${i}`] = `%${w}%`
      return `n.title LIKE :kw${i}`
    })
    const related = await this.newsRepo.createQueryBuilder('n')
      .where('n.id != :id', { id: newsId })
      .andWhere(clauses.join(' OR '), params)
      .orderBy('n.score', 'DESC')
      .take(limit)
      .getMany()

    // 按匹配度排序
    return related
      .map(n => ({ n, score: this.similarity(news.title, n.title) }))
      .filter(x => x.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.n)
  }

  /** 获取话题聚类 */
  async getTopics() {
    const all = await this.newsRepo.find({ order: { score: 'DESC' }, take: 80 })
    const used = new Set<number>()
    const topics: { keyword: string; count: number; sources: string[]; items: typeof all }[] = []

    for (const item of all) {
      if (used.has(item.id)) continue
      const words = this.tokenize(item.title)
      if (!words.length) continue
      const cluster: typeof all = [item]
      used.add(item.id)

      for (const other of all) {
        if (used.has(other.id)) continue
        if (words.some(w => other.title.includes(w))) {
          cluster.push(other)
          used.add(other.id)
        }
      }

      if (cluster.length >= 2) {
        topics.push({
          keyword: words.slice(0, 3).join(' · '),
          count: cluster.length,
          sources: [...new Set(cluster.map(i => i.source))],
          items: cluster.slice(0, 5),
        })
      }
    }

    topics.sort((a, b) => b.count - a.count)
    return { topics: topics.slice(0, 15) }
  }

  /** 分词取关键词 */
  tokenize(text: string): string[] {
    // 去标点
    const clean = text.replace(/[^\w一-鿿\s]/g, ' ')
    // 取长度>1的词和>2的中文字
    const words = clean.split(/\s+/).filter(w => w.length > 1)
    // 取中文字（每2-4字作为关键词）
    const cn = clean.replace(/[a-zA-Z0-9]/g, '')
    const cnWords: string[] = []
    for (let i = 0; i < cn.length - 1; i++) {
      const seg = cn.slice(i, i + 3)
      if (seg.length >= 2 && seg.trim()) cnWords.push(seg)
    }
    return [...new Set([...words, ...cnWords].filter(w => w.length > 1))]
  }

  /** 标题相似度（Jaccard + 词重叠） */
  private similarity(a: string, b: string): number {
    const setA = new Set(this.tokenize(a))
    const setB = new Set(this.tokenize(b))
    if (!setA.size || !setB.size) return 0
    const intersection = new Set([...setA].filter(x => setB.has(x)))
    const union = new Set([...setA, ...setB])
    return intersection.size / union.size
  }
}
