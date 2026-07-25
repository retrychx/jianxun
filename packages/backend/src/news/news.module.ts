import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ScheduleModule } from '@nestjs/schedule'
import { News } from './news.entity.js'
import { Analysis } from './analysis.entity.js'
import { FetcherService } from './fetcher.service.js'
import { ClassifierService } from './classifier.service.js'
import { ContentService } from './content.service.js'
import { AnalysisService } from './analysis.service.js'
import { NewsController } from './news.controller.js'
import { NewsCron } from './news.cron.js'

@Module({
  imports: [
    TypeOrmModule.forFeature([News, Analysis]),
    ScheduleModule.forRoot(),
  ],
  controllers: [NewsController],
  providers: [FetcherService, ClassifierService, ContentService, AnalysisService, NewsCron],
})
export class NewsModule {}
