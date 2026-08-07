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

import type { CtxLike, Env } from '../helpers.js'
import type { PhaseDef } from './types.js'
import { runPhases } from './scheduler.js'
import { shouldSkipDueToConcurrency, markAgentRun, saveAgentLog, pingDeepSeek, initBudget, acquireAgentLock, releaseAgentLock } from './state.js'
import { CONFIG, phaseTimeout } from './config.js'
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
import { checkSystemState, planPhases } from './decider.js'
import { evaluateQuality, saveKPI, estimateAPICost, generateReport, saveReport } from './eval.js'
import { getTokenCount, resetTokenCount, setAgentAbort } from '../analysis/deepseek.js'
import { cleanup, recordError } from './cleanup.js'
import { generateNarrativeOutlooks, extractTopEntityEvents } from './intel.js'
import { generateProductIdeas } from './ideas.js'
import { cacheDelete } from '../cache.js'

// 所有阶段的定义（作为模板供决策引擎选择）
// schedule 是调度元数据（单一事实源）——planPhases 据此决定是否纳入本轮，
// 不再手写名字列表，杜绝"加了阶段但忘了调度"的漏注册 bug。
const ALL_PHASES: PhaseDef[] = [
  { name: 'flagLowQualityAnalyses', run: (e: Env) => flagLowQualityAnalyses(e), priority: 'critical', schedule: 'always' },
  { name: 'mergeOverlappingNarratives', run: (e: Env) => mergeOverlappingNarratives(e), priority: 'critical', schedule: 'always' },
  { name: 'fixMissingImages', run: (e: Env) => fixMissingImages(e), priority: 'critical', schedule: 'always' },
  { name: 'analyzeNewArticles', run: (e: Env) => analyzeNewArticles(e, CONFIG.analyze.limitPerRun), timeout: CONFIG.analyze.phaseTimeoutMs, priority: 'critical', schedule: 'analysis' },
  { name: 'updateNarratives', run: (e: Env) => updateNarratives(e), timeout: CONFIG.narrative.phaseTimeoutMs, priority: 'critical', schedule: 'narrative' },
  { name: 'generateDailyDigest', run: (e: Env) => generateTodayDigest(e), timeout: CONFIG.digest.phaseTimeoutMs, priority: 'critical', schedule: 'always' },
  { name: 'refineCategories', run: (e: Env) => refineCategories(e), timeout: CONFIG.refine.phaseTimeoutMs, schedule: 'onSignals' },
  { name: 'translateMissing', run: (e: Env) => translateMissing(e), timeout: CONFIG.translate.phaseTimeoutMs, schedule: 'onSignals' },
  { name: 'crossRefAnalysis', run: (e: Env) => runCrossRefAnalysis(e), timeout: CONFIG.crossRef.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], schedule: 'postAnalysis' },
  { name: 'detectBreakingNews', run: (e: Env) => detectBreakingNews(e), timeout: CONFIG.breaking.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], schedule: 'postAnalysis' },
  { name: 'tuneSourceWeights', run: (e: Env) => tuneSourceWeights(e), timeout: CONFIG.health.phaseTimeoutMs, schedule: 'onSignals' },
  { name: 'linkEntities', run: (e: Env) => linkEntities(e), timeout: CONFIG.entity.phaseTimeoutMs, dependsOn: ['analyzeNewArticles'], priority: 'low', schedule: 'postAnalysis' },
  { name: 'curateBriefing', run: (e: Env) => curateBriefing(e), timeout: CONFIG.briefing.phaseTimeoutMs, dependsOn: ['detectBreakingNews', 'updateNarratives', 'crossRefAnalysis'], priority: 'low', schedule: 'always' },
  { name: 'detectControversy', run: (e: Env) => detectControversy(e), dependsOn: ['analyzeNewArticles'], priority: 'low', schedule: 'postAnalysis' },
  { name: 'generateResearchBriefs', run: (e: Env) => generateResearchBriefs(e), dependsOn: ['updateNarratives'], priority: 'low', schedule: 'budget' },
  { name: 'generateNarrativeOutlooks', run: (e: Env) => generateNarrativeOutlooks(e), dependsOn: ['updateNarratives'], priority: 'low', schedule: 'narrative' },
  { name: 'extractTopEntityEvents', run: (e: Env) => extractTopEntityEvents(e), dependsOn: ['analyzeNewArticles'], priority: 'low', schedule: 'postAnalysis' },
  { name: 'generateProductIdeas', run: (e: Env) => generateProductIdeas(e), priority: 'low', schedule: 'always' },
]

