/**
 * Agent Memory — 跨运行状态管理
 * 让 agent 记住上次学到了什么，而不是每次从零开始。
 */
import type { Env } from '../helpers.js'
import type { AgentMemory, SignalSummary } from './types.js'
import { META, metaGetJSON, metaSetJSON } from '../db.js'

/** 从 DB 加载上次记忆 */
export async function loadMemory(env: Env): Promise<AgentMemory> {
  try {
    const mem = await metaGetJSON<AgentMemory>(env, META.agentMemory)
    if (mem) return mem
  } catch {}
  return { sourceMemory: {}, entityHeat: {}, categoryConfidence: {}, lastRunAt: '', totalAnalyses: 0 }
}

/** 持久化记忆 */
export async function saveMemory(env: Env, mem: AgentMemory): Promise<void> {
  const now = new Date().toISOString()
  mem.lastRunAt = now
  try {
    await metaSetJSON(env, META.agentMemory, mem)
  } catch {}
}

/** 消费用户信号 → 计算来源点击率 + 实体热度（反馈环输入） */
export async function ingestSignals(env: Env): Promise<SignalSummary> {
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

  // 实体级热度（用户点开实体视图的信号）——写入 memory.entityHeat 后
  // 供 analyzeNewArticles 优先分析标题命中热门实体的文章（学习反馈闭环）
  const entityRows = await env.DB.prepare(`
    SELECT target_id, COUNT(*) as cnt
    FROM signals
    WHERE target_type = 'entity' AND created_at >= datetime('now', '-7 days')
    GROUP BY target_id ORDER BY cnt DESC LIMIT 30
  `).all<any>()
  const entityClicks = new Map<string, number>()
  for (const r of (entityRows.results || [])) entityClicks.set(r.target_id, r.cnt || 0)

  return { sourceCTR, entityClicks, categoryEngagement: new Map() }
}
