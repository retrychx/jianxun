import { tryCatch, topics, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  // 传 context（含 waitUntil）让 AI 标签在后台生成，不阻塞响应
  return tryCatch(() => topics(context.env, context))
}
