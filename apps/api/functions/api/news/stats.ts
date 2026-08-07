import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, stats, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => stats(context.env))
}
