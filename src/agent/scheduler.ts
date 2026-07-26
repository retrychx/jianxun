/**
 * Phase scheduler — registers tool definitions, resolves dependency order,
 * runs independent phases in parallel, collects results with structured logging.
 */

import type { Env } from '../helpers.js'
import type { PhaseDef, PhaseResult, AgentRunLog } from './types.js'
import { phaseTimeout } from './config.js'

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
    console.log(\`[agent] \${name} ok \${ms}ms\`)
    return { ok: true, result, ms }
  } catch (err: any) {
    const ms = Date.now() - start
    const msg = err?.message || err?.toString() || 'unknown error'
    console.error(\`[agent] \${name} FAIL \${ms}ms: \${msg.slice(0, 200)}\`)
    return { ok: false, error: msg.slice(0, 200), ms }
  }
}

/**
 * Execute a list of phase definitions with dependency resolution.
 * - Phases without dependencies (or whose dependencies completed) run in parallel.
 * - Phases with \`shouldSkip: true\` are skipped (recorded as ok with zero result).
 * - Collects all results into a flat map keyed by phase name.
 */
export async function runPhases(phases: PhaseDef[], env: Env): Promise<Record<string, PhaseResult>> {
  const results: Record<string, PhaseResult> = {}

  // Group phases by dependency depth
  const completed = new Set<string>()

  // Repeatedly run phases whose dependencies are satisfied
  while (completed.size < phases.length) {
    const batch = phases.filter(p =>
      !results[p.name] && // not started
      (!p.dependsOn || p.dependsOn.every(d => completed.has(d))) // deps done
    )
    if (!batch.length) break // stuck — probably a dependency cycle

    const outcomes = await Promise.allSettled(
      batch.map(p =>
        p.shouldSkip
          ? Promise.resolve({ ok: true, result: undefined, ms: 0 } as PhaseResult)
          : runOne(p.name, () => p.run(env), p.timeout ?? phaseTimeout(p.name))
      )
    )

    for (let i = 0; i < batch.length; i++) {
      const p = batch[i]
      const o = outcomes[i]
      const r = o.status === 'fulfilled' ? o.value : { ok: false, error: 'Promise rejected', ms: 0 }
      results[p.name] = r
      if (r.ok || p.shouldSkip) completed.add(p.name)
    }
  }

  return results
}
