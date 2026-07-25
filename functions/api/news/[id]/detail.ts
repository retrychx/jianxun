import { detail, json } from '../../../../src/handler'

export async function onRequest(context: any) {
  const id = parseInt(context.params.id)
  const result = await detail(context.env, id)
  if (!result) return json({ message: 'Not Found' }, 404)
  return json(result)
}
