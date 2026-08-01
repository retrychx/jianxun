/**
 * Agent Decision Engine — 自主决定跑哪些阶段、跑多久、怎么跑。
 *
 * 取代静态 phase 列表，改为根据当前系统状态动态调度。
 */

import type { Env } from '../helpers.js'
import type { PhaseDef } from './types.js'
import { CONFIG } from './config.js'

export interface SystemState {
  /** 是否有新文章待分析 */
  pendingArticles: number
  /** 是否有未处理的用户信号 */
  pendingSignals: number
  /** 是否有活跃的叙事 */
  activeNarratives: number
  /** 最后运行距今秒数 */
  secondsSinceLastRun: number
  /** API 是否可用 */
  apiOk: boolean
  /** 预计剩余 CPU 时间（ms） */
  remainingBudget: number
}

/** 检查系统状态 */
export async function checkSystemState(env: Env): Promise<SystemState> {
  const [pendingArticles, pendingSignals, activeNarratives, lastRun] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= datetime('now','-2 days')").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM signals WHERE created_at >= datetime('now','-1 hour')").first<any>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM narratives WHERE status='active'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key='last_run'").first<any>(),
  ])

  const now = Date.now()
  let secondsSinceLastRun = 99999
  if (lastRun?.value) {
    try { secondsSinceLastRun = Math.round((now - new Date(lastRun.value).getTime()) / 1000) } catch {}
  }

  return {
    pendingArticles: pendingArticles?.c || 0,
    pendingSignals: pendingSignals?.c || 0,
    activeNarratives: activeNarratives?.c || 0,
    secondsSinceLastRun,
    apiOk: true, // 由调用方设置
    remainingBudget: 60_000, // 默认 60s 预算
  }
}

/** 根据系统状态决定本周期跑哪些阶段 */
export function planPhases(state: SystemState, basePhases: PhaseDef[]): PhaseDef[] {
  if (state.secondsSinceLastRun < 120) {
    // 2 分钟内刚跑过 → 只跑最关键的
    return basePhases.filter(p => p.name === 'analyzeNewArticles' || p.name === 'flagLowQualityAnalyses')
  }

  const planned: PhaseDef[] = []

  // 总是跑的阶段（含简报和日报——最可见的输出，不应被预算跳过）
  const always: string[] = ['flagLowQualityAnalyses', 'mergeOverlappingNarratives', 'fixMissingImages', 'curateBriefing', 'generateDailyDigest']
  for (const name of always) {
    const p = basePhases.find(b => b.name === name)
    if (p) planned.push(p)
  }

  // 分析阶段：无论有没有待分析文章都跑（内部自己查 DB）
  // 之前 pendingArticles > 0 条件导致新文章来了但 agent 不分析
  const analysis = basePhases.find(b => b.name === 'analyzeNewArticles')
  if (analysis) planned.push(analysis)
  const narrative = basePhases.find(b => b.name === 'updateNarratives')
  if (narrative) planned.push(narrative)
  for (const name of ['detectBreakingNews', 'crossRefAnalysis', 'linkEntities', 'detectControversy']) {
    const p = basePhases.find(b => b.name === name)
    if (p) planned.push(p)
  }

  // 有信号才跑学习阶段
  if (state.pendingSignals > 0 || state.secondsSinceLastRun > 3600) {
    for (const name of ['tuneSourceWeights', 'refineCategories', 'translateMissing']) {
      const p = basePhases.find(b => b.name === name)
      if (p) planned.push(p)
    }
  }

  // 低优先级阶段：只在预算充足时跑
  // 注意：curateBriefing / generateDailyDigest 已在 always 列表，绝不在此重复加入，
  // 否则同一周期会并发执行两份同名阶段（scheduler 按 name 去重只对已完成生效）。
  if (state.remainingBudget > 30_000) {
    for (const name of ['generateResearchBriefs']) {
      const p = basePhases.find(b => b.name === name)
      if (p) planned.push({ ...p, priority: 'low' })
    }
  }

  return planned
}

/** 自适应预算分配 */
export function allocateBudget(phaseCount: number, totalBudget: number): number {
  if (phaseCount <= 0) return totalBudget
  // 预留 20% 给意外延迟
  const perPhase = Math.floor((totalBudget * 0.8) / phaseCount)
  // 每个阶段至少 5s，最多 45s
  return Math.max(5_000, Math.min(45_000, perPhase))
}
