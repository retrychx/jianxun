/**
 * Agent state management — last-run tracking, execution log persistence,
 * circuit breaker (DeepSeek availability check), and CPU budget tracking.
 */

import type { Env } from '../helpers.js'
import type { AgentRunLog } from './types.js'
import { CONFIG } from './config.js'

const META_LAST_RUN = 'last_run'
const META_LAST_LOG = 'last_log'

// ─── Concurrency guard ────────────────────────────────────────

/** Check if a minimum interval has passed since the last agent run. */
export async function shouldSkipDueToConcurrency(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value FROM agent_meta WHERE key = '${META_LAST_RUN}'`).first<any>()
  if (!row?.value) return false
  return (Date.now() - new Date(row.value).getTime()) < CONFIG.agent.concurrencyGuardMs
}

/** Persist the current timestamp as the last agent run. */
export async function markAgentRun(env: Env): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('${META_LAST_RUN}', ?)`)
    .bind(new Date().toISOString()).run()
}

/** Save a structured agent run log. */
export async function saveAgentLog(env: Env, log: AgentRunLog): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('${META_LAST_LOG}', ?)`)
    .bind(JSON.stringify(log)).run()
}

// ─── Circuit breaker ──────────────────────────────────────────

/** Ping DeepSeek to verify the API is responsive (circuit breaker). */
export async function pingDeepSeek(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CONFIG.agent.pingTimeoutMs),
    })
    return res.ok
  } catch {
    console.error('[agent] DeepSeek ping failed — skipping AI phases')
    return false
  }
}

// ─── CPU budget tracker ────────────────────────────────────────

/**
 * Pages Functions have a 30-second CPU time limit.
 * We track elapsed time and skip low-priority phases when approaching the limit.
 */
const BUDGET_SAFE_MS = 25_000  // Stay under 30s with margin

let _budgetStart = 0
let _budgetExhausted = false

/** Initialize the CPU budget counter. Call at the start of runAgent. */
export function initBudget(): void {
  _budgetStart = Date.now()
  _budgetExhausted = false
}

/** Check if we've exceeded our safe CPU budget. */
export function isBudgetExhausted(): boolean {
  return _budgetExhausted
}

/** Log current budget status and return true if we're still ok. */
export function checkBudget(): boolean {
  if (_budgetExhausted) return false
  const elapsed = Date.now() - _budgetStart
  if (elapsed >= BUDGET_SAFE_MS) {
    _budgetExhausted = true
    console.warn(`[agent] CPU budget exceeded (${elapsed}ms) — skipping low-priority phases`)
    return false
  }
  return true
}
