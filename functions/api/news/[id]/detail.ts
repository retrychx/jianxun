import { detail, saveAnalysis, validateAnalysisBody, json, requireAdmin } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  const id = parseInt(context.params.id)
  const result = await detail(context.env, id)
  if (!result) return json({ message: 'Not Found' }, 404)
  return json(result)
}

export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  const id = parseInt(context.params.id)
  let body: any
  try { body = await context.request.json() } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400) }
  const invalid = validateAnalysisBody(body)
  if (invalid) return json({ ok: false, error: invalid }, 400)
  return json(await saveAnalysis(context.env, id, body))
}
