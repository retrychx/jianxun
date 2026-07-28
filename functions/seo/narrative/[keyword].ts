import { seoPage, notFound } from '../helpers'

export async function onRequestGet(context: any) {
  const { env, params } = context
  const keyword = decodeURIComponent(params.keyword || '')
  if (!keyword) return notFound()

  const row: any = await env.DB.prepare(
    'SELECT keyword, label, summary, article_ids FROM narratives WHERE keyword = ?'
  ).bind(keyword).first()
  if (!row) return notFound()

  const label = row.label || row.keyword || '故事详情'
  const cleanLabel = label.replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim()
  const ids: number[] = (() => { try { return JSON.parse(row.article_ids || '[]') } catch { return [] } })()
  const desc = (row.summary || `${cleanLabel} - ${ids.length} 篇相关报道`).slice(0, 200)

  return seoPage({
    title: cleanLabel,
    description: desc,
    url: `/narrative/${encodeURIComponent(keyword)}`,
    type: 'article',
  })
}
