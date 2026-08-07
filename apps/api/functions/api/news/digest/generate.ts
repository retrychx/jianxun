import type { HandlerContext } from '../../../../src/pages.js'
import { generateTodayDigest, json, requireAdmin, tryCatch } from '../../../../src/handler'

export async function onRequestPost(context: HandlerContext) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  return tryCatch(async () => ({ status: await generateTodayDigest(context.env) }))
}
