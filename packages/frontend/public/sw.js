// 简讯 Service Worker — PWA 离线策略
var CACHE = 'jianxun-v1'
var ASSETS = ['/', '/manifest.json', '/icon-192.svg', '/robots.txt', '/sitemap.xml']

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(ASSETS) }).then(function() { return self.skipWaiting() })
  )
})

self.addEventListener('activate', function(e) {
  e.waitUntil(clients.claim())
})

self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(r) {
      return r || fetch(e.request).then(function(res) {
        if (res.ok && res.type === 'basic') {
          var clone = res.clone()
          caches.open(CACHE).then(function(c) { c.put(e.request, clone) })
        }
        return res
      })
    })
  )
})
