import type { HandlerContext } from '../../../../src/pages.js'
import { entitySearch, tryCatch } from '../../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => entitySearch(context.env, String(context.params.name)))
}
