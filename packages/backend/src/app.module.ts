import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { HelloController } from './hello.controller.js'
import { NewsModule } from './news/news.module.js'
import { join } from 'path'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: join(import.meta.dirname, '..', '..', '..', 'data', 'news.db'),
      autoLoadEntities: true,
      synchronize: true, // 开发环境自动建表
    }),
    NewsModule,
  ],
  controllers: [HelloController],
})
export class AppModule {}
