import type { HandlerContext } from '../../src/pages.js'
// GET /api/health — 系统健康概览
import { systemHealth } from '../../src/agent/cleanup'
import { json } from '../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  try {
    return json(await systemHealth(context.env))
  } catch {
    return json({ status: 'error', message: 'health check failed' }, 500)
  }
}
