import { listNews, json, tryCatch } from '../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => listNews(context.env, new URL(context.request.url)))
}
