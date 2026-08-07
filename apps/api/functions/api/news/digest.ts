import type { HandlerContext } from '../../../src/pages.js'
import { digest, json, tryCatch } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  const date = new URL(context.request.url).searchParams.get('date')
  const result = await digest(context.env, date).catch(() => null)
  if (!result) return json({ error: 'no digest' }, 404)
  return json(result)
}
