import type { HandlerContext } from '../../../src/pages.js'
import { tryCatch, digests, json } from '../../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => digests(context.env))
}
