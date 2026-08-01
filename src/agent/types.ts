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

export interface PhaseDef {
  name: string
  run: (env: Env) => Promise<any>
  timeout?: number
  dependsOn?: string[]
  shouldSkip?: boolean
  priority?: PhasePriority
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
