import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, statusCheck, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => statusCheck(context.env))
}
