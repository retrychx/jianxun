// 简讯 Service Worker — 性能优化 + 无感刷新
var CACHE = 'jianxun-v2'
var STATIC_CACHE = 'jianxun-static-v2'
var API_CACHE = 'jianxun-api-v2'

var PRECACHE_URLS = ['/', '/manifest.json', '/icon-192.svg']
var API_PATTERNS = ['/api/news?', '/api/news/trending', '/api/news/topics', '/api/news/categories']

self.addEventListener('install', function(e) {
  self.skipWaiting()
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(c) { return c.addAll(PRECACHE_URLS).catch(function(){}) })
  )
})

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== STATIC_CACHE && k !== API_CACHE && k !== CACHE }).map(function(k) { return caches.delete(k) }))
    }).then(function() { return clients.claim() })
  )
})

function isSameOrigin(url) { return url.origin === location.origin }
function isAPI(url) { return API_PATTERNS.some(function(p) { return (url.pathname + url.search).indexOf(p) >= 0 }) }
function isStatic(url) { return url.pathname.match(/\/assets\//) || url.pathname.match(/\.(js|css|woff2?|svg|png|jpg)$/) }

// 通知所有页面有新数据
function notifyClients(data) {
  self.clients.matchAll().then(function(clients) {
    clients.forEach(function(c) { c.postMessage({ type: 'SW_UPDATE', data: data }) })
  })
}

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url)
  if (!isSameOrigin(url)) return

  if (isAPI(url)) {
    // API：stale-while-revalidate → 秒出缓存，后台静默更新
    e.respondWith(staleWhileRevalidate(e.request, url))
  } else if (isStatic(url)) {
    e.respondWith(cacheFirst(e.request))
  } else {
    e.respondWith(networkFirst(e.request))
  }
})

// ── 缓存优先（静态资源） ──
async function cacheFirst(req) {
  var cached = await caches.match(req)
  if (cached) return cached
  var res = await fetch(req)
  if (res.ok) { var clone = res.clone(); caches.open(CACHE).then(function(c) { c.put(req, clone) }) }
  return res
}

// ── 网络优先（页面/其他） ──
async function networkFirst(req) {
  try {
    var res = await Promise.race([fetch(req), new Promise(function(_, reject) { setTimeout(reject, 3000) })])
    if (res && res.ok) { var clone = res.clone(); caches.open(CACHE).then(function(c) { c.put(req, clone) }) }
    return res || fallback()
  } catch (e) {
    return (await caches.match(req)) || fallback()
  }
}

// ── Stale-While-Revalidate（API：秒出缓存→后台刷新→通知页面） ──
async function staleWhileRevalidate(req, url) {
  var cache = await caches.open(API_CACHE)
  var cached = await cache.match(req)

  // 立即返回缓存（如果有）
  var response = cached || new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } })

  // 后台发起网络请求，不阻塞页面渲染
  var fetchPromise = fetchWithTimeout(req, 5000).then(function(res) {
    if (res && res.ok) {
      cache.put(req, res.clone())
      // 通知页面有新数据（仅内容类 API）
      notifyClients({ url: url.pathname + url.search, type: 'api' })
    }
    return res
  }).catch(function() {})

  // 如果没缓存，等待网络（首次加载）；有缓存则直接返回
  if (!cached) {
    try { response = await fetchPromise } catch(e) {}
  } else {
    // 不等待后台 fetch 完成
    fetchPromise
  }

  return response
}

async function fetchWithTimeout(req, ms) {
  try { return await fetch(req, { signal: AbortSignal.timeout(ms) }) } catch(e) { return null }
}

function fallback() {
  return new Response('<html><body><p>简讯 offline</p></body></html>', { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
}
