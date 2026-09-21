/**
 * Background message handler for FCM.
 *
 * Service workers cannot read import.meta.env, so the page passes its
 * Firebase config in via postMessage after registration. Until that
 * arrives the worker stays idle rather than throwing on every push.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

let started = false

function start(config) {
  if (started || !config?.apiKey) return
  started = true
  firebase.initializeApp(config)
  firebase.messaging().onBackgroundMessage((payload) => {
    const { title, body } = payload.notification || {}
    self.registration.showNotification(title || 'Northern Trails', {
      body: body || 'Conditions on a route you follow have changed.',
      data: payload.data || {},
      tag: payload.data?.route_id || 'northern-trails',
    })
  })
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG') start(event.data.config)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const routeId = event.notification.data?.route_id
  const url = routeId ? `/conditions?route=${routeId}` : '/conditions'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) return client.focus()
      }
      return clients.openWindow(url)
    }),
  )
})
