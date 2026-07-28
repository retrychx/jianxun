// 简讯 Service Worker — PWA 离线策略
const CACHE = 'jianxun-v1'
const ASSETS = ['/', '/manifest.json', '/icon-192.svg', '/robots.txt', '/sitemap.xml']

self.addEventListener('install', (e: any) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => (self as any).skipWaiting()))
})

self.addEventListener('activate', (e: any) => {
  e.waitUntil(clients.claim())
})

self.addEventListener('fetch', (e: any) => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
      }
      return res
    }))
  )
})
