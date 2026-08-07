import { tryCatch, search, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  const q = new URL(context.request.url).searchParams.get('q') || ''
  return tryCatch(() => search(context.env, q))
}
