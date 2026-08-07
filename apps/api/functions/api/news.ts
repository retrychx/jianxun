import type { HandlerContext } from '../../src/pages.js'
import { listNews, json, tryCatch } from '../../src/handler'

export async function onRequestGet(context: HandlerContext) {
  return tryCatch(() => listNews(context.env, new URL(context.request.url)))
}
