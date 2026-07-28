import { seoPage, notFound } from '../helpers'

export async function onRequestGet(context: any) {
  const { env, params } = context
  const id = parseInt(params.id)
  if (!id) return notFound()

  const row: any = await env.DB.prepare(
    'SELECT title, description, summary, image, source, category FROM news WHERE id = ?'
  ).bind(id).first()
  if (!row) return notFound()

  const title = row.title || '新闻详情'
  const desc = (row.summary || row.description || `${title} - ${row.source || ''} 报道`).slice(0, 200)
  const image = row.image || null

  return seoPage({
    title,
    description: desc,
    image,
    url: `/news/${id}`,
    type: 'article',
  })
}
