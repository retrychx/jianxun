import { useState, useEffect, useCallback } from 'react'

export interface FollowItem {
  id: string
  name: string
  type: 'entity' | 'category' | 'source'
  addedAt: string
}

const STORAGE_KEY = 'jianxun_follows'

function loadFollows(): FollowItem[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

function saveFollows(items: FollowItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useFollow() {
  const [follows, setFollows] = useState<FollowItem[]>(loadFollows)

  useEffect(() => {
    saveFollows(follows)
  }, [follows])

  const isFollowing = useCallback((id: string) => {
    return follows.some(f => f.id === id)
  }, [follows])

  const toggleFollow = useCallback((name: string, type: FollowItem['type']) => {
    const id = `${type}:${name}`
    setFollows(prev => {
      const exists = prev.find(f => f.id === id)
      if (exists) return prev.filter(f => f.id !== id)
      return [...prev, { id, name, type, addedAt: new Date().toISOString() }]
    })
  }, [])

  const getFollowed = useCallback((type?: FollowItem['type']) => {
    return type ? follows.filter(f => f.type === type) : follows
  }, [follows])

  const followedNames = useCallback((type?: FollowItem['type']) => {
    const items = type ? follows.filter(f => f.type === type) : follows
    return items.map(f => f.name)
  }, [follows])

  return { follows, isFollowing, toggleFollow, getFollowed, followedNames }
}
