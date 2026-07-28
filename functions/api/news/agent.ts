import { json, requireAdmin } from '../../../src/handler'
import { runAgent } from '../../../src/agent/index.js'

// GET /api/news/agent — agent run status and last log
export async function onRequestGet(context: any) {
  const { env } = context

  const [lastRun, lastLog, report, kpis] = await Promise.all([
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_log'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'agent_last_report'").first<any>(),
    env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'agent_kpis'").first<any>(),
  ])

  const log = lastLog?.value ? JSON.parse(lastLog.value) : null
  const agentReport = report?.value ? JSON.parse(report.value) : null
  const kpiHistory = kpis?.value ? JSON.parse(kpis.value) : null

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
