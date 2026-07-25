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

function extractField(block: string, tag: string): string | undefined {
  // CDATA wrapped
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
  let m = block.match(cdata)
  if (m) return decodeEntities(m[1]).trim()

  // Plain content
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  m = block.match(plain)
  return m ? decodeEntities(m[1]).trim() : undefined
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
}

// Some feeds carry unparseable dates; fall back to now instead of throwing
function toIsoDate(value: string): string {
  const d = new Date(value)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
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

    // Title
    item.title = extractField(block, 'title')

    // Link: try href attr, then CDATA, then plain
    let l = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i)
    if (!l) l = block.match(/<link[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/link>/i)
    if (!l) l = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
    if (l) item.link = l[1].trim()

    // Description (strip HTML)
    const desc = extractField(block, 'description')
    if (desc) item.contentSnippet = desc.replace(/<[^>]+>/g, '').slice(0, 2000)

    // content:encoded
    const content = extractField(block, 'content:encoded')
    if (content) item.content = content.slice(0, 2000)

    // Dates
    const pubDate = extractField(block, 'pubDate')
    if (pubDate) item.isoDate = toIsoDate(pubDate)

    const updated = extractField(block, 'updated')
    if (updated && !item.isoDate) item.isoDate = toIsoDate(updated)

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
