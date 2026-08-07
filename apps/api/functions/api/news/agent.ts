import type { HandlerContext } from '../../../src/pages.js'
import { json, requireAdmin } from '../../../src/handler'
import { runAgent } from '../../../src/agent/index.js'
import { META, metaGet, metaGetJSON } from '../../../src/db.js'

// GET /api/news/agent — agent run status and last log
// 返回运行报告/KPI/阶段日志等内部运营数据，需 ADMIN_TOKEN
export async function onRequestGet(context: HandlerContext) {
  const { env, request } = context
  const denied = requireAdmin(request, env)
  if (denied) return denied

  // 历史数据可能损坏——metaGetJSON 对坏 JSON 返回 null，单个坏数据不会让端点 500
  const [lastRun, lastLog, agentReport, kpiHistory] = await Promise.all([
    metaGet(env, META.lastRun),
    metaGetJSON<any>(env, META.lastLog),
    metaGetJSON<any>(env, META.agentReport),
    metaGetJSON<any[]>(env, META.agentKpis),
  ])

  return json({
    lastRun,
    lastRunAgo: lastRun ? Math.round((Date.now() - new Date(lastRun).getTime()) / 1000) + 's ago' : null,
    report: agentReport,
    kpiHistory: kpiHistory?.slice(-7) || null,
    totalPhases: lastLog?.results ? Object.keys(lastLog.results).length : 0,
    totalMs: lastLog?.totalMs || null,
    skipAi: lastLog?.skipAi || false,
    phases: lastLog?.results || null,
  })
}

// POST /api/news/agent — trigger the agent pipeline
export async function onRequestPost(context: HandlerContext) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  const result = await runAgent(context.env, context)
  return json({ ok: true, result })
}
