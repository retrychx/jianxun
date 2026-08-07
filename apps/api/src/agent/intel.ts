/**
 * 智能洞察阶段 — 为活跃叙事生成前瞻、为热门实体抽取事件
 * 产出存 agent_meta，前端按需读取
 */
import type { Env } from '../helpers.js'
import { generateNarrativeOutlook, extractEntityEvents } from './insights.js'
import { META, metaGetJSON, metaSetJSON } from '../db.js'

/** 为活跃叙事生成"下一步关注" */
export async function generateNarrativeOutlooks(env: Env): Promise<number> {
  const k = env.DEEPSEEK_API_KEY
  if (!k) return 0

  // 读取已有 outlook 避免重复生成
  const existing: Record<string, { outlook: string; ts: string }> = (await metaGetJSON(env, META.narrativeOutlooks)) ?? {}

  // 取最近更新的 5 个活跃叙事
  const narrRows = await env.DB.prepare(`
    SELECT keyword, label, summary, developments, last_updated FROM narratives
    WHERE status = 'active' ORDER BY last_updated DESC LIMIT 5
  `).all<any>()
  const narratives = (narrRows.results || []) as any[]

  let generated = 0
  for (const n of narratives) {
    // 24h 内已生成过就跳过
    if (existing[n.keyword] && Date.now() - new Date(existing[n.keyword].ts).getTime() < 86400000) continue
    const devs: any[] = (() => { try { return JSON.parse(n.developments || '[]') } catch { return [] } })()
    const outlook = await generateNarrativeOutlook(env, n.keyword, n.label || n.keyword, n.summary || '', devs.map((d: any) => d.text || ''))
    if (outlook) {
      existing[n.keyword] = { outlook, ts: new Date().toISOString() }
      generated++
    }
  }

  if (generated > 0) {
    await metaSetJSON(env, META.narrativeOutlooks, existing)
  }
  return generated
}

/** 为热门实体抽取结构化事件 */
export async function extractTopEntityEvents(env: Env): Promise<number> {
  const k = env.DEEPSEEK_API_KEY
  if (!k) return 0

  // 最近 7 天提及最多的 3 个实体
  const entityRows = await env.DB.prepare(`
    SELECT entities FROM news
    WHERE entities IS NOT NULL AND entities != '' AND created_at >= datetime('now', '-7 days')
    LIMIT 300
  `).all<any>()
  const entityCount = new Map<string, number>()
  for (const r of (entityRows.results || [])) {
    try {
      const parsed = typeof r.entities === 'string' ? JSON.parse(r.entities) : r.entities
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          const name = e?.name?.trim()
          if (name && name.length >= 2 && e?.type === 'company') entityCount.set(name, (entityCount.get(name) || 0) + 1)
        }
      }
    } catch {}
  }
  const topEntities = [...entityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0])

  // 读取已有事件避免重复
  const existing: Record<string, any> = (await metaGetJSON(env, META.entityEvents)) ?? {}

  let extracted = 0
  for (const entity of topEntities) {
    if (existing[entity] && Date.now() - new Date(existing[entity].ts).getTime() < 86400000) continue
    // 取该实体的文章
    const articleRows = await env.DB.prepare(`
      SELECT title, summary FROM news WHERE entities LIKE ? ORDER BY published_at DESC LIMIT 10
    `).bind(`%${entity}%`).all<any>()
    const events = await extractEntityEvents(env, entity, (articleRows.results || []).map((a: any) => ({ title: a.title, summary: a.summary || '' })))
    if (events.length > 0) {
      existing[entity] = { events, ts: new Date().toISOString() }
      extracted++
    }
  }

  if (extracted > 0) {
    await metaSetJSON(env, META.entityEvents, existing)
  }
  return extracted
}

/** 读取叙事前瞻 */
export async function getNarrativeOutlook(env: Env, keyword: string): Promise<string | null> {
  const outlooks = await metaGetJSON<Record<string, { outlook: string; ts: string }>>(env, META.narrativeOutlooks)
  return outlooks?.[keyword]?.outlook || null
}

/** 读取实体事件 */
export async function getEntityEvents(env: Env, entity: string): Promise<any[] | null> {
  const events = await metaGetJSON<Record<string, any>>(env, META.entityEvents)
  return events?.[entity]?.events || null
}
