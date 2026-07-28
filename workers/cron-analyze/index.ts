// 简讯 AI Agent 调度器：Cron Trigger 每 3 小时触发主站 agent pipeline
// 主站 runAgent() 内部完成分析、翻译、叙事检测等全流程
// 所需 secret: ADMIN_TOKEN

interface Env {
  SITE_URL: string
  ADMIN_TOKEN: string
}

async function triggerAgent(env: Env): Promise<string> {
  if (!env.SITE_URL) return 'ERROR: SITE_URL not configured'
  if (!env.ADMIN_TOKEN) return 'ERROR: ADMIN_TOKEN not configured'

  const res = await fetch(`${env.SITE_URL}/api/news/agent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
  })
  const text = await res.text()
  return `${res.status} ${text.slice(0, 500)}`
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      triggerAgent(env)
        .then(r => console.log('agent trigger:', r))
        .catch(e => console.error('agent trigger failed:', e)),
    )
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
    try {
      return Response.json({ ok: true, result: await triggerAgent(env) })
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 502 })
    }
  },
}
