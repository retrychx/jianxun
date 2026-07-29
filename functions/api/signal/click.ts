// POST /api/signal/click — record user click signal (no auth needed)
// target_type 保持纯类型名（'article'/'narrative'/'entity'），deviceId 为可选字段
import { json } from '../../../src/handler'

export async function onRequestPost(context: any) {
  const { env, request } = context
  let body: any
  try { body = await request.json() } catch { return json({ ok: false }, 400) }

  const targetType = body.type
  const targetId = String(body.id ?? '').trim()
  if (!targetType || !targetId) return json({ ok: false }, 400)

  try {
    env.DB.prepare(
      "INSERT INTO signals (target_type, target_id) VALUES (?, ?)"
    ).bind(targetType, targetId).run().catch(() => {})

    if (targetType === 'article') {
      env.DB.prepare(
        "UPDATE news SET click_count = click_count + 1 WHERE id = ?"
      ).bind(Number(targetId) || 0).run().catch(() => {})
    }
  } catch {}

  return json({ ok: true })
}
