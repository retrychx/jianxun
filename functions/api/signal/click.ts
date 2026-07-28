// POST /api/signal/click — record user click signal (no auth needed)
import { json } from '../../../src/handler'

export async function onRequestPost(context: any) {
  const { env, request } = context
  let body: any
  try { body = await request.json() } catch { return json({ ok: false }, 400) }

  const targetType = body.type  // 'article' | 'narrative' | 'entity'
  const targetId = String(body.id ?? '').trim()
  if (!targetType || !targetId) return json({ ok: false }, 400)

  try {
    // Insert signal asynchronously (fire-and-forget, don't block response)
    env.DB.prepare(
      "INSERT INTO signals (target_type, target_id) VALUES (?, ?)"
    ).bind(targetType, targetId).run().catch(() => {})

    // Update click count for articles
    if (targetType === 'article') {
      env.DB.prepare(
        "UPDATE news SET click_count = click_count + 1 WHERE id = ?"
      ).bind(Number(targetId) || 0).run().catch(() => {})
    }
  } catch {}

  return json({ ok: true })
}
