// POST /api/signal/click — record user click signal (no auth needed)
// target_type 保持纯类型名（'article'/'narrative'/'entity'），deviceId 为可选字段
import { json, rateLimit, clientIp } from '../../../src/handler'

const VALID_TYPES = new Set(['article', 'narrative', 'entity'])

export async function onRequestPost(context: any) {
  const { env, request } = context

  // 限流：防止脚本刷量（click_count 会流入来源权重，影响排序，可被用于操纵）
  if (!(await rateLimit(env, `click:${clientIp(request)}`, 60, 60))) {
    return json({ ok: false, error: '请求过于频繁' }, 429)
  }

  let body: any
  try { body = await request.json() } catch { return json({ ok: false }, 400) }

  const targetType = String(body.type || '')
  const targetId = String(body.id ?? '').trim()
  if (!VALID_TYPES.has(targetType) || !targetId) return json({ ok: false }, 400)
  // target_id 长度上限，防止灌入超长垃圾数据
  if (targetId.length > 200) return json({ ok: false }, 400)

  try {
    await env.DB.prepare(
      "INSERT INTO signals (target_type, target_id) VALUES (?, ?)"
    ).bind(targetType, targetId).run()

    if (targetType === 'article') {
      const id = Number(targetId)
      if (!Number.isInteger(id) || id <= 0) return json({ ok: false }, 400)
      await env.DB.prepare(
        "UPDATE news SET click_count = click_count + 1 WHERE id = ?"
      ).bind(id).run()
    }
  } catch {
    // 写库失败要如实上报，不能静默返回 ok:true
    return json({ ok: false, error: '记录失败' }, 500)
  }

  return json({ ok: true })
}
