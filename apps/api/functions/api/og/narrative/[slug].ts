import type { HandlerContext } from '../../../../src/pages.js'
import { ogPage } from '../_helpers'

export async function onRequestGet(context: HandlerContext) {
  const { env, params, request } = context
  // 优先使用 ?kw= 参数查找；没有则尝试用 slug 直接匹配
  const url = new URL(request.url)
  const kwOverride = url.searchParams.get('kw')
  // Pages Functions 已对路径参数解码，不要二次 decodeURIComponent
  // （单个 % 会抛 URIError；这里还需兜底 catch）
  const slug = String(params.slug || '')

  let row: any = null
  try {
    if (kwOverride) {
      row = await env.DB.prepare(
        'SELECT keyword, label, summary, article_ids, source_stats FROM narratives WHERE keyword = ?'
      ).bind(kwOverride).first()
    }
    if (!row) {
      row = await env.DB.prepare(
        'SELECT keyword, label, summary, article_ids, source_stats FROM narratives WHERE keyword = ? OR label = ?'
      ).bind(slug, slug).first()
    }
    if (!row) return new Response('Not Found', { status: 404 })

    const rawLabel = row.label || row.keyword || '故事详情'
    const cleanLabel = rawLabel.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').replace(/\s*·\s*/g, '·').trim()
    const ids: number[] = (() => { try { return JSON.parse(row.article_ids || '[]') } catch { return [] } })()
    const desc = (row.summary || `${cleanLabel} - ${ids.length} 篇相关报道`).slice(0, 200)

    return ogPage({
      title: cleanLabel,
      description: desc,
      slug: `narrative/${encodeURIComponent(cleanLabel)}?kw=${encodeURIComponent(row.keyword)}`,
      type: 'article',
    })
  } catch {
    // 坏 slug / DB 异常 → 404，避免向爬虫暴露内部错误
    return new Response('Not Found', { status: 404 })
  }
}
