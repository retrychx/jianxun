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
import { checkSystemState, planPhases, allocateBudget } from './decider.js'
import { evaluateQuality, saveKPI, shouldExplore, getExperimentParams, saveExperiment, estimateAPICost, generateReport, saveReport } from './eval.js'
import { cacheDelete } from '../cache.js'

// 所有阶段的定义（作为模板供决策引擎选择）
const ALL_PHASES: PhaseDef[] = [
  { name: 'flagLowQualityAnalyses', run: (e: Env) => flagLowQualityAnalyses(e), priority: 'critical' },
  { name: 'mergeOverlappingNarratives', run: (e: Env) => mergeOverlappingNarratives(e), priority: 'critical' },
  { name: 'fixMissingImages', run: (e: Env) => fixMissingImages(e), priority: 'critical' },
  { name: 'analyzeNewArticles', run: (e: Env) => analyzeNewArticles(e, CONFIG.analyze.limitPerRun), timeout: CONFIG.analyze.phaseTimeoutMs, priority: 'critical' },
  { name: 'updateNarratives', run: (e: Env) => updateNarratives(e), priority: 'critical' },
  { name: 'generateDailyDigest', run: (e: Env) => generateTodayDigest(e), priority: 'critical' },
  { name: 'refineCategories', run: (e: Env) => refineCategories(e) },
  { name: 'translateMissing', run: (e: Env) => translateMissing(e) },
  { name: 'crossRefAnalysis', run: (e: Env) => runCrossRefAnalysis(e), dependsOn: ['analyzeNewArticles'] },
  { name: 'detectBreakingNews', run: (e: Env) => detectBreakingNews(e), timeout: CONFIG.breaking.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'] },
  { name: 'tuneSourceWeights', run: (e: Env) => tuneSourceWeights(e) },
  { name: 'linkEntities', run: (e: Env) => linkEntities(e), timeout: CONFIG.entity.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], priority: 'low' },
  { name: 'curateBriefing', run: (e: Env) => curateBriefing(e), dependsOn: ['detectBreakingNews', 'updateNarratives', 'crossRefAnalysis'], priority: 'low' },
  { name: 'detectControversy', run: (e: Env) => detectControversy(e), dependsOn: ['analyzeNewArticles'], priority: 'low' },
  { name: 'generateResearchBriefs', run: (e: Env) => generateResearchBriefs(e), dependsOn: ['updateNarratives'], priority: 'low' },
]

export async function runAgent(env: Env, ctx?: ExecutionContext) {
  const start = Date.now()
  if (!env.DEEPSEEK_API_KEY) return
  if (await shouldSkipDueToConcurrency(env)) return

  initBudget()
  // pingDeepSeek 仅用于日志，不影响任何阶段运行（各阶段自己有 API 重试）
  const apiOk = await pingDeepSeek(env.DEEPSEEK_API_KEY).catch(() => false)

  // ═══ Phase 0: 感知 + 决策 ═══
  const memory = await loadMemory(env)
  const state = await checkSystemState(env)
  state.apiOk = apiOk

  const signals = await ingestSignals(env)

  // 仅在系统状态满足条件时才运行的阶段
  // 注意：不根据 pingDeepSeek 跳过 analyzeNewArticles——它自己有重试逻辑
  const filteredPhases = ALL_PHASES.map(p => ({
    ...p,
    shouldSkip: p.shouldSkip ?? false,
  }))

  // 决策引擎选择本周期跑哪些阶段
  const phases = planPhases(state, filteredPhases)
  // 自适应预算分配
  const budget = allocateBudget(phases.length, state.remainingBudget)

  // 把动态超时应用到各阶段
  for (const p of phases) {
    if (!p.timeout) p.timeout = budget
  }

  const results = await runPhases(phases, env)
  const totalMs = Date.now() - start

  // ═══ Cache invalidation: agent 跑完后清相关缓存 ═══
  // 防止用户看到 agent 更新前的旧数据
  const CACHE_KEYS = ['trending', 'topics', 'categories', 'stats', 'sources', 'briefing', 'weekly']
  for (const key of CACHE_KEYS) cacheDelete(key).catch(() => {})

  // ═══ Self-Evaluation: 评估本轮分析质量 ═══
  const kpi = await evaluateQuality(env)
  kpi.totalMs = totalMs
  kpi.estimatedCost = estimateAPICost(kpi.articlesAnalyzed || 0 + 3) // +3 for narrative/breaking/curation calls
  // 从 phase results 中提取额外 KPI
  kpi.qualityFlags = (results as any)?.flagLowQualityAnalyses?.result || 0
  kpi.narrativesMerged = (results as any)?.mergeOverlappingNarratives?.result || 0
  kpi.briefingCount = (results as any)?.curateBriefing?.result?.briefing || 0

  await saveKPI(env, kpi)

  // ═══ Exploration: A/B 测试新策略 ═══
  if (shouldExplore(memory.totalAnalyses)) {
    const expParams = getExperimentParams(memory)
    await saveExperiment(env, memory, expParams, kpi)
  }

  // ═══ Agent Report: 生成人类可读的报告 ═══
  const report = generateReport(kpi, results)
  await saveReport(env, report)

  // ═══ Save memory for next run ═══
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
