import { generateTodayDigest, json, requireAdmin, tryCatch } from '../../../../src/handler'

export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  return tryCatch(async () => ({ status: await generateTodayDigest(context.env) }))
}
