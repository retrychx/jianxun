/**
 * News Intelligence Agent v2 — Learning pipeline with memory + quality.
 *
 * Architecture:
 *   Ingestion → Planning → Execution → Quality → Learning → Memory
 *
 * Unlike v1, this agent:
 *  - Reads user signals (clicks) and adapts priorities
 *  - Self-checks output quality and flags bad analyses
 *  - Learns across runs (source CTR, entity popularity)
 *  - Merges duplicate narratives
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
import { detectControversy } from './debate.js'
import { generateResearchBriefs } from './research.js'
import { linkEntities } from './entity.js'
import { generateTodayDigest } from '../api/digest.js'
import { loadMemory, saveMemory, ingestSignals } from './memory.js'
import { flagLowQualityAnalyses, mergeOverlappingNarratives } from './quality.js'

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  if (!env.DEEPSEEK_API_KEY) return
  if (await shouldSkipDueToConcurrency(env)) return

  initBudget()
  const apiOk = await pingDeepSeek(env.DEEPSEEK_API_KEY)

  // ═══ Phase 0: Load memory + ingest signals ═══
  const memory = await loadMemory(env)
  const signals = await ingestSignals(env)

  const phases: PhaseDef[] = [
    // ═══ Phase 1: Feedback ingestion — 优先处理用户信号 ═══
    { name: 'flagLowQualityAnalyses', run: () => flagLowQualityAnalyses(env), priority: 'critical' },
    { name: 'mergeOverlappingNarratives', run: () => mergeOverlappingNarratives(env), priority: 'critical' },
    { name: 'fixMissingImages', run: () => fixMissingImages(env), priority: 'critical' },

    // ═══ Phase 2: Analysis — 核心 AI 任务 ═══
    { name: 'analyzeNewArticles', run: () => analyzeNewArticles(env, CONFIG.analyze.limitPerRun), timeout: CONFIG.analyze.phaseTimeoutMs, shouldSkip: !apiOk, priority: 'critical' },
    { name: 'generateDailyDigest', run: () => generateTodayDigest(env), priority: 'critical' },
    { name: 'updateNarratives', run: () => updateNarratives(env), priority: 'critical' },

    // ═══ Phase 3: Enhancement — 提升已分析数据质量 ═══
    { name: 'refineCategories', run: () => refineCategories(env), shouldSkip: !apiOk },
    { name: 'translateMissing', run: () => translateMissing(env), shouldSkip: !apiOk },
    { name: 'crossRefAnalysis', run: () => runCrossRefAnalysis(env), dependsOn: ['analyzeNewArticles'], shouldSkip: !apiOk },
    { name: 'detectBreakingNews', run: () => detectBreakingNews(env), timeout: CONFIG.breaking.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'] },

    // ═══ Phase 4: Learning — 自适应调节 ═══
    { name: 'tuneSourceWeights', run: () => tuneSourceWeights(env) },
    { name: 'linkEntities', run: () => linkEntities(env), timeout: CONFIG.entity.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], priority: 'low' },

    // ═══ Phase 5: Intelligence — 高级推理 ═══
    { name: 'curateBriefing', run: () => curateBriefing(env), dependsOn: ['detectBreakingNews', 'updateNarratives', 'crossRefAnalysis'], priority: 'low' },
    { name: 'detectControversy', run: () => detectControversy(env), dependsOn: ['analyzeNewArticles'], priority: 'low' },
    { name: 'generateResearchBriefs', run: () => generateResearchBriefs(env), dependsOn: ['updateNarratives'], priority: 'low' },
  ]

  const results = await runPhases(phases, env)
  const totalMs = Date.now() - start

  // ═══ Save memory for next run — 持久化学习成果 ═══
  memory.totalAnalyses++
  for (const [source, sig] of signals.sourceCTR) {
    if (!memory.sourceMemory[source]) memory.sourceMemory[source] = { ctr: 0, qualityScore: 1.0, totalAnalyses: 0, failedAnalyses: 0 }
    memory.sourceMemory[source].ctr = sig.rate
    memory.sourceMemory[source].totalAnalyses++
  }
  await saveMemory(env, memory)

  await markAgentRun(env)
  await saveAgentLog(env, { ts: new Date().toISOString(), totalMs, skipAi: !apiOk, results })
}

// Re-export all phase functions for admin endpoints
export { fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights, curateBriefing, detectControversy, generateResearchBriefs }
export { loadActiveNarratives, loadSingleNarrative } from './narrative.js'
