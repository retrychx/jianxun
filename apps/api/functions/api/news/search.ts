import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, search, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  const q = new URL(context.request.url).searchParams.get('q') || ''
  return tryCatch(() => search(context.env, q))
}
