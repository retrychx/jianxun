import {
  Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn,
} from 'typeorm'

export type NewsCategory =
  | '科技' | '财经' | '政治' | '社会' | '体育'
  | '娱乐' | '游戏' | 'AI' | '国际' | '健康'
  | '教育' | '其他'

@Entity('news')
export class News {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 500 })
  title!: string

  @Column({ type: 'text', nullable: true })
  description!: string | null

  @Column({ type: 'varchar', length: 500 })
  url!: string

  @Column({ type: 'varchar', length: 100 })
  source!: string

  @Column({ type: 'varchar', length: 10, default: 'zh' })
  lang!: string

  @Column({ type: 'varchar', length: 50, default: '其他' })
  category!: NewsCategory

  @Column({ type: 'integer', default: 50 })
  score!: number

  @Column({ type: 'text', nullable: true })
  summary!: string | null

  /** OG 图片 URL */
  @Column({ type: 'varchar', length: 500, nullable: true })
  image!: string | null

  @Column({ type: 'datetime', nullable: true })
  publishedAt!: Date | null

  @CreateDateColumn()
  @Index()
  createdAt!: Date
}
