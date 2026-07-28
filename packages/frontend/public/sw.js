// 简讯 Service Worker v3 — 稳优先，缓存在其次
var STATIC_CACHE = 'jianxun-static-v3'
var API_CACHE = 'jianxun-api-v3'
var PRECACHE = ['/', '/manifest.json', '/icon-192.svg']

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

  // 静态资源：缓存优先，不等待网络
  if (isStatic(url)) { e.respondWith(staticFirst(e.request)); return }

  // API 请求：有缓存则缓存优先+后台刷新，无缓存则正常请求
  if (isAPI(url)) { e.respondWith(apiWithCache(e.request)); return }

  // 页面/其他：正常请求，离线时返回缓存
  e.respondWith(networkWithFallback(e.request))
})

// ── 静态资源：缓存优先 ──
async function staticFirst(req) {
  var cached = await caches.match(req)
  if (cached) return cached
  var res = await fetch(req)
  if (res.ok) { var clone = res.clone(); caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) }) }
  return res
}

// ── API：有缓存则极速返回，后台更新；没缓存则正常请求，成功后才缓存 ──
async function apiWithCache(req) {
  var cache = await caches.open(API_CACHE)
  var cached = await cache.match(req)

  // 有缓存 → 立即返回，后台偷偷刷新
  if (cached) {
    fetch(req).then(function(res) {
      if (res && res.ok) { cache.put(req, res.clone()); notifyClients() }
    }).catch(function() { /* 静默失败，下次继续用缓存 */ })
    return cached
  }

  // 没缓存 → 正常网络请求，成功才缓存
  try {
    var res = await fetch(req)
    if (res.ok) { var clone = res.clone(); cache.put(req, clone) }
    return res
  } catch(e) {
    return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } })
  }
}

// ── 页面/其他：正常请求，离线时用缓存兜底 ──
async function networkWithFallback(req) {
  try {
    var res = await fetch(req)
    if (res && res.ok) { var clone = res.clone(); caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) }) }
    return res
  } catch(e) {
    return (await caches.match(req)) || new Response('简讯 offline', { status: 503 })
  }
}

function notifyClients() {
  self.clients.matchAll().then(function(clients) {
    clients.forEach(function(c) { c.postMessage({ type: 'SW_UPDATE' }) })
  })
}
