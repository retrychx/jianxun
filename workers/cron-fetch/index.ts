// 简讯内容抓取调度器：Cron Trigger 每 1 小时调一次生产的 /api/news/fetch
// 注意：/api/news/fetch 内部已经通过 ctx.waitUntil 启动 runAgent，
// 这里不能再额外 POST /api/news/agent，否则每个周期 agent 被并发触发两次。
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
  return `${res.status} ${(await res.text()).slice(0, 500)}`
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      triggerFetch(env)
        .then(r => console.log('fetch:', r))
        .catch(e => console.error('fetch error:', e)),
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response('unauthorized', { status: 401 })
    }
    try {
      return Response.json({ ok: true, fetch: await triggerFetch(env) })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 })
    }
  },
}
