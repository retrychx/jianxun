/**
 * Phase scheduler — registers tool definitions, resolves dependency order,
 * runs independent phases in parallel, collects results with structured logging.
 * Respects CPU budget: low-priority phases are skipped when time is tight.
 */

import type { Env } from '../helpers.js'
import type { PhaseDef, PhasePriority, PhaseResult } from './types.js'
import { phaseTimeout } from './config.js'
import { checkBudget, isBudgetExhausted, subrequestBudgetExhausted } from './state.js'

/** Success/failure from a single phase run with timing. */
async function runOne(name: string, fn: (signal: AbortSignal) => Promise<any>, timeoutMs: number): Promise<PhaseResult> {
  const start = Date.now()
  // 阶段级 AbortController：超时即 abort，让 in-flight 的 DeepSeek/fetch 请求真正停下来
  // （此前只用 Promise.race + setTimeout，超时后底层工作仍在后台跑，白耗 CPU 与配额）。
  const ac = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      fn(ac.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort()
          reject(new Error(`Timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
    if (timer) clearTimeout(timer)
    const ms = Date.now() - start
    console.log(`[agent] ${name} ok ${ms}ms`)
    return { ok: true, result, ms }
  } catch (err: any) {
    if (timer) clearTimeout(timer)
    const ms = Date.now() - start
    const msg = err?.message || err?.toString() || 'unknown error'
    console.error(`[agent] ${name} FAIL ${ms}ms: ${msg.slice(0, 200)}`)
    return { ok: false, error: msg.slice(0, 200), ms }
  }
}

// 优先级排序：critical（analyze/日报/叙事）→ normal → low。
// 同一批里 Promise.allSettled 会让所有 AI 阶段同时开枪抢 subrequest 预算，
// crossRef/translate 等 normal 阶段可能把日报/叙事该拿的额度抢走 —— 必须先跑 critical。
const PRIORITY_RANK: Record<PhasePriority, number> = { critical: 0, normal: 1, low: 2 }

/** 同批内 AI 阶段的并发上限：critical 先启动拿预算，同时避免 8 路并发把预算瞬间顶穿 */
const BATCH_CONCURRENCY = 2

/**
 * Execute a list of phase definitions with dependency resolution.
 * - Phases with priority 'critical' always run (analyze/日报/叙事拿预算的优先级最高).
 * - Phases with priority 'low' skip when the CPU/subrequest budget is exhausted.
 * - Within a dependency batch, phases run in priority order with bounded concurrency:
 *   critical phases claim the subrequest budget first; normal/low ones either take
 *   whatever's left or skip (预算留给 critical，避免免费版 50 subrequest 硬上限被烧穿).
 * - Phases with `shouldSkip: true` are skipped (recorded as ok with zero result).
 */
export async function runPhases(phases: PhaseDef[], env: Env): Promise<Record<string, PhaseResult>> {
  const results: Record<string, PhaseResult> = {}
  const completed = new Set<string>()

  while (completed.size < phases.length) {
    // Filter to phases whose dependencies are met AND haven't started
    const batch = phases.filter(p => {
      if (results[p.name]) return false
      return !p.dependsOn || p.dependsOn.every(d => completed.has(d))
    })
    if (!batch.length) break

    // 同批内按优先级排序（critical 在前），再限并发跑 —— 保证日报/叙事先拿到 subrequest 预算
    const ordered = [...batch].sort((a, b) =>
      (PRIORITY_RANK[a.priority ?? 'normal'] ?? 1) - (PRIORITY_RANK[b.priority ?? 'normal'] ?? 1)
    )

    const workerCount = Math.min(BATCH_CONCURRENCY, ordered.length)
    const queue = [...ordered]
    const outcomes = await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length) {
          const p = queue.shift()!
          // Skip low-priority phases when budget exhausted (CPU or subrequest).
          // 免费版 50 外部 subrequest/调用是硬上限：CPU 还有余量但 subrequest 烧光时，
          // 继续跑低优先级 AI 阶段只会让它们的 DeepSeek 调用被平台拒绝（静默返回 null），
          // 白白浪费窗口 —— 预算要优先留给 critical 阶段（analyze/日报/叙事）。
          if (p.priority === 'low' && (isBudgetExhausted() || subrequestBudgetExhausted())) {
            console.log(`[agent] skipping low-priority phase: ${p.name} (cpu=${isBudgetExhausted()} subreq=${subrequestBudgetExhausted()})`)
            results[p.name] = { ok: true, result: undefined, ms: 0 }
            completed.add(p.name)
            continue
          }
          const r = p.shouldSkip
            ? { ok: true, result: undefined, ms: 0 } as PhaseResult
            : await runOne(p.name, (signal) => p.run(env, signal), p.timeout ?? phaseTimeout(p.name))
          results[p.name] = r
          if (r.ok || p.shouldSkip) completed.add(p.name)
          // Update budget after each phase
          checkBudget()
        }
      }),
    )
  }

  return results
}
