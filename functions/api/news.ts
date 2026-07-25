import { listNews, json } from '../../src/handler'

export async function onRequest(context: any) {
  return json(await listNews(context.env, new URL(context.request.url)))
}
