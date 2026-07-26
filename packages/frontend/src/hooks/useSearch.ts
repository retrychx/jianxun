import { useState, useEffect, useRef } from 'react'
import type { NewsItem } from '../api'
import { searchNews } from '../api'

export function useSearch() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NewsItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const searchSeq = useRef(0)

  // 监听 lastViewHashRef 更新（保留给外部使用）
  const lastViewHashRef = useRef('#/')
  const searchNavRef = useRef(false)

  // Search: 300ms debounce + 请求序号防竞态
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      searchSeq.current++
      setSearchResults([])
      setSearchError(false)
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      try {
        const res = await searchNews(q)
        if (seq !== searchSeq.current) return
        setSearchResults(res.items)
        setSearchError(false)
      } catch {
        if (seq !== searchSeq.current) return
        setSearchResults([])
        setSearchError(true)
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  return {
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    searching, setSearching,
    searchError, setSearchError,
    searchNavRef, lastViewHashRef,
  }
}
