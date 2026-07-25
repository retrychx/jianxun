import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { FetcherService } from './fetcher.service.js'
import { ClassifierService } from './classifier.service.js'

@Injectable()
export class NewsCron {
  private readonly logger = new Logger(NewsCron.name)

  constructor(
    private fetcher: FetcherService,
    private classifier: ClassifierService,
  ) {}

  /**
   * 每天早上 8:00 和晚上 20:00 自动抓取并分类
   * cron: 秒 分 时 日 月 周
   */
  @Cron('0 0 8,20 * * *')
  async autoFetch() {
    this.logger.log('🕐 定时抓取开始...')
    const items = await this.fetcher.fetchAll()
    if (items.length) {
      await this.classifier.classify(items)
      await this.classifier.saveResults(items)
      this.logger.log(`✅ 定时抓取完成，新增 ${items.length} 条`)
    } else {
      this.logger.log('⏹️  无新条目')
    }
  }
}
