import { useState, useEffect, useCallback } from 'react'

export type ViewName = 'briefing' | 'feed' | 'topics' | 'entity' | 'search' | 'research' | 'digest' | 'topic' | 'sources' | 'weekly' | 'narratives' | 'narrative' | 'trending' | 'sectors' | 'insights' | 'ideas'

export interface Route {
  view: ViewName
  cat?: string
  entity?: string
  q?: string
  research?: string
  /** 话题深挖：#/topic/:name（keyword） */
  topic?: string
  /** 历史日报：#/digest/:date（YYYY-MM-DD） */
  date?: string
  /** 叙事详情：#/narrative/:keyword */
  narrative?: string
  /** 详情覆盖层：#/news/:id */
  newsId: number | null
}

const DEFAULT_ROUTE: Route = { view: 'briefing', newsId: null }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [pathPart, queryPart] = raw.split('?')
  const params = new URLSearchParams(queryPart || '')
  const segs = pathPart.split('/').filter(Boolean)

  if (segs.length === 0) return DEFAULT_ROUTE

  switch (segs[0]) {
    case 'feed':
      return { view: 'feed', cat: params.get('cat') || undefined, newsId: null }
    case 'topics':
      return { view: 'topics', newsId: null }
    case 'entity':
      return segs[1] ? { view: 'entity', entity: decodeURIComponent(segs[1]), newsId: null } : DEFAULT_ROUTE
    case 'search':
      return { view: 'search', q: params.get('q') || '', newsId: null }
    case 'research':
      return { view: 'research', research: params.get('q') || '', newsId: null }
    case 'weekly':
      return { view: 'weekly', newsId: null }
    case 'sectors':
      return { view: 'sectors', newsId: null }
    case 'digest':
      return segs[1] && /^\d{4}-\d{2}-\d{2}$/.test(segs[1])
        ? { view: 'digest', date: segs[1], newsId: null }
        : DEFAULT_ROUTE
    case 'topic':
      return segs[1] ? { view: 'topic', topic: decodeURIComponent(segs[1]), newsId: null } : DEFAULT_ROUTE
    case 'trending':
      return { view: 'trending', newsId: null }
    case 'narratives':
      return { view: 'narratives', newsId: null }
    case 'narrative': {
      if (!segs[1]) return DEFAULT_ROUTE
      const kwMatch = hash.match(/[?&]kw=([^&]+)/)
      const kw = kwMatch ? decodeURIComponent(kwMatch[1]) : null
      return { view: 'narrative', narrative: kw || decodeURIComponent(segs[1]), newsId: null }
    }
    case 'sources':
      return { view: 'sources', newsId: null }
    case 'insights':
      return { view: 'insights', newsId: null }
    case 'ideas':
      return { view: 'ideas', newsId: null }
    case 'news': {
      // Only accept strictly numeric IDs — reject hex/exp notation
      const id = /^\d+$/.test(segs[1]) ? Number(segs[1]) : NaN
      return Number.isFinite(id) && id > 0 ? { view: 'briefing', newsId: id } : DEFAULT_ROUTE
    }
    default:
      return DEFAULT_ROUTE
  }
}

export function buildHash(r: { view: ViewName; cat?: string; entity?: string; q?: string; research?: string; topic?: string; date?: string; narrative?: string }): string {
  switch (r.view) {
    case 'feed':
      return `#/feed${r.cat && r.cat !== '全部' ? `?cat=${encodeURIComponent(r.cat)}` : ''}`
    case 'topics':
      return '#/topics'
    case 'entity':
      return `#/entity/${encodeURIComponent(r.entity || '')}`
    case 'search':
      return `#/search?q=${encodeURIComponent(r.q || '')}`
    case 'research':
      return `#/research?q=${encodeURIComponent(r.research || '')}`
    case 'weekly':
      return '#/weekly'
    case 'sectors':
      return '#/sectors'
    case 'digest':
      return `#/digest/${r.date || ''}`
    case 'topic':
      return `#/topic/${encodeURIComponent(r.topic || '')}`
    case 'trending':
      return '#/trending'
    case 'narratives':
      return '#/narratives'
    case 'narrative':
      return `#/narrative/${encodeURIComponent(r.narrative || '')}`
    case 'sources':
      return '#/sources'
    case 'insights':
      return '#/insights'
    case 'ideas':
      return '#/ideas'
    default:
      return '#/'
  }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

/** push 一条 hash 历史；replace 时不触发原生 hashchange，手动派发事件同步 route */
export function useNavigate() {
  return useCallback((hash: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + hash)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      return
    }
    if (window.location.hash === hash) return
    window.location.hash = hash
  }, [])
}
