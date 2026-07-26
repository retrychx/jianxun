/**
 * Edge cache helpers (Cache API).
 * Cache operations are best-effort: failures are silently caught.
 * Cache keys are scoped by a fake origin to avoid cross-project conflicts.
 */

export const CACHE_TTL = {
  list: 60, trending: 120, stats: 300, categories: 300, topics: 600, briefing: 300, detail: 3600,
  digest: 600, digests: 600, topic: 600, sources: 300, weekly: 3600, ask: 3600,
}

const cacheReq = (key: string) => new Request(`https://jianxun-cache.internal/${encodeURIComponent(key)}`)

// DOM lib 的 caches: CacheStorage 没有 default，运行时 Workers 保证存在
const edgeCache = () => (caches as unknown as { default: Cache }).default

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const res = await edgeCache().match(cacheReq(key))
    return res ? ((await res.json()) as T) : null
  } catch { return null }
}

export async function cacheSet(key: string, data: any, ttl: number) {
  try {
    await edgeCache().put(cacheReq(key), new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
    }))
  } catch {}
}

export async function cacheDelete(key: string) {
  try { await edgeCache().delete(cacheReq(key)) } catch {}
}

// ─── SSE event signaling (Cache API as lightweight pub/sub) ───
// Signal an event that SSE clients can poll.  Returns an opaque "since"
// value the caller can store and pass to pollEvent to only get newer events.
export async function signalEvent(type: string, data: any): Promise<number> {
  const ts = Date.now()
  try {
    const payload = { type, data, ts }
    await edgeCache().put(cacheReq(`evt:${type}`), new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
    }))
  } catch { /* best-effort */ }
  return ts
}

// Check for a cached event newer than `sinceTs`.  Returns the event or null.
export async function pollEvent<T>(type: string, sinceTs: number): Promise<{ ts: number; data: T } | null> {
  try {
    const res = await edgeCache().match(cacheReq(`evt:${type}`))
    if (!res) return null
    const payload = await res.json() as any
    return payload.ts > sinceTs ? { ts: payload.ts, data: payload.data as T } : null
  } catch { return null }
}
