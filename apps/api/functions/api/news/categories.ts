import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, categories, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => categories(context.env))
}
