/** Agent architecture types — legacy phase types + v2 memory/signals/quality. */

import type { Env } from '../helpers.js'

// ═══ Legacy types (used by scheduler, state, tests) ═══

export interface PhaseResult {
  ok: boolean
  result?: any
  error?: string
  ms: number
}

export type PhasePriority = 'critical' | 'normal' | 'low'

/**
 * 调度元数据：决定 planPhases 是否把该阶段纳入本轮运行。
 * 由阶段自身声明（单一事实源），避免手写名字列表导致漏注册（generateProductIdeas 曾因此永不运行）。
 * - always    每轮完整运行都跑（日报/灵感内部按天去重）
 * - analysis  总是跑的分析
 * - narrative 叙事相关
 * - postAnalysis 依赖分析结果（突发/多源对比/实体链接等）
 * - onSignals 有信号或间隔久才跑（来源权重/翻译等）
 * - budget    预算充足才跑（低优先级）
 */
export type PhaseSchedule = 'always' | 'analysis' | 'narrative' | 'postAnalysis' | 'onSignals' | 'budget'

export interface PhaseDef {
  name: string
  /** 第二个参数是阶段级 AbortSignal：阶段超时会被 abort，帮助中止 in-flight DeepSeek/fetch */
  run: (env: Env, signal?: AbortSignal) => Promise<any>
  timeout?: number
  dependsOn?: string[]
  shouldSkip?: boolean
  priority?: PhasePriority
  /** 调度元数据：缺省时按 'always' 处理 */
  schedule?: PhaseSchedule
}

export interface AgentRunLog {
  ts: string
  totalMs: number
  skipAi: boolean
  results: Record<string, PhaseResult>
}

// ═══ v2 types ═══

export interface AgentMemory {
  sourceMemory: Record<string, { ctr: number; qualityScore: number; totalAnalyses: number; failedAnalyses: number }>
  entityHeat: Record<string, { clicks: number; lastSeen: string }>
  categoryConfidence: Record<string, { total: number; correct: number }>
  lastRunAt: string
  totalAnalyses: number
}

export interface SignalSummary {
  sourceCTR: Map<string, { total: number; clicks: number; rate: number }>
  entityClicks: Map<string, number>
  categoryEngagement: Map<string, number>
}

export interface QualityCheck {
  passed: boolean
  score: number
  issues: string[]
  suggestion?: 'retry' | 'accept' | 'flag'
}

export interface AnalysisPriority {
  articleId: number
  score: number
  reason: string
}
