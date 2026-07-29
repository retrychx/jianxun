import { tryCatch,  translateMissing, json, requireAdmin } from '../../../src/handler'

export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  return tryCatch(async () => await translateMissing(context.env))
}
