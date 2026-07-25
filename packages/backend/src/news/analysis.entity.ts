import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, JoinColumn, OneToOne,
} from 'typeorm'
import { News } from './news.entity.js'

export interface EntityItem {
  name: string
  type: 'person' | 'company' | 'product' | 'technology' | 'concept'
  weight: number // 0-1 相关性
}

export interface SentimentAnalysis {
  label: 'positive' | 'negative' | 'neutral' | 'mixed'
  scores: {
    positive: number
    negative: number
    neutral: number
  }
  perspective?: string // 报道角度描述
}

@Entity('analysis')
export class Analysis {
  @PrimaryGeneratedColumn()
  id!: number

  @OneToOne(() => News, { onDelete: 'CASCADE' })
  @JoinColumn()
  news!: News

  @Column({ type: 'integer' })
  newsId!: number

  @Column({ type: 'text', nullable: true })
  content!: string | null

  @Column({ type: 'text', nullable: true })
  summary!: string | null

  @Column({ type: 'text', nullable: true })
  entities!: string | null // JSON string of EntityItem[]

  @Column({ type: 'text', nullable: true })
  sentiment!: string | null // JSON string of SentimentAnalysis

  @Column({ type: 'boolean', default: false })
  analyzed!: boolean

  @CreateDateColumn()
  createdAt!: Date
}
