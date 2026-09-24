/*
 * Northern Trails service worker: offline support and push notifications.
 *
 * Offline (for travelers who lose signal in the mountains):
 *   - the app shell, so the site opens with no connection
 *   - API reads — booked trips, conditions, destinations — network first,
 *     falling back to the last saved copy
 *   - the map tiles last viewed, and destination photos, cache first
 * The emergency contact and nearby-help list live in localStorage (SOS page).
 *
 * Push: Firebase Cloud Messaging shows alerts while the site is closed. The
 * page registers this worker as /sw.js?apiKey=…&projectId=…, so the config
 * is here from the first line — no message race.
 */
const VERSION = 'nt-v3'
const SHELL = `${VERSION}-shell`
const DATA = `${VERSION}-data`
const TILES = `${VERSION}-tiles`
const IMAGES = `${VERSION}-images`
const params = new URL(self.location.href).searchParams
const DEV = params.get('dev') === '1'

/* ------------------------------------------------------------------ push */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')
  if (params.get('apiKey')) {
    firebase.initializeApp({
      apiKey: params.get('apiKey'), projectId: params.get('projectId'),
      appId: params.get('appId'), messagingSenderId: params.get('messagingSenderId'),
    })
    firebase.messaging().onBackgroundMessage((payload) => {
      // Messages with a `notification` block are shown by FCM itself;
      // data-only messages are shown here.
      if (payload.notification) return
      const d = payload.data || {}
      self.registration.showNotification(d.title || 'Northern Trails', {
        body: d.body || 'Conditions on your trip have changed.', data: d, tag: d.booking || 'northern-trails',
        icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      })
    })
  }
} catch (e) {
  // Offline on first load, or the CDN is blocked: caching still works.
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.route_id ? `/conditions` : '/profile?tab=alerts'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin)) { c.navigate(url); return c.focus() }
    return clients.openWindow(url)
  }))
})

/* --------------------------------------------------------------- caching */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']))
    .catch(() => {})
    .then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('message', (event) => {
  // On sign-out, forget cached personal data such as bookings.
  if (event.data?.type === 'CLEAR_USER_DATA') event.waitUntil(caches.delete(DATA))
})

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k)
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch (e) {
    const hit = await cache.match(request) || (fallbackUrl && await caches.match(fallbackUrl))
    if (hit) return hit
    throw e
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok || res.type === 'opaque') {
    cache.put(request, res.clone())
    trim(cacheName, max)
  }
  return res
}

const API_READS = /^\/api\/(bootstrap|packages|destinations|conditions|safety|recommendations|me\/bookings|me\/plans|me\/notifications|places)/

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || DEV) return
  const url = new URL(req.url)

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL, '/'))
    return
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL, 120))
    return
  }
  if (API_READS.test(url.pathname)) {
    event.respondWith(networkFirst(req, DATA))
    return
  }
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(cacheFirst(req, TILES, 600))
    return
  }
  if (/(^|\.)wikimedia\.org$|images\.unsplash\.com$/.test(url.hostname) || url.pathname.startsWith('/api/images/')) {
    event.respondWith(cacheFirst(req, IMAGES, 150))
    return
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, SHELL, 120))
  }
})
