import { ask, tryCatch } from '../../../src/handler'

export async function onRequestGet(context: any) {
  const q = new URL(context.request.url).searchParams.get('q') || ''
  if (!q) return new Response(JSON.stringify({ error: 'missing q' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  return tryCatch(() => ask(context.env, q))
}
