import { detail, saveAnalysis, json } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  const id = parseInt(context.params.id)
  const result = await detail(context.env, id)
  if (!result) return json({ message: 'Not Found' }, 404)
  return json(result)
}

export async function onRequestPost(context: any) {
  const id = parseInt(context.params.id)
  const body = await context.request.json()
  return json(await saveAnalysis(context.env, id, body))
}
