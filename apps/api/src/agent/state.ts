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
  const row = await env.DB.prepare('SELECT value FROM agent_meta WHERE key = ?').bind('last_run').first<any>()
  if (!row?.value) return false
  return (Date.now() - new Date(row.value).getTime()) < CONFIG.agent.concurrencyGuardMs
}

/** Persist the current timestamp as the last COMPLETED agent run（供 checkSystemState 计划阶段）。 */
export async function markAgentRun(env: Env): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)").bind(new Date().toISOString()).run()
}

// ─── 运行锁：防止并发 run（与 last_run 解耦）───
// 之前用"运行开始写 last_run"做锁，导致 checkSystemState 读到 secondsSinceLastRun≈0，
// planPhases 永远只跑 analyzeNewArticles+flagLowQualityAnalyses，digest/叙事/简报等阶段全部被跳过。
const META_RUNNING = 'running'
const LOCK_STALE_MS = 30 * 60_000 // 残留锁（isolate 被平台掐断）超过 30 分钟视为过期

/** 获取运行锁；已占用或残留锁未过期时返回 false。 */
export async function acquireAgentLock(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT value FROM agent_meta WHERE key = ?').bind(META_RUNNING).first<any>()
    if (row) {
      const ts = Number(row.value)
      if (!Number.isNaN(ts) && Date.now() - ts < LOCK_STALE_MS) return false
    }
    await env.DB.prepare('INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)').bind(META_RUNNING, String(Date.now())).run()
    return true
  } catch { return true }
}

/** 释放运行锁。 */
export async function releaseAgentLock(env: Env): Promise<void> {
  try { await env.DB.prepare('DELETE FROM agent_meta WHERE key = ?').bind(META_RUNNING).run() } catch {}
}

/** Save a structured agent run log. */
export async function saveAgentLog(env: Env, log: AgentRunLog): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_log', ?)").bind(JSON.stringify(log)).run()
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
