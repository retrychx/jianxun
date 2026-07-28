/**
 * RSS / Atom parser using fast-xml-parser for robust XML handling.
 * Supports RSS 2.0, Atom, and common namespace extensions (media:content, etc.).
 * Falls back to regex-based extraction for vendor-specific quirks.
 */

import { XMLParser } from 'fast-xml-parser'

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
  /** Human-readable title of the feed itself, if available. */
  feedTitle?: string
}

const xmlOpts = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: false,
  isArray: (name: string) =>
    ['item', 'entry'].includes(name),
}

function parseXml(xml: string): any {
  const parser = new XMLParser(xmlOpts)
  return parser.parse(xml)
}

// Some feeds carry unparseable dates; fall back to now instead of throwing
function toIsoDate(value: string): string {
  if (!value) return new Date().toISOString()
  const d = new Date(value)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
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

/** Unwrap a value that may come in { '#text': '...', '@_attr': '...' } form from fast-xml-parser. */
function textNode(v: any): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v['#text']) return v['#text']
  return undefined
}

function extractLinkFromObj(link: any): string | undefined {
  if (!link) return undefined
  // Array of link objects
  if (Array.isArray(link)) {
    for (const l of link) {
      if (typeof l === 'object' && l['@_rel'] === 'alternate') return l['@_href']
    }
    const first = link[0]
    if (typeof first === 'object') return first['@_href'] || textNode(first)
    return textNode(first)
  }
  if (typeof link === 'object') return link['@_href'] || textNode(link)
  if (typeof link === 'string') return link
  return undefined
}

/** Resursively search for text across nested objects (Atom content often nests HTML). */
function deepestText(v: any): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    // Div / p / etc. holding text inside Atom content
    if (v['#text']) return v['#text']
    for (const key of Object.keys(v)) {
      if (key.startsWith('@_')) continue
      const child = deepestText(v[key])
      if (child) return child
    }
  }
  return undefined
}

