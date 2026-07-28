// GET /api/health — 系统健康概览
import { systemHealth } from '../../src/agent/cleanup'
import { json } from '../../src/handler'

export async function onRequestGet(context: any) {
  try {
    return json(await systemHealth(context.env))
  } catch (e: any) {
    return json({ status: 'error', message: e?.message || 'unknown' }, 500)
  }
}
