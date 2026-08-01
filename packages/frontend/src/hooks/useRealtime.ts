import { useEffect, useRef, useState } from 'react'

interface Props {
  loadAll: () => Promise<void>
  loadStats: () => Promise<void>
  loadDigestDates: () => Promise<void>
  loadNews: (cat: string, page?: number, append?: boolean) => Promise<void>
  /** 当前视图 + feed 分类（供 SSE 判断是否刷新列表） */
  feedState: { view: string; cat: string }
  showToast: (t: string) => void
  notifyBrowser: (title: string, body: string, url?: string) => void
}

const SW_VERSION_KEY = 'sw_version_seen'

/**
 * 实时事件：SSE（新文章/突发/叙事更新/争议）+ Service Worker 消息
 * （无感刷新 / 离线提示 / 版本检测）。从 App.tsx 抽出以减轻巨石组件。
 */
export function useRealtime({ loadAll, loadStats, loadDigestDates, loadNews, feedState, showToast, notifyBrowser }: Props) {
  const [isOffline, setIsOffline] = useState(false)
  const [showUpdate, setShowUpdate] = useState(false)
  const [sseEpoch, setSseEpoch] = useState(0)

  // 用 ref 包住回调，SSE/SW 监听器不重新订阅也能读到最新值（避免闭包过期）
  const handlers = useRef({ loadAll, loadStats, loadDigestDates, loadNews, feedState, showToast, notifyBrowser })
  handlers.current = { loadAll, loadStats, loadDigestDates, loadNews, feedState, showToast, notifyBrowser }

  // ─── SSE: 实时推送 ───
  useEffect(() => {
    const es = new EventSource('/api/events')
    let reconnectTimer: number | null = null
    const h = handlers.current

    es.addEventListener('new-articles', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        h.showToast(`收到 ${data.count ?? 0} 篇新文章，已更新`)
      } catch {}
      h.loadAll().catch(() => {})
      h.loadStats().catch(() => {})
      h.loadDigestDates().catch(() => {})
      // 若用户正停留在 feed 视图，顺手刷新列表，让"已更新"提示名副其实
      if (h.feedState.view === 'feed') {
        h.loadNews(h.feedState.cat, 1, false).catch(() => {})
      }
    })

    es.addEventListener('breaking', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        h.showToast(`🔴 突发: ${data.title || ''}（${(data.sources || []).join('/')}）`)
        h.notifyBrowser('🔴 突发新闻', `${data.title || ''} - ${(data.sources || []).join('/')}`, `#/news/${data.articleId || ''}`)
      } catch {}
      h.loadAll().catch(() => {})
    })

    es.addEventListener('narrative-update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        h.showToast(`📖 ${data.label || ''}: ${data.text || ''}`)
        h.notifyBrowser('📖 叙事更新', `${data.label || ''}: ${(data.text || '').slice(0, 80)}`, `#/narrative/${encodeURIComponent(data.keyword || '')}`)
      } catch {}
      h.loadAll().catch(() => {})
    })

    es.addEventListener('debate', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        h.showToast(`⚡ 争议: ${data.topic || ''}`)
        h.notifyBrowser('⚡ 争议话题', data.topic || '')
      } catch {}
      h.loadAll().catch(() => {})
    })

    es.onerror = () => {
      es.close()
      reconnectTimer = window.setTimeout(() => setSseEpoch(e => e + 1), 15_000)
    }

    return () => {
      es.close()
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    }
  }, [sseEpoch])

  // ─── SW 消息：无感刷新 + 离线提示 + 版本检测 ───
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SW_UPDATE') {
        handlers.current.loadAll().catch(() => {})
        handlers.current.loadStats().catch(() => {})
        handlers.current.loadDigestDates().catch(() => {})
      } else if (e.data?.type === 'SW_OFFLINE') {
        setIsOffline(true)
      } else if (e.data?.type === 'VERSION') {
        // 与上次见过的版本比较，不硬编码版本号（否则发布时漏改一处就永久失效）
        const v = String(e.data.version || '')
        const seen = localStorage.getItem(SW_VERSION_KEY)
        if (seen !== null && seen !== v) setShowUpdate(true)
        localStorage.setItem(SW_VERSION_KEY, v)
      }
    }
    const onlineHandler = () => setIsOffline(false)
    const offlineHandler = () => setIsOffline(true)
    const controllerChanged = () => navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' })
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    navigator.serviceWorker?.addEventListener('message', handler)
    navigator.serviceWorker?.addEventListener('controllerchange', controllerChanged)
    navigator.serviceWorker?.controller?.postMessage({ type: 'GET_VERSION' })
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handler)
      navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged)
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
    }
  }, [])

  return { isOffline, showUpdate }
}