export async function parseRSS(url: string): Promise<RssFeed> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(10_000),
  })
  const xml = await res.text()

  let root: any
  let feedTitle: string | undefined

  try {
    root = parseXml(xml)
  } catch {
    // XML parse failure — fall back to the old regex approach
    return fallbackParse(xml)
  }

  const items: RssItem[] = []

  // Detect RSS 2.0 vs Atom
  const rss = root?.rss
  const feed = root?.feed

  if (rss?.channel) {
    // ─── RSS 2.0 ───
    const channel = rss.channel
    feedTitle = textNode(channel?.title)

    const rawItems: any[] = (channel?.item as any) || []
    if (!Array.isArray(rawItems)) (rawItems as any[]).length = 0

    for (const entry of rawItems) {
      if (!entry) continue
      const item: RssItem = {}

      item.title = textNode(entry.title)

      // Link: <link href=""> (RSS 2.0 with namespaces) or <link>text</link>
      if (entry.link) {
        if (typeof entry.link === 'string') {
          item.link = entry.link
        } else if (typeof entry.link === 'object') {
          item.link = entry.link['@_href'] || textNode(entry.link)
        }
      }

      // Description
      const desc = textNode(entry.description)
      if (desc) {
        const isHn = /^Article URL:\s*\S+\s+Comments URL:/.test(desc)
        item.contentSnippet = isHn ? '' : desc.replace(/<[^>]+>/g, '').trim().slice(0, 2000)
      }

      // content:encoded
      const encoded = entry['content:encoded'] || entry.content_encoded
      if (encoded) {
        const raw = textNode(encoded) || deepestText(encoded)
        if (raw) item.content = raw.slice(0, 2000)
      }

      // Dates
      const pubDate = textNode(entry.pubDate)
      if (pubDate) item.isoDate = toIsoDate(pubDate)

      // Media content
      const mc = entry['media:content'] || entry.media_content
      if (mc) {
        if (Array.isArray(mc)) {
          for (const m of mc) {
            if (m['@_url']) { item.mediaContent = m['@_url']; break }
          }
        } else if (mc['@_url']) {
          item.mediaContent = mc['@_url']
        }
      }

      const mt = entry['media:thumbnail'] || entry.media_thumbnail
      if (mt) {
        if (Array.isArray(mt)) {
          for (const m of mt) {
            if (m['@_url']) { item.mediaThumbnail = m['@_url']; break }
          }
        } else if (mt['@_url']) {
          item.mediaThumbnail = mt['@_url']
        }
      }

      // Enclosure
      if (entry.enclosure) {
        if (Array.isArray(entry.enclosure)) {
          const e = entry.enclosure[0]
          item.enclosureUrl = e['@_url']
          item.enclosureType = e['@_type']
        } else {
          item.enclosureUrl = entry.enclosure['@_url']
          item.enclosureType = entry.enclosure['@_type']
        }
      }

      if (item.title || item.link) items.push(item)
    }
  } else if (feed) {
    // ─── Atom ───
    feedTitle = textNode(feed.title)

    const rawItems: any[] = (feed.entry as any) || []
    if (!Array.isArray(rawItems)) (rawItems as any[]).length = 0

    for (const entry of rawItems) {
      if (!entry) continue
      const item: RssItem = {}

      item.title = textNode(entry.title)

      // Link: <link href="..." />
      item.link = extractLinkFromObj(entry.link)

      // Summary / content
      const summary = entry.summary
      if (summary) {
        const raw = textNode(summary)
        item.contentSnippet = raw ? raw.replace(/<[^>]+>/g, '').trim().slice(0, 2000) : undefined
      }

      const content = entry.content
      if (content) {
        const raw = deepestText(content) || textNode(content) || (typeof content === 'string' ? content : undefined)
        if (raw) item.content = raw.slice(0, 2000)
      }

      // Dates
      const updated = textNode(entry.updated)
      const published = textNode(entry.published)
      if (published) item.isoDate = toIsoDate(published)
      else if (updated) item.isoDate = toIsoDate(updated)

      // Media content (Atom uses <media:content> or <link rel="enclosure">)
      const mc = entry['media:content'] || entry.media_content
      if (mc) {
        if (Array.isArray(mc)) {
          for (const m of mc) {
            if (m['@_url']) { item.mediaContent = m['@_url']; break }
          }
        } else if (mc['@_url']) {
          item.mediaContent = mc['@_url']
        }
      }

      // Atom <link rel="enclosure"> for images
      if (!item.mediaContent && entry.link && Array.isArray(entry.link)) {
        for (const l of entry.link) {
          if (l['@_rel'] === 'enclosure' && l['@_type']?.startsWith('image')) {
            item.mediaContent = l['@_href']
            break
          }
        }
      }

      // <media:thumbnail>
      const mt = entry['media:thumbnail'] || entry.media_thumbnail
      if (mt) {
        if (Array.isArray(mt)) {
          for (const m of mt) {
            if (m['@_url']) { item.mediaThumbnail = m['@_url']; break }
          }
        } else if (mt['@_url']) {
          item.mediaThumbnail = mt['@_url']
        }
      }

      if (item.title || item.link) items.push(item)
    }
  }

  return { items, feedTitle }
}

/**
 * Fallback regex-based parser used when the XML parser throws.
 * Preserved from the original implementation for edge-case feeds.
 */
async function fallbackParse(xml: string): Promise<RssFeed> {
  if (!xml.trim()) return { items: [] }

  const items: RssItem[] = []

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

    // Description
    const desc = extractField(block, 'description')
    if (desc) {
      const text = desc.replace(/<[^>]+>/g, '').trim()
      item.contentSnippet = /^Article URL:\s*\S+\s+Comments URL:/.test(text) ? '' : text.slice(0, 2000)
    }

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

function extractField(block: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
  let m = block.match(cdata)
  if (m) return decodeEntities(m[1]).trim()

  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  m = block.match(plain)
  return m ? decodeEntities(m[1]).trim() : undefined
}
