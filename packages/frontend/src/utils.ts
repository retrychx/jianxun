export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const time = formatTime(d)
  if (d.toDateString() === now.toDateString()) return time
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ` ${time}`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) + ` ${time}`
}

export function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function decodeEntities(s: string): string {
  // 先替换常见命名实体
  let r = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // 替换所有 &#数字; 实体（如 &#8217; → '）
  r = r.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n)))
  return r
}

export type Lang = 'zh' | 'en'

/** 中文模式优先显示译题，无译文回退原文；EN 始终原文 */
export function displayTitle(item: { title: string; titleZh?: string | null }, lang: Lang): string {
  return decodeEntities(lang === 'zh' && item.titleZh ? item.titleZh : item.title)
}

export function displaySummary(item: { summary: string | null; summaryZh?: string | null }, lang: Lang): string | null {
  const s = lang === 'zh' && item.summaryZh ? item.summaryZh : item.summary
  return s ? decodeEntities(s) : null
}

/** 'YYYY-MM-DD' → '2026年7月26日 星期日'（按本地时区构造，避免 UTC 解析偏一天） */
export function formatDigestDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  if (Number.isNaN(date.getTime())) return dateStr
  const day = date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const weekday = date.toLocaleDateString('zh-CN', { weekday: 'long' })
  return `${day} ${weekday}`
}

/** 标题或 entities（原始 JSON 字符串）包含任一关注实体名（大小写不敏感） */
export function matchesFollow(item: { title: string; entities?: string | null }, followedNames: string[]): boolean {
  if (!followedNames.length) return false
  const hay = `${item.title} ${item.entities || ''}`.toLowerCase()
  return followedNames.some(n => n && hay.includes(n.toLowerCase()))
}

/** 关注加权：匹配的条目稳定置顶，组内与其余条目都保持原顺序 */
export function boostFollowed<T extends { title: string; entities?: string | null }>(items: T[], followedNames: string[]): T[] {
  if (!followedNames.length || !items.length) return items
  const hit = items.filter(it => matchesFollow(it, followedNames))
  if (!hit.length || hit.length === items.length) return items
  return [...hit, ...items.filter(it => !matchesFollow(it, followedNames))]
}
