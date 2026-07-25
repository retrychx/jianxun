import { search, json } from '../../../src/handler'

export async function onRequest(context: any) {
  const q = new URL(context.request.url).searchParams.get('q') || ''
  return json(await search(context.env, q))
}
