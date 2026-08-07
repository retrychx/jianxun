/**
 * 轻量数据访问层（DAL）
 *
 * 集中最常重复的访问模式，收敛 schema 知识：
 *  - agent_meta 的键名（单一事实源）——此前散落在 15+ 个文件里手写字符串，
 *    拼错键名（如 'product_ideas' 与 'last_run'）只在运行时静默失败。
 *  - JSON 读写的 parse/stringify 与损坏容错，避免每个调用点重复 try/catch。
 *
 * 只包薄薄一层，不引入 ORM；其余业务 SQL 仍在各自模块内。
 */

import type { Env } from './helpers.js'

/** agent_meta 键常量（单一事实源）。所有模块经 metaGet/metaSet 访问，不再手写 SQL。 */
export const META = {
  lastRun: 'last_run',
  lastFetch: 'last_fetch',
  lastLog: 'last_log',
  running: 'running', // 运行锁
  agentReport: 'agent_last_report',
  agentKpis: 'agent_kpis',
  productIdeas: 'product_ideas',
  productIdeasDate: 'product_ideas_date',
  agentErrors: 'agent_errors',
  briefingCurated: 'briefing_curated',
  narrativeRefresh: 'narrative_refresh',
  agentMemory: 'agent_memory',
  narrativeOutlooks: 'narrative_outlooks',
  entityEvents: 'entity_events',
} as const

/** 读取 agent_meta 原始字符串值；无此行返回 null */
export async function metaGet(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM agent_meta WHERE key = ?').bind(key).first<{ value: string | null }>()
  return row?.value ?? null
}

/** 写入 agent_meta 原始字符串值（存在则覆盖） */
export async function metaSet(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)').bind(key, value).run()
}

/** 删除 agent_meta 键 */
export async function metaDelete(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM agent_meta WHERE key = ?').bind(key).run()
}

/** 读取并解析 JSON；缺失或损坏时返回 null（容错语义与各调用点原 try/catch 一致） */
export async function metaGetJSON<T>(env: Env, key: string): Promise<T | null> {
  const raw = await metaGet(env, key)
  if (raw == null) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

/** 对象序列化为 JSON 后写入 */
export async function metaSetJSON(env: Env, key: string, value: unknown): Promise<void> {
  await metaSet(env, key, JSON.stringify(value))
}
