import { topic, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  const name = new URL(context.request.url).searchParams.get('name') || ''
  if (!name) return json({ error: 'missing name' }, 400)
  const result = await topic(context.env, name)
  if (!result) return json({ error: 'topic not found' }, 404)
  return json(result)
}
