import { json } from '../../../../src/handler'
import { updateNarratives } from '../../../../src/agent/narrative.js'

// POST /api/news/narrative/refresh — 手动触发叙事重新计算（限频）
// 相比跑完整 agent pipeline，只跑叙事匹配+新叙事发现，更轻量
const MIN_INTERVAL_MS = 300_000 // 5 分钟

export async function onRequestPost(context: any) {
  const { env } = context

  // 限频检查
  const lastRefresh = await env.DB.prepare(
    "SELECT value FROM agent_meta WHERE key = 'narrative_refresh'"
  ).first<any>()
  const lastTs = lastRefresh ? parseInt(lastRefresh.value) : 0
  const now = Date.now()
  if (now - lastTs < MIN_INTERVAL_MS) {
    const remaining = Math.ceil((MIN_INTERVAL_MS - (now - lastTs)) / 1000)
    return json({ ok: false, error: `请 ${remaining} 秒后再试`, remaining }, 429)
  }

  // 记录本次触发时间
  await env.DB.prepare(
    "INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('narrative_refresh', ?)"
  ).bind(String(now)).run()

  try {
    await updateNarratives(env)
    return json({ ok: true })
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500)
  }
}
