/**
 * Agent state management — last-run tracking, execution log persistence,
 * circuit breaker (DeepSeek availability check), and CPU budget tracking.
 */

import type { Env } from '../helpers.js'
import type { AgentRunLog } from './types.js'
import { CONFIG } from './config.js'
import { META, metaGet, metaSet, metaDelete, metaSetJSON } from '../db.js'

// ─── Concurrency guard ────────────────────────────────────────

/** Check if a minimum interval has passed since the last agent run. */
export async function shouldSkipDueToConcurrency(env: Env): Promise<boolean> {
  const value = await metaGet(env, META.lastRun)
  if (!value) return false
  return (Date.now() - new Date(value).getTime()) < CONFIG.agent.concurrencyGuardMs
}

/** Persist the current timestamp as the last COMPLETED agent run（供 checkSystemState 计划阶段）。 */
export async function markAgentRun(env: Env): Promise<void> {
  await metaSet(env, META.lastRun, new Date().toISOString())
}

// ─── 运行锁：防止并发 run（与 last_run 解耦）───
// 之前用"运行开始写 last_run"做锁，导致 checkSystemState 读到 secondsSinceLastRun≈0，
// planPhases 永远只跑 analyzeNewArticles+flagLowQualityAnalyses，digest/叙事/简报等阶段全部被跳过。
const LOCK_STALE_MS = 30 * 60_000 // 残留锁（isolate 被平台掐断）超过 30 分钟视为过期

/** 获取运行锁；已占用或残留锁未过期时返回 false。 */
export async function acquireAgentLock(env: Env): Promise<boolean> {
  try {
    const value = await metaGet(env, META.running)
    if (value != null) {
      const ts = Number(value)
      if (!Number.isNaN(ts) && Date.now() - ts < LOCK_STALE_MS) return false
    }
    await metaSet(env, META.running, String(Date.now()))
    return true
  } catch (e: any) {
    // fail-open：DB 抖动时放行，但必须留下日志，否则并发 run 悄悄叠着跑
    console.error('[agent] acquireAgentLock failed (fail-open, allowing run):', e?.message || e)
    return true
  }
}

/** 释放运行锁。 */
export async function releaseAgentLock(env: Env): Promise<void> {
  try { await metaDelete(env, META.running) } catch {}
}

/** Save a structured agent run log. */
export async function saveAgentLog(env: Env, log: AgentRunLog): Promise<void> {
  await metaSetJSON(env, META.lastLog, log)
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
 * 之前用 wall-clock（Date.now）作 CPU 代理——但 AI 阶段大多是 I/O 等待（等 DeepSeek 返回），
 * 墙钟≠CPU：analyzeNewArticles 一次 56s 墙钟就把 25s 预算烧光，outlooks/research/
 * controversy 等低优先级阶段每轮都被跳过。改为测自 initBudget 以来的真实 CPU 增量。
 */
const BUDGET_SAFE_CPU_MS = 25_000     // 真实 CPU 上限（对 30s 限制保持保守余量；I/O 等待不再计入）
const BUDGET_SAFE_WALL_MS = 240_000   // 拿不到 process.cpuUsage 时的墙钟兜底（上限放宽，I/O 等待不误伤）

let _budgetStartWall = 0
let _budgetStartCpu: CpuUsageLike | null = null
let _budgetExhausted = false

/** nodejs_compat 下 process.cpuUsage 的返回结构（Worker 类型不含 process，经 globalThis 防御性访问）。 */
interface CpuUsageLike { user: number; system: number }

function readCpu(): CpuUsageLike | null {
  try {
    const cpuUsage = (globalThis as { process?: { cpuUsage?: () => CpuUsageLike } }).process?.cpuUsage
    return typeof cpuUsage === 'function' ? cpuUsage() : null
  } catch { return null }
}

/** 自 initBudget 以来的真实 CPU 增量（毫秒）。手工算差值，兼容不支持 previousValue 参数的实现。 */
function cpuDeltaMs(): number | null {
  if (!_budgetStartCpu) return null
  const now = readCpu()
  if (!now) return null
  return ((now.user + now.system) - (_budgetStartCpu.user + _budgetStartCpu.system)) / 1000
}

/** Initialize the CPU budget counter. Call at the start of runAgent. */
export function initBudget(): void {
  _budgetStartWall = Date.now()
  _budgetStartCpu = readCpu()
  _budgetExhausted = false
}

/** Check if we've exceeded our safe CPU budget. */
export function isBudgetExhausted(): boolean {
  return _budgetExhausted
}

/** Log current budget status and return true if we're still ok. */
export function checkBudget(): boolean {
  if (_budgetExhausted) return false
  const elapsedCpu = cpuDeltaMs()
  const elapsedWall = Date.now() - _budgetStartWall
  // 优先用真实 CPU；只有拿不到 cpuUsage（非 nodejs_compat 环境）才退回墙钟
  const over = elapsedCpu !== null ? elapsedCpu >= BUDGET_SAFE_CPU_MS : elapsedWall >= BUDGET_SAFE_WALL_MS
  if (over) {
    _budgetExhausted = true
    console.warn(`[agent] CPU budget exceeded (${Math.round(elapsedCpu ?? elapsedWall)}ms cpu / ${elapsedWall}ms wall) — skipping low-priority phases`)
    return false
  }
  return true
}
