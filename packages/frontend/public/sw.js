// 简讯 Service Worker — 性能优化 + 离线策略
// 版本递增强制更新缓存
var CACHE = 'jianxun-v2'
var STATIC_CACHE = 'jianxun-static-v2'
var API_CACHE = 'jianxun-api-v2'

// 预缓存：首页、图标、核心样式（构建后生成，手动维护关键资源）
var PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.svg',
]

// 需要缓存的 API 路径规则
var API_PATTERNS = [
  '/api/news?',
  '/api/news/trending',
  '/api/news/topics',
  '/api/news/categories',
]

self.addEventListener('install', function(e) {
  self.skipWaiting()
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(c) { return c.addAll(PRECACHE_URLS).catch(function(){}) })
  )
})

self.addEventListener('activate', function(e) {
  // 清除旧版本缓存
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== STATIC_CACHE && k !== API_CACHE && k !== CACHE })
          .map(function(k) { return caches.delete(k) })
      )
    }).then(function() { return clients.claim() })
  )
})

function shouldCacheAPI(url) {
  var path = url.pathname + (url.search || '')
  return API_PATTERNS.some(function(p) { return path.indexOf(p) >= 0 })
}

function isSameOrigin(url) {
  return url.origin === location.origin
}

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url)

  // ── 非本域请求直接透传 ──
  if (!isSameOrigin(url)) return

  // ── API 请求：网络优先，超时降级到缓存 ──
  if (shouldCacheAPI(url)) {
    e.respondWith(apiStrategy(e.request))
    return
  }

  // ── 静态资源（JS/CSS/字体/Build产物）：缓存优先 ──
  if (url.pathname.match(/\/assets\//) || url.pathname.match(/\.(js|css|woff2?|svg|png|jpg)$/)) {
    e.respondWith(staticStrategy(e.request))
    return
  }

  // ── 页面/其他：网络优先，离线时缓存兜底 ──
  e.respondWith(networkFirst(e.request))
})

// 命中缓存后立即返回，后台异步更新（适用于静态资源）
async function staticStrategy(req) {
  var cached = await caches.match(req)
  if (cached) return cached
  var res = await fetch(req)
  if (res.ok) {
    var clone = res.clone()
    caches.open(CACHE).then(function(c) { c.put(req, clone) })
  }
  return res
}

// 先请求网络，超时或失败时返回缓存（适用于 API/页面）
async function networkFirst(req) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(reject, 3000) // 3秒超时
  })
  try {
    var res = await Promise.race([fetch(req), timeout])
    if (res && res.ok) {
      var clone = res.clone()
      caches.open(API_CACHE).then(function(c) { c.put(req, clone) })
    }
    return res || fallbackResponse()
  } catch (e) {
    var cached = await caches.match(req)
    return cached || fallbackResponse()
  }
}

// API响应：同 networkFirst，但离线时返回空数据而非错误
async function apiStrategy(req) {
  try {
    var res = await fetch(req, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      var clone = res.clone()
      caches.open(API_CACHE).then(function(c) { c.put(req, clone) })
    }
    return res
  } catch (e) {
    var cached = await caches.match(req)
    if (cached) return cached
    // 离线 + 无缓存时返回空数据
    return new Response(JSON.stringify({ items: [] }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

function fallbackResponse() {
  return new Response('<html><body><p>简讯 offline</p></body></html>', {
    headers: { 'Content-Type': 'text/html;charset=utf-8' }
  })
}
