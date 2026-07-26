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
import { shouldSkipDueToConcurrency, markAgentRun, saveAgentLog, pingDeepSeek } from './state.js'
import { CONFIG } from './config.js'
import { fixMissingImages, tuneSourceWeights } from './health.js'
import { analyzeNewArticles, refineCategories } from './analyze.js'
import { translateMissing } from './translate.js'
import { runCrossRefAnalysis } from './crossref.js'
import { updateNarratives } from './narrative.js'
import { detectBreakingNews } from './breaking.js'
import { linkEntities } from './entity.js'
import { generateTodayDigest } from '../digest.js'

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  if (!env.DEEPSEEK_API_KEY) return

  // Concurrency guard
  if (await shouldSkipDueToConcurrency(env)) return

  // Circuit breaker
  const apiOk = await pingDeepSeek(env.DEEPSEEK_API_KEY)

  const phases: PhaseDef[] = [
    // Group 1: No dependencies (parallel)
    { name: 'fixMissingImages', run: () => fixMissingImages(env) },
    { name: 'analyzeNewArticles', run: () => analyzeNewArticles(env), timeout: CONFIG.analyze.phaseTimeoutMs, shouldSkip: !apiOk },
    { name: 'refineCategories', run: () => refineCategories(env), shouldSkip: !apiOk },
    { name: 'translateMissing', run: () => translateMissing(env), shouldSkip: !apiOk },
    { name: 'tuneSourceWeights', run: () => tuneSourceWeights(env) },

    // Group 2: Need analysis results first
    { name: 'crossRefAnalysis', run: () => runCrossRefAnalysis(env), dependsOn: ['analyzeNewArticles'], shouldSkip: !apiOk },
    { name: 'generateDailyDigest', run: () => generateTodayDigest(env) },
    { name: 'updateNarratives', run: () => updateNarratives(env) },
    { name: 'detectBreakingNews', run: () => detectBreakingNews(env), timeout: CONFIG.breaking.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'] },
    { name: 'linkEntities', run: () => linkEntities(env), timeout: CONFIG.entity.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'] },
  ]

  const results = await runPhases(phases, env)
  const totalMs = Date.now() - start

  await markAgentRun(env)
  await saveAgentLog(env, { ts: new Date().toISOString(), totalMs, skipAi: !apiOk, results })
}

// Re-export all phase functions for admin endpoints
export { fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights }
export { loadActiveNarratives, loadSingleNarrative } from './narrative.js'