/** 供 decider 与测试使用 */
export { ALL_PHASES }

export async function runAgent(env: Env, _ctx?: CtxLike) {
  const start = Date.now()
  if (!env.DEEPSEEK_API_KEY) return
  if (await shouldSkipDueToConcurrency(env)) return

  // 运行锁：防止并发 run（cron 触发 + 管理端 POST 同时执行）。
  // 注意：last_run 只在运行完成时写——若在开始写，checkSystemState 会读到 secondsSinceLastRun≈0，
  // planPhases 永远只跑 analyze+flag，digest/叙事/简报/翻译等阶段全部被跳过（曾导致日报多日不更新）。
  if (!(await acquireAgentLock(env))) return

  // 管线可中断：若上一个 run 仍在 isolate 内运行（超过守卫窗口的极端情况），
  // 启动新 run 时中止其 in-flight DeepSeek 请求
  setAgentAbort(new AbortController())

  initBudget()
  resetTokenCount() // 每轮清空 DeepSeek token 统计
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

  // 每个阶段用其配置的超时（AI 调用大多是 I/O 等待，需要足够的 wall-clock）。
  // 之前用 allocateBudget 把所有阶段压到 5s 下限，导致 updateNarratives/translateMissing
  // 这类阶段经常跑不完就超时（线上 health 持续报 "Timed out after 5000ms"）。
  // CPU 总预算仍由 checkBudget 实时控制：低优先级阶段在接近上限时被跳过。
  for (const p of phases) {
    if (!p.timeout) p.timeout = phaseTimeout(p.name)
  }

  const results = await runPhases(phases, env)
  const totalMs = Date.now() - start

  // ═══ 记录失败阶段到错误日志 ═══
  for (const [name, r] of Object.entries(results)) {
    if (!r.ok && r.error) recordError(env, name, r.error).catch(() => {})
  }

  // ═══ 每 24 小时执行一次数据清理 ═══
  if (memory.totalAnalyses % 8 === 0) { // ~每天一次（8 × 3h）
    try { await cleanup(env) } catch {}
  }

  // ═══ Cache invalidation: agent 跑完后清相关缓存 ═══
  // 防止用户看到 agent 更新前的旧数据
  const CACHE_KEYS = ['trending', 'topics', 'categories', 'stats', 'sources', 'briefing', 'weekly', 'sectors', 'signals', 'narrative_heat', 'narratives_timeline', 'digest', 'digests', 'heat_entities', 'insights', 'product_ideas']
  for (const key of CACHE_KEYS) cacheDelete(key).catch(() => {})

  // ═══ Self-Evaluation: 评估本轮分析质量 ═══
  const kpi = await evaluateQuality(env)
  kpi.totalMs = totalMs
  kpi.totalTokens = getTokenCount()
  kpi.estimatedCost = estimateAPICost((kpi.articlesAnalyzed || 0) + 3, kpi.totalTokens) // +3 for narrative/breaking/curation calls
  // 从 phase results 中提取额外 KPI
  kpi.qualityFlags = (results as any)?.flagLowQualityAnalyses?.result || 0
  kpi.narrativesMerged = (results as any)?.mergeOverlappingNarratives?.result || 0
  kpi.briefingCount = (results as any)?.curateBriefing?.result?.briefing || 0
  kpi.narrativesMatched = (results as any)?.updateNarratives?.result?.matched || 0
  kpi.narrativesCreated = (results as any)?.updateNarratives?.result?.created || 0

  await saveKPI(env, kpi)

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
  // 学习反馈：实体点击热度 → memory.entityHeat → 下轮 analyzeNewArticles 优先分析
  for (const [name, clicks] of signals.entityClicks) {
    memory.entityHeat[name.toLowerCase()] = { clicks, lastSeen: new Date().toISOString() }
  }
  await saveMemory(env, memory)

  await markAgentRun(env) // 记录本次完成时间（供下轮 checkSystemState 计划阶段）
  await saveAgentLog(env, { ts: new Date().toISOString(), totalMs, skipAi: !apiOk, results })
  await releaseAgentLock(env)

  // 清理 agent 级中止信号（仅置空，不 abort 更新的 run）
  setAgentAbort(null)
}

// Re-export all phase functions for admin endpoints
export { fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights, curateBriefing, detectControversy, generateResearchBriefs }
export { loadActiveNarratives, loadSingleNarrative } from './narrative.js'
