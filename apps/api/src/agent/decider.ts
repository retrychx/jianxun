/**
 * Agent Decision Engine — 自主决定跑哪些阶段、跑多久、怎么跑。
 *
 * 取代静态 phase 列表，改为根据当前系统状态动态调度。
 */

import type { Env } from '../helpers.js'
import type { PhaseDef, PhaseSchedule } from './types.js'
import { META, metaGet } from '../db.js'

export interface SystemState {
  /** 是否有未处理的用户信号 */
  pendingSignals: number
  /** 最后运行距今秒数 */
  secondsSinceLastRun: number
  /** API 是否可用 */
  apiOk: boolean
}

/** 检查系统状态 */
export async function checkSystemState(env: Env): Promise<SystemState> {
  const [pendingSignals, lastRun] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM signals WHERE created_at >= datetime('now','-1 hour')").first<any>(),
    metaGet(env, META.lastRun),
  ])

  const now = Date.now()
  let secondsSinceLastRun = 99999
  if (lastRun) {
    try { secondsSinceLastRun = Math.round((now - new Date(lastRun).getTime()) / 1000) } catch {}
  }

  return {
    pendingSignals: pendingSignals?.c || 0,
    secondsSinceLastRun,
    apiOk: true, // 由调用方设置
  }
}

/** 按调度元数据过滤阶段——单一事实源是 PhaseDef.schedule（见 types.ts），不再手写名字列表 */
function bySchedule(basePhases: PhaseDef[], schedule: PhaseSchedule): PhaseDef[] {
  return basePhases.filter(p => (p.schedule || 'always') === schedule)
}

/** 根据系统状态决定本周期跑哪些阶段 */
export function planPhases(state: SystemState, basePhases: PhaseDef[]): PhaseDef[] {
  if (state.secondsSinceLastRun < 120) {
    // 2 分钟内刚跑过 → 只跑最关键：分析 + critical 级 always 阶段。
    // generateDailyDigest 内部按北京日期去重，重复调用会短路返回 'exists'，不会重复烧钱。
    return basePhases.filter(p => p.schedule === 'analysis' || (p.schedule === 'always' && p.priority === 'critical'))
  }

  // 完整周期：always → analysis → narrative → postAnalysis（依赖分析的阶段放最后）。
  // 分析阶段无论有没有待分析文章都跑（内部自己查 DB）——之前 pendingArticles>0 的条件
  // 曾导致新文章来了但 agent 不分析。
  const planned: PhaseDef[] = [
    ...bySchedule(basePhases, 'always'),
    ...bySchedule(basePhases, 'analysis'),
    ...bySchedule(basePhases, 'narrative'),
    ...bySchedule(basePhases, 'postAnalysis'),
  ]

  // 有信号或间隔久 → 学习/补齐阶段（来源权重、分类、翻译）
  if (state.pendingSignals > 0 || state.secondsSinceLastRun > 3600) {
    planned.push(...bySchedule(basePhases, 'onSignals'))
  }

  // 低优先级研究简报等（schedule='budget'）：完整周期一律纳入并标记 low 优先级，
  // 真正是否跑由 scheduler 的 checkBudget（真实 CPU 25s 上限）在运行时逐阶段跳过——
  // 不再用假的 remainingBudget 门槛（此前恒 60s 导致门槛从未真正生效）。
  // 注意：schedule 组互斥，always 组已含简报/日报，绝不重复加入。
  planned.push(...bySchedule(basePhases, 'budget').map(p => ({ ...p, priority: 'low' as const })))

  return planned
}
