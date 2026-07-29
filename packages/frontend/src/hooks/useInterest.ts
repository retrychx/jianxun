/**
 * 用户兴趣模型 — 基于 localStorage 的隐式信号追踪
 * 比 follows 更细粒度：记录每次点击实体，自动衰减旧兴趣
 */
const STORAGE_KEY = 'jianxun_interests'

interface Interest {
  entity: string
  score: number
  lastSeen: number
}

function load(): Interest[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function save(interests: Interest[]): void {
  // 只保留 top 20，衰减低分
  interests.sort((a, b) => b.score - a.score)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(interests.slice(0, 20)))
}

/** 记录一次实体点击 */
export function trackEntityClick(entity: string): void {
  const interests = load()
  const existing = interests.find(i => i.entity.toLowerCase() === entity.toLowerCase())
  if (existing) {
    existing.score = Math.min(10, existing.score + 1)
    existing.lastSeen = Date.now()
  } else {
    interests.push({ entity, score: 1, lastSeen: Date.now() })
  }
  save(interests)
}

/** 获取兴趣实体列表（score ≥ 2 的活跃兴趣） */
export function getActiveInterests(): string[] {
  const now = Date.now()
  return load()
    .filter(i => i.score >= 2 && (now - i.lastSeen) < 7 * 86400000) // 7天内活跃
    .sort((a, b) => b.score - a.score)
    .map(i => i.entity)
}

/** 检测文章是否匹配用户兴趣 */
export function matchesInterest(item: { title: string; entities?: string | null }, interests: string[]): boolean {
  if (!interests.length) return false
  const title = item.title.toLowerCase()
  for (const interest of interests) {
    if (title.includes(interest.toLowerCase())) return true
    if (item.entities) {
      try {
        const parsed = JSON.parse(item.entities)
        if (Array.isArray(parsed) && parsed.some((e: any) => e?.name?.toLowerCase().includes(interest.toLowerCase()))) return true
      } catch {}
    }
  }
  return false
}
