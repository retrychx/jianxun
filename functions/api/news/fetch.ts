import { fetchNews, json, requireAdmin } from '../../../src/handler'

export async function onRequestPost(context: any) {
  const denied = requireAdmin(context.request, context.env)
  if (denied) return denied
  return json(await fetchNews(context.env, context))
}
