import { ogPage } from '../_helpers'

export async function onRequestGet(context: any) {
  const { env, params } = context
  const slug = decodeURIComponent(params.slug || '')
  if (!slug) return new Response('Not Found', { status: 404 })

  const row: any = await env.DB.prepare(
    'SELECT keyword, label, summary, article_ids FROM narratives WHERE keyword = ?'
  ).bind(slug).first()
  if (!row) return new Response('Not Found', { status: 404 })

  const label = row.label || row.keyword || '故事详情'
  const cleanLabel = label.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim()
  const ids: number[] = (() => { try { return JSON.parse(row.article_ids || '[]') } catch { return [] } })()
  const desc = (row.summary || `${cleanLabel} - ${ids.length} 篇相关报道`).slice(0, 200)

  return ogPage({
    title: cleanLabel,
    description: desc,
    slug: `narrative/${encodeURIComponent(slug)}`,
    type: 'article',
  })
}
