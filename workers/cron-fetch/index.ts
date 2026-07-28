// 简讯内容抓取调度器：Cron Trigger 每 2 小时调一次生产的 /api/news/fetch
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'

interface Env {
  SITE_URL: string
  ADMIN_TOKEN: string
}

async function triggerFetch(env: Env): Promise<string> {
  if (!env.SITE_URL) return 'ERROR: SITE_URL not configured'
  if (!env.ADMIN_TOKEN) return 'ERROR: ADMIN_TOKEN not configured'
  const res = await fetch(`${env.SITE_URL}/api/news/fetch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  })
  return `${res.status} ${await res.text()}`
}

async function triggerAgent(env: Env): Promise<string> {
  if (!env.SITE_URL || !env.ADMIN_TOKEN) return 'ERROR: not configured'
  const res = await fetch(`${env.SITE_URL}/api/news/agent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  })
  return `${res.status} ${(await res.text()).slice(0, 200)}`
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // 先抓取 RSS
    ctx.waitUntil(
      triggerFetch(env).then(r => {
        console.log('fetch:', r)
        // 抓取完成后立即触发 agent（不等待完成）
        triggerAgent(env).then(r2 => console.log('agent:', r2)).catch(e => console.error('agent error:', e))
      }).catch(e => console.error('fetch error:', e))
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response('unauthorized', { status: 401 })
    }
    try {
      return Response.json({ ok: true, fetch: await triggerFetch(env), agent: await triggerAgent(env) })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 })
    }
  },
}
