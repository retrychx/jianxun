import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, trending, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => trending(context.env))
}
