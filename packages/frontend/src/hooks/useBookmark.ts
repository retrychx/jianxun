/**
 * 书签/稍后读 — localStorage 持久化
 */
const STORAGE_KEY = 'jianxun_bookmarks'

export interface Bookmark {
  id: number
  title: string
  source: string
  url: string
  savedAt: string
}

export function getBookmarks(): Bookmark[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { return [] }
}

export function addBookmark(item: { id: number; title: string; source: string; url: string }): void {
  const bookmarks = getBookmarks().filter(b => b.id !== item.id)
  bookmarks.unshift({ ...item, savedAt: new Date().toISOString() })
  if (bookmarks.length > 50) bookmarks.pop()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks))
}

export function removeBookmark(id: number): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getBookmarks().filter(b => b.id !== id)))
}

export function isBookmarked(id: number): boolean {
  return getBookmarks().some(b => b.id === id)
}
