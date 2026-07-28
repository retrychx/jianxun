/**
 * Reading continuity tracker — localStorage-based.
 * Tracks when user last viewed narratives/articles.
 */
const STORAGE_KEY = 'jianxun_read_tracker'

interface ReadState {
  narratives: Record<string, string>  // keyword → last viewed ISO timestamp
  articles: Record<number, string>    // id → last viewed ISO timestamp
}

function load(): ReadState {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) return JSON.parse(data)
  } catch {}
  return { narratives: {}, articles: {} }
}

function save(state: ReadState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

/** Mark a narrative as viewed now. */
export function markNarrativeViewed(keyword: string): void {
  const state = load()
  state.narratives[keyword] = new Date().toISOString()
  save(state)
}

/** Mark an article as viewed now. */
export function markArticleViewed(id: number): void {
  const state = load()
  state.articles[id] = new Date().toISOString()
  save(state)
}

/** Check if a narrative has new content since the user last viewed it. */
export function hasNarrativeUpdate(keyword: string, lastUpdated: string): boolean {
  const state = load()
  const lastViewed = state.narratives[keyword]
  if (!lastViewed) return true // never viewed = has updates
  return new Date(lastUpdated).getTime() > new Date(lastViewed).getTime()
}

/** Get the count of narratives with unseen updates. */
export function getNarrativeUpdateCount(narratives: { keyword: string; lastUpdated: string }[]): number {
  return narratives.filter(n => hasNarrativeUpdate(n.keyword, n.lastUpdated)).length
}
