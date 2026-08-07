import { requireAdmin } from '../../src/handler'

/**
 * 统一写接口鉴权：除 /api/signal/*（公开埋点）外，所有 POST 都要求 ADMIN_TOKEN。
 * 此前 narrative/refresh 是唯一漏掉鉴权的写端点——统一在中间件兜底，
 * 未来新增写端点不再依赖各路由手动调用 requireAdmin。
 */
export async function onRequest(context: any) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname

  // 公开写接口白名单：仅信号埋点
  const isPublicWrite = path.startsWith('/api/signal/')

  if (request.method === 'POST' && !isPublicWrite) {
    const denied = requireAdmin(request, env)
    if (denied) return denied
  }

  return context.next()
}
