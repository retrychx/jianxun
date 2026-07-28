// POST /api/signal/click — record user click signal (no auth needed)
import { json } from '../../../src/handler'

export async function onRequestPost(context: any) {
  const { env, request } = context
  let body: any
  try { body = await request.json() } catch { return json({ ok: false }, 400) }

  const targetType = body.type
  const targetId = String(body.id ?? '').trim()
  const deviceId = String(body.deviceId ?? '').trim().slice(0, 36)
  if (!targetType || !targetId) return json({ ok: false }, 400)

  try {
    // Store device-level signal so we can later personalize by device
    const did = deviceId || 'anonymous'
    env.DB.prepare(
      "INSERT INTO signals (target_type, target_id) VALUES (?, ?)"
    ).bind(`${targetType}:${did}`, targetId).run().catch(() => {})

    if (targetType === 'article') {
      env.DB.prepare(
        "UPDATE news SET click_count = click_count + 1 WHERE id = ?"
      ).bind(Number(targetId) || 0).run().catch(() => {})
    }
  } catch {}

  return json({ ok: true })
}
