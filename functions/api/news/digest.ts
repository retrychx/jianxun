import { digest, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  const date = new URL(context.request.url).searchParams.get('date')
  const result = await digest(context.env, date)
  if (!result) return json({ error: 'no digest' }, 404)
  return json(result)
}
