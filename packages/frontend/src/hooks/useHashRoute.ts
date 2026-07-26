import { useState, useEffect, useCallback } from 'react'

export type ViewName = 'briefing' | 'feed' | 'topics' | 'entity' | 'search' | 'digest' | 'topic' | 'sources'

export interface Route {
  view: ViewName
  cat?: string
  entity?: string
  q?: string
  /** 话题深挖：#/topic/:name（keyword） */
  topic?: string
  /** 历史日报：#/digest/:date（YYYY-MM-DD） */
  date?: string
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
    case 'digest':
      return segs[1] && /^\d{4}-\d{2}-\d{2}$/.test(segs[1])
        ? { view: 'digest', date: segs[1], newsId: null }
        : DEFAULT_ROUTE
    case 'topic':
      return segs[1] ? { view: 'topic', topic: decodeURIComponent(segs[1]), newsId: null } : DEFAULT_ROUTE
    case 'sources':
      return { view: 'sources', newsId: null }
    case 'news': {
      const id = Number(segs[1])
      // 刷新/分享直达：回到默认视图（日报）并打开面板
      return Number.isFinite(id) && id > 0 ? { view: 'briefing', newsId: id } : DEFAULT_ROUTE
    }
    default:
      return DEFAULT_ROUTE
  }
}

export function buildHash(r: { view: ViewName; cat?: string; entity?: string; q?: string; topic?: string; date?: string }): string {
  switch (r.view) {
    case 'feed':
      return `#/feed${r.cat && r.cat !== '全部' ? `?cat=${encodeURIComponent(r.cat)}` : ''}`
    case 'topics':
      return '#/topics'
    case 'entity':
      return `#/entity/${encodeURIComponent(r.entity || '')}`
    case 'search':
      return `#/search?q=${encodeURIComponent(r.q || '')}`
    case 'digest':
      return `#/digest/${r.date || ''}`
    case 'topic':
      return `#/topic/${encodeURIComponent(r.topic || '')}`
    case 'sources':
      return '#/sources'
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

/** push 一条 hash 历史；replace 时不触发 hashchange（用于搜索输入中同步 URL） */
export function useNavigate() {
  return useCallback((hash: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + hash)
      return
    }
    if (window.location.hash === hash) return
    window.location.hash = hash
  }, [])
}
