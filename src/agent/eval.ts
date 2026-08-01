/**
 * Agent Self-Evaluation — KPI tracking, exploration, cost awareness, reporting.
 */
import type { Env } from '../helpers.js'

// ═══ 1. 自我评估：KPI 追踪 ═══

export interface AgentKPI {
  /** 本轮分析文章数 */
  articlesAnalyzed: number
  /** 分析质量：摘要平均长度 */
  avgSummaryLength: number
  /** 分析质量：平均实体数 */
  avgEntityCount: number
  /** 叙事匹配数 */
  narrativesMatched: number
  /** 新创建叙事数 */
  narrativesCreated: number
  /** 简报条目数 */
  briefingCount: number
  /** 质量自检标记数 */
  qualityFlags: number
  /** 叙事合并数 */
  narrativesMerged: number
  /** 运行耗时 */
  totalMs: number
  /** 预估 API 成本 (cents) */
  estimatedCost: number
}

/** 评估本轮分析质量 */
export async function evaluateQuality(env: Env): Promise<Partial<AgentKPI>> {
  const kpi: Partial<AgentKPI> = {}

  // 最近分析的文章质量
  const rows = await env.DB.prepare(
    `SELECT summary, entities, analyzed_at FROM news
     WHERE analyzed_at >= datetime('now', '-3 hours')
     AND summary IS NOT NULL`
  ).all<any>()
  const analyzed = (rows.results || []) as any[]
  kpi.articlesAnalyzed = analyzed.length

  if (analyzed.length > 0) {
    const totalLen = analyzed.reduce((s: number, r: any) => s + (r.summary?.length || 0), 0)
    kpi.avgSummaryLength = Math.round(totalLen / analyzed.length)

    let totalEntities = 0
    let entityCount = 0
    for (const r of analyzed) {
      if (r.entities) {
        try {
          const parsed = typeof r.entities === 'string' ? JSON.parse(r.entities) : r.entities
          if (Array.isArray(parsed)) { totalEntities += parsed.length; entityCount++ }
        } catch {}
      }
    }
    kpi.avgEntityCount = entityCount > 0 ? Math.round(totalEntities / entityCount) : 0
  }

  return kpi
}

/** 持久化 KPI 历史 */
const KPI_KEY = 'agent_kpis'

export async function saveKPI(env: Env, kpi: Partial<AgentKPI>): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = ?").bind(KPI_KEY).first<any>()
    const history: Partial<AgentKPI>[] = row?.value ? JSON.parse(row.value) : []
    history.push({ ...kpi, totalMs: kpi.totalMs })
    // 只保留最近 30 条
    if (history.length > 30) history.splice(0, history.length - 30)
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES (?, ?)").bind(KPI_KEY, JSON.stringify(history)).run()
  } catch {}
}

// ═══ 2. 成本感知 ═══

const API_COST_PER_CALL = 0.002 // $0.002 per DeepSeek API call

export function estimateAPICost(calls: number): number {
  return Math.round(calls * API_COST_PER_CALL * 100) / 100 // 返回 cents
}

// ═══ 3. 向用户汇报 ═══

export interface AgentReport {
  timestamp: string
  summary: string
  details: string[]
  kpi: Partial<AgentKPI>
}

/** 生成人类可读的运行报告 */
export function generateReport(kpi: Partial<AgentKPI>, phaseResults: Record<string, any>): AgentReport {
  const details: string[] = []
  let summaryParts: string[] = []

  if (kpi.articlesAnalyzed && kpi.articlesAnalyzed > 0) {
    details.push(`分析了 ${kpi.articlesAnalyzed} 篇文章（平均摘要 ${kpi.avgSummaryLength} 字，平均 ${kpi.avgEntityCount} 个实体）`)
    summaryParts.push(`${kpi.articlesAnalyzed} 篇分析`)
  }

  if (kpi.narrativesMatched && kpi.narrativesMatched > 0) {
    details.push(`更新了 ${kpi.narrativesMatched} 个叙事的新进展`)
    summaryParts.push(`${kpi.narrativesMatched} 个叙事更新`)
  }

  const created = kpi.narrativesCreated || 0
  if (created > 0) {
    details.push(`发现了 ${created} 个新叙事`)
    summaryParts.push(`${created} 个新故事`)
  }

  const merged = kpi.narrativesMerged || 0
  if (merged > 0) details.push(`合并了 ${merged} 个重叠叙事`)

  const flags = kpi.qualityFlags || 0
  if (flags > 0) details.push(`质量自检标记了 ${flags} 篇需重分析`)

  const briefing = kpi.briefingCount || 0
  if (briefing > 0) details.push(`生成了 ${briefing} 条精选简报`)

  const cost = kpi.estimatedCost || 0
  if (cost > 0) details.push(`预估 API 成本 $${cost.toFixed(3)}`)

  const ms = kpi.totalMs || 0
  if (ms > 0) details.push(`总耗时 ${(ms / 1000).toFixed(1)} 秒`)

  if (summaryParts.length === 0) summaryParts = ['本次运行未产生新内容']

  return {
    timestamp: new Date().toISOString(),
    summary: summaryParts.join('，'),
    details,
    kpi,
  }
}

/** 保存报告到 agent_meta */
export async function saveReport(env: Env, report: AgentReport): Promise<void> {
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('agent_last_report', ?)").bind(JSON.stringify(report)).run()
  } catch {}
}
