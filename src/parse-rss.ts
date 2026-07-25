/**
 * Minimal RSS/Atom parser using Workers-native fetch + regex.
 * No Node.js deps needed — works on Cloudflare Workers.
 */

export interface RssItem {
  title?: string
  link?: string
  contentSnippet?: string
  content?: string
  isoDate?: string
  mediaContent?: string
  mediaThumbnail?: string
  enclosureUrl?: string
  enclosureType?: string
}

export interface RssFeed {
  items: RssItem[]
}

export async function parseRSS(url: string): Promise<RssFeed> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 NewsBot/1.0' },
    signal: AbortSignal.timeout(10_000),
  })
  const xml = await res.text()

  const items: RssItem[] = []

  // Extract <item> or <entry> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
  const matches = [...xml.matchAll(itemRegex), ...xml.matchAll(entryRegex)]

  for (const match of matches) {
    const block = match[1]
    const item: RssItem = {}

    const title = block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (title) item.title = title[1].trim()

    const link = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
    if (link) item.link = link[1]?.trim()

    const desc = block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)
    if (desc) {
      item.contentSnippet = desc[1].replace(/<[^>]+>/g, '').trim().slice(0, 2000)
    }

    const content = block.match(/<content:encoded[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
    if (content) item.content = content[1].trim().slice(0, 2000)

    const pubDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)
    if (pubDate) item.isoDate = new Date(pubDate[1].trim()).toISOString()

    const updated = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)
    if (updated && !item.isoDate) item.isoDate = new Date(updated[1].trim()).toISOString()

    // Media content
    const mc = block.match(/<media:content[^>]*url="([^"]+)"/i)
    if (mc) item.mediaContent = mc[1]
    const mt = block.match(/<media:thumbnail[^>]*url="([^"]+)"/i)
    if (mt) item.mediaThumbnail = mt[1]

    const enc = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="([^"]+)"/i)
    if (enc) { item.enclosureUrl = enc[1]; item.enclosureType = enc[2] }

    if (item.title || item.link) items.push(item)
  }

  return { items }
}
