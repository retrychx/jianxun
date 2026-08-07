/**
 * Phase scheduler — registers tool definitions, resolves dependency order,
 * runs independent phases in parallel, collects results with structured logging.
 * Respects CPU budget: low-priority phases are skipped when time is tight.
 */

import type { Env } from '../helpers.js'
import type { PhaseDef, PhaseResult } from './types.js'
import { phaseTimeout } from './config.js'
import { checkBudget, isBudgetExhausted } from './state.js'

/** Success/failure from a single phase run with timing. */
async function runOne(name: string, fn: () => Promise<any>, timeoutMs: number): Promise<PhaseResult> {
  const start = Date.now()
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
    const ms = Date.now() - start
    console.log(`[agent] ${name} ok ${ms}ms`)
    return { ok: true, result, ms }
  } catch (err: any) {
    const ms = Date.now() - start
    const msg = err?.message || err?.toString() || 'unknown error'
    console.error(`[agent] ${name} FAIL ${ms}ms: ${msg.slice(0, 200)}`)
    return { ok: false, error: msg.slice(0, 200), ms }
  }
}

/**
 * Execute a list of phase definitions with dependency resolution.
 * - Phases with priority 'critical' always run.
 * - Phases with priority 'low' skip when the CPU budget is exhausted.
 * - Other phases run in dependency order, grouping independent ones in parallel.
 * - Phases with `shouldSkip: true` are skipped (recorded as ok with zero result).
 */
export async function runPhases(phases: PhaseDef[], env: Env): Promise<Record<string, PhaseResult>> {
  const results: Record<string, PhaseResult> = {}
  const completed = new Set<string>()

  while (completed.size < phases.length) {
    // Filter to phases whose dependencies are met AND haven't started
    const batch = phases.filter(p => {
      if (results[p.name]) return false
      // Skip low-priority phases when budget exhausted
      if (p.priority === 'low' && isBudgetExhausted()) {
        console.log(`[agent] skipping low-priority phase: ${p.name}`)
        results[p.name] = { ok: true, result: undefined, ms: 0 }
        completed.add(p.name)
        return false
      }
      // Check dependencies
      return !p.dependsOn || p.dependsOn.every(d => completed.has(d))
    })
    if (!batch.length) break

    const outcomes = await Promise.allSettled(
      batch.map(p =>
        p.shouldSkip
          ? Promise.resolve({ ok: true, result: undefined, ms: 0 } as PhaseResult)
          : runOne(p.name, () => p.run(env), p.timeout ?? phaseTimeout(p.name))
      )
    )

    for (let i = 0; i < batch.length; i++) {
      const o = outcomes[i]
      const r = o.status === 'fulfilled' ? o.value : { ok: false, error: 'Promise rejected', ms: 0 }
      results[batch[i].name] = r
      if (r.ok || batch[i].shouldSkip) completed.add(batch[i].name)
      // Update budget after each phase
      checkBudget()
    }
  }

  return results
}
