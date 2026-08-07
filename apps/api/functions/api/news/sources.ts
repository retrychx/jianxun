import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, sources, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => sources(context.env))
}
