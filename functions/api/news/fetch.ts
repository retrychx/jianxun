import { fetchNews, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await fetchNews(context.env))
}
