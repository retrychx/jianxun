import { json, requireAdmin } from '../../../src/handler'
import { runAgent } from '../../../src/agent/index.js'

// GET /api/news/agent — agent run status and last log
// 返回运行报告/KPI/阶段日志等内部运营数据，需 ADMIN_TOKEN
export async function onRequestGet(context: any) {
  const { env, request } = context
  const denied = requireAdmin(request, env)
  if (denied) return denied

  const [lastRun, lastLog, report, kpis] = await Promise.all([
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_log'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'agent_last_report'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'agent_kpis'").first<any>(),
  ])

  // 历史数据可能损坏——单个坏 JSON 不应让整个端点 500
  let log: any = null; try { log = lastLog?.value ? JSON.parse(lastLog.value) : null } catch {}
  let agentReport: any = null; try { agentReport = report?.value ? JSON.parse(report.value) : null } catch {}
  let kpiHistory: any = null; try { kpiHistory = kpis?.value ? JSON.parse(kpis.value) : null } catch {}

  return json({
    lastRun: lastRun?.value || null,
    lastRunAgo: lastRun?.value ? Math.round((Date.now() - new Date(lastRun.value).getTime()) / 1000) + 's ago' : null,
    report: agentReport,
    kpiHistory: kpiHistory?.slice(-7) || null,
    totalPhases: log?.results ? Object.keys(log.results).length : 0,
    totalMs: log?.totalMs || null,
    skipAi: log?.skipAi || false,
    phases: log?.results || null,
  })
}

// POST /api/news/agent — trigger the agent pipeline
export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  const result = await runAgent(context.env, context)
  return json({ ok: true, result })
}
