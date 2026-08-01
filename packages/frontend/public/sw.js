// 简讯 Service Worker v6 — 移动端兼容性优化 + 修复 SW_UPDATE 刷新反馈环
var STATIC_CACHE = 'jianxun-static-v6'
var API_CACHE = 'jianxun-api-v6'
var PRECACHE = ['/', '/manifest.json', '/icon-192.svg']

var MAX_API_CACHE = 100
var MAX_STATIC_CACHE = 30
var VERSION = '5.1.0'

// ═══ P0: AbortSignal.timeout() 兼容 iOS（手写超时） ═══
function fetchWithTimeout(url, opts, ms) {
  var controller = new AbortController()
  var timer = setTimeout(function() { controller.abort() }, ms)
  opts = opts || {}
  opts.signal = controller.signal
  return fetch(url, opts).finally(function() { clearTimeout(timer) })
}

self.addEventListener('install', function(e) {
  self.skipWaiting()
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(c) { return c.addAll(PRECACHE).catch(function(){}) })
  )
})

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== STATIC_CACHE && k !== API_CACHE })
          .map(function(k) { return caches.delete(k) })
      )
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

// ═══ P1: 缓存容量管理 ═══
async function evictOldest(cacheName, maxItems) {
  try {
    var cache = await caches.open(cacheName)
    var keys = await cache.keys()
    var toRemove = keys.length - maxItems
    if (toRemove > 0) {
      // 删除最旧的
      for (var i = 0; i < toRemove; i++) cache.delete(keys[i]).catch(function(){})
    }
    // 如果缓存仍在增长（配额警告），清理更多
    if (navigator.storage && navigator.storage.estimate) {
      var est = await navigator.storage.estimate()
      var usage = est.usage || 0
      var quota = est.quota || 0
      // 超过 80% 配额 → 清一半
      if (quota > 0 && usage / quota > 0.8) {
        var half = Math.ceil(keys.length / 2)
        for (var j = 0; j < half; j++) cache.delete(keys[j]).catch(function(){})
      }
    }
  } catch {}
}

// ═══ 静态资源：缓存优先 + 容量管理 ═══
async function staticFirst(req) {
  await evictOldest(STATIC_CACHE, MAX_STATIC_CACHE)
  var cached = await caches.match(req)
  if (cached) return cached
  try {
    var res = await fetch(req)
    if (res && res.ok) {
      var clone = res.clone()
      caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) })
    }
    return res
  } catch(e) { return cached || new Response('', { status: 408 }) }
}

// ═══ API：有缓存秒回 + 后台更新 + 容量管理 ═══
async function apiWithCache(req) {
  await evictOldest(API_CACHE, MAX_API_CACHE)
  var cache = await caches.open(API_CACHE)
  var cached = await cache.match(req)

  if (cached) {
    // 后台更新：内容真的变了才通知页面。
    // 否则「页面收到 SW_UPDATE → 重拉 API → 再次命中缓存分支 → 再次 SW_UPDATE」
    // 会形成每轮 4 倍膨胀的无界刷新反馈环。比较新旧响应内容，相同则不通知。
    fetchWithTimeout(req, null, 8000).then(function(res) {
      if (!res || !res.ok) return
      var newClone = res.clone()
      var oldClone = cached.clone()
      Promise.all([newClone.text(), oldClone.text()]).then(function(texts) {
        if (texts[0] !== texts[1]) {
          cache.put(req, res.clone()).catch(function(){})
          notifyPages('SW_UPDATE')
        }
      }).catch(function() {})
    }).catch(function() {})
    return cached
  }

  try {
    var res = await fetchWithTimeout(req, null, 8000)
    if (res && res.ok) { var clone = res.clone(); cache.put(req, clone) }
    return res || fallbackJSON()
  } catch(e) {
    // P2: 弱网不误报离线——只有确认无缓存时才报
    if (!cached) notifyPages('SW_OFFLINE')
    return fallbackJSON()
  }
}

// ═══ 页面：先网络，离线用缓存 ═══
async function networkWithFallback(req) {
  try {
    var res = await fetchWithTimeout(req, null, 8000)
    if (res && res.ok) { var clone = res.clone(); caches.open(STATIC_CACHE).then(function(c) { c.put(req, clone) }) }
    return res
  } catch(e) {
    var cached = await caches.match(req)
    if (cached) return cached
    notifyPages('SW_OFFLINE')
    return new Response('简讯 offline', { status: 503 })
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

// ═══ P1: 新版本提示 ═══
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'GET_VERSION') {
    e.source.postMessage({ type: 'VERSION', version: VERSION })
  }
})

// ═══ P2: 后台推送通知 ═══
self.addEventListener('push', function(e) {
  var data = {}
  try { data = e.data ? e.data.json() : {} } catch {}
  var title = data.title || '简讯'
  var body = data.body || ''
  var url = data.url || '/'

  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      data: { url: url },
      vibrate: [100, 50, 100],
    })
  )
})

self.addEventListener('notificationclick', function(e) {
  e.notification.close()
  var url = e.notification.data && e.notification.data.url ? e.notification.data.url : '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i]
        if ('focus' in client) { client.focus(); client.navigate(url); return }
      }
      return clients.openWindow(url)
    })
  )
})
