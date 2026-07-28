// SEO: /news/:id — social crawler OG page + redirect to SPA hash
import { seoPage } from '../_lib/seo'

export async function onRequestGet(context: any) {
  const { env, params } = context
  const id = parseInt(params.id)
  if (!id) return new Response('Not Found', { status: 404 })

  const row: any = await env.DB.prepare(
    'SELECT title, description, summary, image, source, category FROM news WHERE id = ?'
  ).bind(id).first()
  if (!row) return new Response('Not Found', { status: 404 })

  const title = row.title || '新闻详情'
  const desc = (row.summary || row.description || `${title} - ${row.source || ''} 报道`).slice(0, 200)

  return seoPage({
    title,
    description: desc,
    image: row.image || null,
    url: `/news/${id}`,
    type: 'article',
  })
}
