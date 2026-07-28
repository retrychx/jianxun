// 简讯内容抓取调度器：Cron Trigger 每 2 小时调一次生产的 /api/news/fetch
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'

interface Env {
  SITE_URL: string
  ADMIN_TOKEN: string
}

async function triggerFetch(env: Env): Promise<string> {
  // Health check before fetch: if SITE_URL or ADMIN_TOKEN is missing, report immediately
  if (!env.SITE_URL) return 'ERROR: SITE_URL not configured'
  if (!env.ADMIN_TOKEN) return 'ERROR: ADMIN_TOKEN not configured'
  const res = await fetch(`${env.SITE_URL}/api/news/fetch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  })
  return `${res.status} ${await res.text()}`
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(triggerFetch(env).then(r => console.log('fetch trigger:', r)).catch(e => console.error('fetch trigger failed:', e)))
  },

  // 手动触发（与定时触发同逻辑）：需要同样的 ADMIN_TOKEN
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    try {
      return Response.json({ ok: true, result: await triggerFetch(env) })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 })
    }
  },
}
