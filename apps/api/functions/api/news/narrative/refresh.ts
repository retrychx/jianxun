import type { HandlerContext } from '../../../../src/pages.js'
import { json, requireAdmin } from '../../../../src/handler'
import { updateNarratives } from '../../../../src/agent/narrative.js'
import { META, metaGet, metaSet } from '../../../../src/db.js'

// POST /api/news/narrative/refresh — 手动触发叙事重新计算（管理员）
// 相比跑完整 agent pipeline，只跑叙事匹配+新叙事发现，更轻量。
// 注意：该端点触发多次付费 LLM 调用并写库，必须 ADMIN_TOKEN 鉴权——
// 此前只靠全局限频，任何互联网用户都能触发烧钱/刷掉限频窗口 DoS。
const MIN_INTERVAL_MS = 300_000 // 5 分钟

export async function onRequestPost(context: HandlerContext) {
  const { env, request } = context
  const denied = requireAdmin(request, env)
  if (denied) return denied

  // 限频检查
  const lastRefresh = await metaGet(env, META.narrativeRefresh)
  const lastTs = lastRefresh ? parseInt(lastRefresh) : 0
  const now = Date.now()
  if (now - lastTs < MIN_INTERVAL_MS) {
    const remaining = Math.ceil((MIN_INTERVAL_MS - (now - lastTs)) / 1000)
    return json({ ok: false, error: `请 ${remaining} 秒后再试`, remaining }, 429)
  }

  // 记录本次触发时间
  await metaSet(env, META.narrativeRefresh, String(now))

  try {
    await updateNarratives(env)
    return json({ ok: true })
  } catch {
    // 不返回 e.message——可能泄露 SQL/内部结构
    return json({ ok: false, error: '叙事刷新失败，请稍后再试' }, 500)
  }
}
