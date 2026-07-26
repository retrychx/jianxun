import { generateTodayDigest, json, requireAdmin } from '../../../../src/handler'

// 手动触发当天日报生成（运维端点）：返回生成状态
export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  return json({ status: await generateTodayDigest(context.env) })
}
