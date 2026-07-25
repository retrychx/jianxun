import { parseRSS } from '../../../src/parse-rss'

export async function onRequest(context: any) {
  const url = new URL(context.request.url)
  const feedUrl = url.searchParams.get('url') || 'https://hnrss.org/frontpage'

  try {
    const feed = await parseRSS(feedUrl)
    const items = feed.items.slice(0, 3).map(i => ({
      title: i.title?.slice(0, 50),
      link: i.link?.slice(0, 80),
    }))
    return new Response(JSON.stringify({ ok: true, items, total: feed.items.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack?.slice(0, 200) }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
