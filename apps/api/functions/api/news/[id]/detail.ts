import { detail, saveAnalysis, validateAnalysisBody, json, requireAdmin, tryCatch } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
    const id = parseInt(context.params.id)
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, 400)
    const result = await detail(context.env, id)
    if (!result) return json({ message: 'Not Found' }, 404)
    return json(result)
  })
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
