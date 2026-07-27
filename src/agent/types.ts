/** Shared types for the agent architecture. */

import type { Env } from '../helpers.js'

/** Result of running a single phase/tool. */
export interface PhaseResult {
  ok: boolean
  result?: any
  error?: string
  ms: number
}

/** Priority tier — high-priority phases run first and never get skipped. */
export type PhasePriority = 'critical' | 'normal' | 'low'

/** A phase/tool definition registered with the scheduler. */
export interface PhaseDef {
  /** Unique phase name (used in logging + results key). */
  name: string
  /** The actual async work. */
  run: (env: Env) => Promise<any>
  /** Optional per-phase timeout override (ms). */
  timeout?: number
  /** Phase names that must complete before this one starts. */
  dependsOn?: string[]
  /** If true, skip this phase (circuit breaker / dependency failure). */
  shouldSkip?: boolean
  /** Priority: critical=must run, normal=default, low=skipped when CPU budget tight. */
  priority?: PhasePriority
}

/** Full agent run log persisted to agent_meta. */
export interface AgentRunLog {
  ts: string
  totalMs: number
  skipAi: boolean
  results: Record<string, PhaseResult>
}
