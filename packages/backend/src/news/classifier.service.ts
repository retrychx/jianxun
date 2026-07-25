import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import { News, NewsCategory } from './news.entity.js'

/** DeepSeek API 响应格式 */
interface DeepSeekMessage {
  role: 'assistant'
  content: string
}

interface DeepSeekResponse {
  choices: { message: DeepSeekMessage }[]
}

/** AI 返回的分类结果 */
interface ClassifyResult {
  index: number
  category: NewsCategory
  score: number
  summary: string
}

const CLASSIFY_PROMPT = `你是一个新闻编辑。对以下新闻列表中的每一条，请：
1. 分类到: 科技 / AI / 财经 / 政治 / 社会 / 体育 / 娱乐 / 游戏 / 国际 / 健康 / 教育 / 其他
2. 有趣度评分 0-100（基于新颖性、影响力、话题性）
3. 用一句话概括核心内容（中文）

返回 JSON 数组，格式：
[
  { "index": 0, "category": "科技", "score": 85, "summary": "一句话摘要" },
  ...
]

只返回 JSON，不要其他文字。`

@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name)
  private readonly apiKey: string
  private readonly apiUrl = 'https://api.deepseek.com/chat/completions'

  constructor(
    @InjectRepository(News)
    private newsRepo: Repository<News>,
  ) {
    // 从环境变量读取 DeepSeek API Key
    this.apiKey = process.env.DEEPSEEK_API_KEY || ''
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未设置，AI 分类将使用默认值')
    }
  }

  /** 对一批新闻进行分类 */
  async classify(items: Partial<News>[]): Promise<void> {
    if (!items.length) return
    if (!this.apiKey) {
      // 无 API Key：用默认逻辑
      this.defaultClassify(items)
      return
    }

    // 分批，每批最多 20 条（避免 token 超限）
    const batchSize = 20
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      await this.classifyBatch(batch, i)
    }
  }

  private async classifyBatch(batch: Partial<News>[], offset: number): Promise<void> {
    const list = batch.map((n, idx) =>
      `[${offset + idx}] 标题: ${n.title}\n   摘要: ${(n.description || '').slice(0, 300)}`
    ).join('\n\n')

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: CLASSIFY_PROMPT },
            { role: 'user', content: list },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        }),
      })

      if (!res.ok) {
        this.logger.error(`DeepSeek API ${res.status}: ${await res.text()}`)
        this.defaultClassify(batch)
        return
      }

      const data = (await res.json()) as DeepSeekResponse
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error('空响应')

      const results = JSON.parse(text) as ClassifyResult[]
      for (const r of results) {
        const idx = r.index - offset
        if (idx >= 0 && idx < batch.length) {
          batch[idx].category = r.category || '其他'
          batch[idx].score = Math.max(0, Math.min(100, r.score ?? 50))
          batch[idx].summary = (r.summary || '').slice(0, 500)
        }
      }
      this.logger.log(`AI 分类完成 ${batch.length} 条`)
    } catch (e) {
      this.logger.error(`AI 分类出错: ${(e as Error).message}`)
      this.defaultClassify(batch)
    }
  }

  /** 无 API Key 时基于关键词简单分类 */
  defaultClassify(items: Partial<News>[]): void {
    for (const item of items) {
      item.category = this.keywordClassify(item.title + ' ' + (item.description || ''))
      item.score = 60
      item.summary = (item.description || '').slice(0, 150) + '...'
    }
  }

  private keywordClassify(text: string): NewsCategory {
    const t = text.toLowerCase()
    // AI (highest priority — catch early)
    if (/ai|人工智能|gpt|llm|大模型|机器学习|deepseek|机器人|neural|transformer|opena|claude|bard|llama|agi|autonomous|computer vision|nlp|chatbot|推荐系统|智能体|agent|多模态|diffusion|model training|fine.?tun/.test(t)) return 'AI'
    // 科技 (tech hardware / software / startups)
    if (/iphone|apple|华为|小米|芯片|gpu|cpu|5g|6g|手机|电脑|软件|startup|saas|cloud|数据|data|算法|algorithm|browser|os |operating system|android|ios|windows|linux|quantum|cyber|security|vulnerability|hack|oem|专利|pixel|samsung|amazon|meta |google |microsoft/.test(t)) return '科技'
    // 财经
    if (/股票|基金|比特币|以太坊|crypto|blockchain|美元|央行|降息|通胀|ipo|merger|acquisition|revenue|profit|earnings|market|investor|融资|估值|上市|投资|融资/.test(t)) return '财经'
    // 国际
    if (/联合国|欧盟|俄罗斯|美国|中国|日本|韩国|外交|大使|制裁|war |military|navy|treaty|summit|北约|g7|g20|geopolit/.test(t)) return '国际'
    // 政治
    if (/拜登|特朗普|普京|选举|国会|议会|senate|congress|govern|president|prime minister|vote|democrat|republican|政策|立法/.test(t)) return '政治'
    // 健康
    if (/疫情|疫苗|新冠|covid|癌症|手术|健康|医疗|hospital|drug|patient|治疗|药物|clinical|biotech|gene|dna|brain/.test(t)) return '健康'
    // 体育
    if (/nba|英超|欧冠|世界杯|奥运|足球|篮球|体育|soccer|tennis|f1 |gp |championship|olympic|athlete|coach|stadium/.test(t)) return '体育'
    // 娱乐
    if (/电影|音乐|综艺|明星|票房|迪士尼|netflix|hollywood|oscar|album|concert|streaming|trailer|actor|导演/.test(t)) return '娱乐'
    // 游戏
    if (/游戏|playstation|xbox|switch|steam|原神|电竞|gaming|rpg|fps|game|nintendo|playstation|pc gaming|esport/.test(t)) return '游戏'
    // 教育
    if (/教育|高考|考研|留学|大学|课程|school|university|student|professor|academic|phd|research paper|study|classroom/.test(t)) return '教育'
    // 社会
    if (/地震|台风|事故|犯罪|法院|警方|climate|weather|flood|fire|police|crime|protest|法律/.test(t)) return '社会'
    return '科技' // 默认归为科技（比"其他"更有意义）
  }

  /** 保存分类结果到数据库 */
  async saveResults(items: Partial<News>[]): Promise<News[]> {
    const entities = this.newsRepo.create(items as News[])
    return this.newsRepo.save(entities)
  }
}
