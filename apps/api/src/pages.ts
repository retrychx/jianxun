import type { EventContext } from '@cloudflare/workers-types'
import type { Env } from './helpers.js'

/**
 * Pages Functions 路由 handler 的 context 类型（去 any）。
 *
 * - request/next 用 DOM 类型：helpers 层（requireAdmin/clientIp 等）与测试都以
 *   DOM Request/Response 消费；workers-types 的 Request 形状与之不同（缺 credentials 等），
 *   不在此引入类型身份冲突。
 * - params 用 string 通配：Pages 动态段（[id]）运行时总是单值字符串，
 *   取用时用 String(...) 归一（EventContext 的 Params<string> 类型是 string | string[]）。
 */
export type HandlerContext = Omit<EventContext<Env, string, unknown>, 'request' | 'next'> & {
  request: Request
  next: () => Promise<Response>
}
