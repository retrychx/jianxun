/**
 * Agent Memory — 跨运行状态管理
 * 让 agent 记住上次学到了什么，而不是每次从零开始。
 */
import type { Env } from '../helpers.js'
import type { AgentMemory, SignalSummary } from './types.js'

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

/** 消费用户信号 → 计算来源点击率 */
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

  return { sourceCTR, categoryEngagement: new Map() }
}
