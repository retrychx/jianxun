/**
 * News Intelligence Agent — unified AI processing pipeline.
 *
 * Orchestrates 10 phases as a single ctx.waitUntil task after each fetchNews().
 * Each phase is also exported individually for standalone admin endpoints.
 */

import type { ExecutionContext } from '@cloudflare/workers-types'
import { signalEvent } from '../cache.js'
import { pingDeepSeek, runPhase, setLastAgentRun } from './utils.js'
import { fixMissingImages, tuneSourceWeights } from './health.js'
import { analyzeNewArticles, refineCategories } from './analyze.js'
import { translateMissing } from './translate.js'
import { runCrossRefAnalysis } from './crossref.js'
import { updateNarratives } from './narrative.js'
import { detectBreakingNews } from './breaking.js'
import { linkEntities } from './entity.js'
import { generateTodayDigest } from '../digest.js'
import type { Env } from '../helpers.js'

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return

  // Concurrency guard
  const lastRun = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
  if (lastRun?.value && (Date.now() - new Date(lastRun.value).getTime()) < 300_000) return

  // Circuit breaker
  const apiOk = await pingDeepSeek(apiKey ?? '')
  const skipAi = !apiOk

  const results: Record<string, any> = {}

  // ── Group 1: independent phases ──
  const [r1, r2, r3, r4, r10] = await Promise.allSettled([
    runPhase('fixMissingImages', () => fixMissingImages(env)),
    skipAi ? Promise.resolve({ ok: true, result: 0, ms: 0 }) : runPhase('analyzeNewArticles', () => analyzeNewArticles(env), 45_000),
    skipAi ? Promise.resolve({ ok: true, result: { refined: 0 }, ms: 0 }) : runPhase('refineCategories', () => refineCategories(env), 30_000),
    skipAi ? Promise.resolve({ ok: true, result: { translated: 0 }, ms: 0 }) : runPhase('translateMissing', () => translateMissing(env), 30_000),
    runPhase('tuneSourceWeights', () => tuneSourceWeights(env), 10_000),
  ])
  for (const [key, r] of [['fixMissingImages', r1], ['analyzeNewArticles', r2], ['refineCategories', r3], ['translateMissing', r4], ['tuneSourceWeights', r10]] as const) {
    results[key] = r.status === 'fulfilled' ? r.value : { ok: false, error: 'Promise rejected', ms: 0 }
  }

  // ── Group 2: depend on analyzeNewArticles ──
  const analysisDone = r2.status === 'fulfilled' && r2.value?.ok !== false

  const [r5, r6, r7, r8, r9] = await Promise.allSettled([
    analysisDone && !skipAi ? runPhase('crossRefAnalysis', () => runCrossRefAnalysis(env), 30_000) : Promise.resolve({ ok: true, result: { crossRefs: 0 }, ms: 0 }),
    runPhase('generateDailyDigest', () => generateTodayDigest(env), 30_000),
    runPhase('updateNarratives', () => updateNarratives(env), 30_000),
    analysisDone ? runPhase('detectBreakingNews', () => detectBreakingNews(env), 15_000) : Promise.resolve({ ok: true, result: { breaking: 0 }, ms: 0 }),
    analysisDone ? runPhase('linkEntities', () => linkEntities(env), 15_000) : Promise.resolve({ ok: true, result: { linked: 0 }, ms: 0 }),
  ])
  for (const [key, r] of [['crossRefAnalysis', r5], ['generateDailyDigest', r6], ['updateNarratives', r7], ['detectBreakingNews', r8], ['linkEntities', r9]] as const) {
    results[key] = r.status === 'fulfilled' ? r.value : { ok: false, error: 'Promise rejected', ms: 0 }
  }

  // Record agent run log
  try {
    await setLastAgentRun(env)
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_log', ?)")
      .bind(JSON.stringify({ ts: new Date().toISOString(), totalMs: Date.now() - start, skipAi, results })).run()
  } catch {}
}

// Re-export phase functions for admin endpoints
export { fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights }
export { loadActiveNarratives, loadSingleNarrative } from './narrative.js'
