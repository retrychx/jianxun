/**
 * Agent Memory — 跨运行状态管理
 * 让 agent 记住上次学到了什么，而不是每次从零开始。
 */
import type { Env } from '../helpers.js'
import type { AgentMemory, SignalSummary } from './types.js'
import { CONFIG } from './config.js'

const MEMORY_KEY = 'agent_memory'

/** 从 DB 加载上次记忆 */
export async function loadMemory(env: Env): Promise<AgentMemory> {
  try {
    const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = ?").bind(MEMORY_KEY).first<any>()
    if (row?.value) return JSON.parse(row.value)
  } catch {}
  return { sourceMemory: {}, entityHeat: {}, categoryConfidence: {}, lastRunAt: '', totalAnalyses: 0 }
}

/** 持久化记忆 */
export async function saveMemory(env: Env, mem: AgentMemory): Promise<void> {
  const now = new Date().toISOString()
  mem.lastRunAt = now
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)").bind(MEMORY_KEY, JSON.stringify(mem)).run()
  } catch {}
}

/** 消费用户信号 → 计算来源点击率、实体热度、学习阈值 */
export async function ingestSignals(env: Env, sinceMinutes = 1440): Promise<SignalSummary> {
  const since = new Date(Date.now() - sinceMinutes * 60000).toISOString()

  // 来源级 CTR
  const ctrRows = await env.DB.prepare(`
    SELECT n.source,
      COUNT(*) as total,
      COALESCE(SUM(n.click_count), 0) as clicks
    FROM news n
    WHERE n.created_at >= datetime('now', '-7 days')
    GROUP BY n.source
  `).all<any>()
  const sourceCTR = new Map<string, { total: number; clicks: number; rate: number }>()
  for (const r of (ctrRows.results || [])) {
    const total = r.total || 0
    const clicks = r.clicks || 0
    sourceCTR.set(r.source, { total, clicks, rate: total > 0 ? clicks / total : 0 })
  }

  // 实体级热度（从 signals 表读用户点击）
  const entityRows = await env.DB.prepare(`
    SELECT target_id, COUNT(*) as cnt
    FROM signals
    WHERE target_type = 'entity' AND created_at >= ?
    GROUP BY target_id ORDER BY cnt DESC LIMIT 30
  `).bind(since).all<any>()
  const entityClicks = new Map<string, number>()
  for (const r of (entityRows.results || [])) entityClicks.set(r.target_id, r.cnt || 0)

  return { sourceCTR, entityClicks, categoryEngagement: new Map() }
}

/** 在线学习：根据分析结果动态调整匹配阈值 */
export function learnThreshold(memory: AgentMemory, matchSuccess: boolean): number {
  const currentThreshold = CONFIG.narrative.matchThreshold
  if (!memory.sourceMemory['_threshold']) {
    (memory.sourceMemory as any)['_threshold'] = { ctr: currentThreshold, qualityScore: 1.0, totalAnalyses: 0, failedAnalyses: 0 }
  }
  const t = memory.sourceMemory['_threshold']
  t.totalAnalyses++
  // 如果匹配成功率高，阈值可以微降（召回更多）；失败率高则微升（精确性优先）
  if (matchSuccess) {
    t.ctr = Math.max(0.15, t.ctr - 0.01)
  } else {
    t.ctr = Math.min(0.6, t.ctr + 0.02)
  }
  return t.ctr
}

/** 在线学习：根据用户点击更新实体热度，影响未来分析优先级 */
export function learnEntityPopularity(memory: AgentMemory, entityName: string): void {
  const key = entityName.toLowerCase()
  const existing = memory.entityHeat[key]
  if (existing) {
    existing.clicks++
    existing.lastSeen = new Date().toISOString()
  } else {
    memory.entityHeat[key] = { clicks: 1, lastSeen: new Date().toISOString() }
  }
}

/** 获取热门实体列表（用于分析优先级排序） */
export function getHotEntities(memory: AgentMemory, minClicks = 2): string[] {
  return Object.entries(memory.entityHeat)
    .filter(([, v]) => v.clicks >= minClicks)
    .sort(([, a], [, b]) => b.clicks - a.clicks)
    .slice(0, 10)
    .map(([k]) => k)
}

/** 根据信号计算自适应权重 */
export function computeAdaptiveBoost(signals: SignalSummary, source: string, entityNames: string[]): number {
  let boost = 0
  // 来源点击率加成
  const srcSig = signals.sourceCTR.get(source)
  if (srcSig) {
    if (srcSig.rate > 0.3) boost += 0.15
    else if (srcSig.rate < 0.02) boost -= 0.1
  }
  // 实体热度加成
  for (const name of entityNames) {
    const clicks = signals.entityClicks.get(name.toLowerCase()) || 0
    if (clicks > 5) boost += 0.2
    else if (clicks > 2) boost += 0.1
  }
  return Math.max(-0.3, Math.min(0.5, boost))
}
