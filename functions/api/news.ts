import { listNews, json } from '../../src/handler'

export async function onRequestGet(context: any) {
  return json(await listNews(context.env, new URL(context.request.url)))
}
