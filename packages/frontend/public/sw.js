// 简讯 Service Worker v4 — 离线缓存 + 弱网检测
var STATIC_CACHE = 'jianxun-static-v4'
var API_CACHE = 'jianxun-api-v4'
var PRECACHE = ['/', '/manifest.json', '/icon-192.svg']

// 限制 API 缓存条目数，防止无限膨胀
var MAX_API_CACHE = 200

self.addEventListener('install', function(e) {
  self.skipWaiting()
  e.waitUntil(caches.open(STATIC_CACHE).then(function(c) { return c.addAll(PRECACHE).catch(function(){}) }))
})

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== STATIC_CACHE && k !== API_CACHE }).map(function(k) { return caches.delete(k) }))
    }).then(function() { return clients.claim() })
  )
})

function isSameOrigin(url) { return url.origin === location.origin }
function isAPI(url) { return url.pathname.indexOf('/api/') === 0 }
function isStatic(url) { return url.pathname.match(/\/assets\//) || url.pathname.match(/\.(js|css|woff2?|svg|png|jpg)$/) }

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url)
  if (!isSameOrigin(url)) return

  if (isStatic(url)) { e.respondWith(staticFirst(e.request)); return }
  if (isAPI(url)) { e.respondWith(apiWithCache(e.request)); return }
  e.respondWith(networkWithFallback(e.request))
})

// ── 静态资源：缓存优先 ──
async function staticFirst(req) {
  var cached = await caches.match(req)
  if (cached) return cached
  try {
    var res = await fetch(req)
    if (res.ok) { var clone = res.clone(); caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) }) }
    return res
  } catch(e) { return cached || new Response('', { status: 408 }) }
}

// ── API：有缓存秒回，没缓存正常请求 ──
async function apiWithCache(req) {
  var cache = await caches.open(API_CACHE)
  // 超量清理（最旧淘汰）
  var keys = await cache.keys()
  if (keys.length > MAX_API_CACHE) {
    cache.delete(keys[0]).catch(function(){})
  }

  var cached = await cache.match(req)
  if (cached) {
    // 后台更新缓存
    fetch(req).then(function(res) {
      if (res && res.ok) { cache.put(req, res.clone()); notifyPages('SW_UPDATE') }
    }).catch(function() {})
    return cached
  }

  try {
    var res = await fetch(req)
    if (res && res.ok) { var clone = res.clone(); cache.put(req, clone) }
    return res || fallbackJSON()
  } catch(e) {
    // 没缓存+网络失败 → 页面显示"离线"提示
    notifyPages('SW_OFFLINE')
    return fallbackJSON()
  }
}

// ── 页面：先网络，离线用缓存 ──
async function networkWithFallback(req) {
  try {
    var res = await fetch(req)
    if (res && res.ok) { var clone = res.clone(); caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) }) }
    return res
  } catch(e) {
    notifyPages('SW_OFFLINE')
    return (await caches.match(req)) || new Response('简讯 offline', { status: 503 })
  }
}

function notifyPages(type) {
  self.clients.matchAll().then(function(clients) {
    clients.forEach(function(c) { c.postMessage({ type: type }) })
  })
}

function fallbackJSON() {
  return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } })
}
