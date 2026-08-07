import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, briefing, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => briefing(context.env))
}
