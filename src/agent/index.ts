/**
 * News Intelligence Agent — unified AI processing pipeline.
 *
 * Orchestrates 10 phases as a single ctx.waitUntil task after each fetchNews().
 * Uses the scheduler for dependency-based parallel execution, config for thresholds,
 * and structured state management.
 */

import type { ExecutionContext } from '@cloudflare/workers-types'
import type { Env } from '../helpers.js'
import type { PhaseDef } from './types.js'
import { runPhases } from './scheduler.js'
import { shouldSkipDueToConcurrency, markAgentRun, saveAgentLog, pingDeepSeek, initBudget } from './state.js'
import { CONFIG } from './config.js'
import { fixMissingImages, tuneSourceWeights } from './health.js'
import { analyzeNewArticles, refineCategories } from './analyze.js'
import { translateMissing } from './translate.js'
import { runCrossRefAnalysis } from './crossref.js'
import { updateNarratives } from './narrative.js'
import { detectBreakingNews } from './breaking.js'
import { curateBriefing } from './curate.js'
import { linkEntities } from './entity.js'
import { generateTodayDigest } from '../api/digest.js'

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  if (!env.DEEPSEEK_API_KEY) return

  // Concurrency guard
  if (await shouldSkipDueToConcurrency(env)) return

  // Initialize CPU budget tracking
  initBudget()

  // Circuit breaker
  const apiOk = await pingDeepSeek(env.DEEPSEEK_API_KEY)

  const phases: PhaseDef[] = [
    // ═══ Critical — must run every cycle ═══
    { name: 'fixMissingImages', run: () => fixMissingImages(env), priority: 'critical' },
    { name: 'analyzeNewArticles', run: () => analyzeNewArticles(env), timeout: CONFIG.analyze.phaseTimeoutMs, shouldSkip: !apiOk, priority: 'critical' },
    { name: 'generateDailyDigest', run: () => generateTodayDigest(env), priority: 'critical' },
    { name: 'updateNarratives', run: () => updateNarratives(env), priority: 'critical' },

    // ═══ Normal — run when CPU allows ═══
    { name: 'refineCategories', run: () => refineCategories(env), shouldSkip: !apiOk },
    { name: 'translateMissing', run: () => translateMissing(env), shouldSkip: !apiOk },
    { name: 'crossRefAnalysis', run: () => runCrossRefAnalysis(env), dependsOn: ['analyzeNewArticles'], shouldSkip: !apiOk },
    { name: 'detectBreakingNews', run: () => detectBreakingNews(env), timeout: CONFIG.breaking.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'] },
    { name: 'tuneSourceWeights', run: () => tuneSourceWeights(env) },

    // ═══ Low priority — skipped when CPU budget tight ═══
    { name: 'linkEntities', run: () => linkEntities(env), timeout: CONFIG.entity.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], priority: 'low' },
  ]

  const results = await runPhases(phases, env)
  // Phase 11: Curate briefing (runs after analysis-dependent phases)
  results.curateBriefing = await runPhases([{ name: 'curateBriefing', run: () => curateBriefing(env), dependsOn: ['detectBreakingNews', 'updateNarratives', 'crossRefAnalysis'], priority: 'low' }], env)
  const totalMs = Date.now() - start

  await markAgentRun(env)
  await saveAgentLog(env, { ts: new Date().toISOString(), totalMs, skipAi: !apiOk, results })
}

// Re-export all phase functions for admin endpoints
export { fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights, curateBriefing }
export { loadActiveNarratives, loadSingleNarrative } from './narrative.js'
