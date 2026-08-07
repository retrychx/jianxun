import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, weekly, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => weekly(context.env))
}
