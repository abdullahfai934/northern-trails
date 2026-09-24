const BASE = import.meta.env.VITE_API_BASE || ''

/**
 * Supplies the current Firebase ID token, if the user is signed in.
 * Injected by AuthProvider so this module never imports Firebase itself —
 * the SDK stays out of the bundle for anyone who does not sign in.
 */
let tokenProvider = async () => ''
export function setTokenProvider(fn) { tokenProvider = fn }

/**
 * An API failure with a message fit to show a traveler, plus per-field
 * messages when the server rejected a form (FastAPI's 422 detail list).
 */
export class ApiError extends Error {
  constructor(message, status = 0, fields = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

function fieldKey(loc = []) {
  return loc.filter((x) => x !== 'body' && x !== 'query').join('.')
}

async function errorFrom(res) {
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  const detail = body?.detail
  if (Array.isArray(detail)) {
    const fields = {}
    for (const d of detail) {
      const key = fieldKey(d.loc)
      if (key && !fields[key]) fields[key] = String(d.msg || '').replace(/^Value error, /, '')
    }
    const first = Object.values(fields)[0] || 'Some fields need attention.'
    return new ApiError(first, res.status, fields)
  }
  if (typeof detail === 'string') return new ApiError(detail, res.status)
  if (res.status >= 500) return new ApiError('The server hit a problem. Please try again in a moment.', res.status)
  return new ApiError(res.statusText || 'Request failed', res.status)
}

/*
 * Cold starts. A free host puts the API to sleep when nobody uses it, and the
 * first request then fails (a gateway 502/503/504, a sleeping-host HTML page
 * or a network error) or hangs while the server boots. Instead of showing an
 * error, requests that could not have reached the app wait for /api/health
 * to answer and are then sent again. Subscribers (the "waking up" banner)
 * hear 'waking' and 'ready'.
 */
const WAKE_LIMIT_MS = 150000
const listeners = new Set()
let serverState = 'ready'
let waking = null

export function onServerState(fn) {
  listeners.add(fn)
  fn(serverState)
  return () => listeners.delete(fn)
}

function setServerState(s) {
  if (s === serverState) return
  serverState = s
  listeners.forEach((fn) => fn(s))
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function wakeServer() {
  if (waking) return waking
  setServerState('waking')
  waking = (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < WAKE_LIMIT_MS) {
      try {
        const r = await fetch(BASE + '/api/health', { cache: 'no-store' })
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          setServerState('ready')
          return true
        }
      } catch { /* still asleep */ }
      await sleep(3000)
    }
    setServerState('down')
    return false
  })().finally(() => { waking = null })
  return waking
}

/** A response from the host's gateway rather than from the API itself. */
function asleep(res) {
  // The API always answers in JSON (its own 503s included); gateways don't.
  if ((res.headers.get('content-type') || '').includes('json')) return false
  return res.ok || [502, 503, 504].includes(res.status)
}

async function req(path, opts = {}, woke = false) {
  if (waking) await waking
  try {
    return await send(path, opts)
  } catch (e) {
    if (woke || !e.wake) throw e.wake ? e.error : e
    if (!(await wakeServer())) throw e.error
    return req(path, opts, true)
  }
}

async function send(path, opts) {
  const { timeout = 30000, headers: extra, body, ...rest } = opts
  const safe = !rest.method || rest.method === 'GET'
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(extra || {}) }
  try {
    const token = await tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* signed out, or Firebase unavailable — call anonymously */ }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  let res
  try {
    res = await fetch(BASE + path, {
      ...rest,
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
  } catch (e) {
    const timedOut = e?.name === 'AbortError'
    const error = new ApiError(timedOut
      ? 'The server took too long to respond. Please try again.'
      : 'Could not reach the server. Check your connection and try again.')
    // A network error never reached the app, so any request may be resent;
    // a timeout might have, so only reads are.
    throw { wake: navigator.onLine !== false && (!timedOut || safe), error }
  } finally {
    clearTimeout(timer)
  }
  if (asleep(res)) {
    throw { wake: true, error: new ApiError('The server is starting up. Please try again in a minute.', res.status) }
  }
  if (!res.ok) throw await errorFrom(res)
  return res.json()
}

export const api = {
  bootstrap: (opts) => req('/api/bootstrap', opts),
  packages: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== 0))
    return req('/api/packages?' + q)
  },
  package: (id) => req(`/api/packages/${id}`),

  // --- planning & destinations ---
  plan: (body) => req('/api/plan', { method: 'POST', body }),
  planMethodology: () => req('/api/plan/methodology'),
  destinations: () => req('/api/destinations'),
  destination: (id) => req(`/api/destinations/${id}`),
  book: (body) => req('/api/bookings', { method: 'POST', body }),
  conditions: () => req('/api/conditions'),
  requestTrip: (body) => req('/api/trips/request', { method: 'POST', body }),
  acceptOffer: (rid, offer_id) => req(`/api/trips/${rid}/accept`, { method: 'POST', body: { offer_id } }),
  offer: (rid, body) => req(`/api/trips/${rid}/offer`, { method: 'POST', body }),
  reject: (rid, body) => req(`/api/trips/${rid}/reject`, { method: 'POST', body }),
  jobs: (opId) => req(`/api/operators/${opId}/jobs`),
  availability: (opId, available) => req(`/api/operators/${opId}/availability`, { method: 'POST', body: { available } }),
  // Gemini can take a while on a long answer; give it longer than a page load.
  chat: (message, history = []) => req('/api/assistant/chat', { method: 'POST', body: { message, history }, timeout: 60000 }),

  // --- photos & places ---
  photos: (q, count = 6) => req('/api/photos?' + new URLSearchParams({ q, count }), { timeout: 20000 }),
  restaurants: (destination) => req('/api/places/restaurants?' + new URLSearchParams({ destination }), { timeout: 60000 }),
  restaurantsAt: (lat, lng) => req('/api/restaurants?' + new URLSearchParams({ lat, lng }), { timeout: 60000 }),

  // --- package admin (token sent per call, never stored in the bundle) ---
  adminStatus: () => req('/api/admin/status'),
  adminVerify: (token) => req('/api/admin/verify', { method: 'POST', headers: { 'X-Admin-Token': token } }),
  adminCreate: (token, body) => req('/api/admin/packages', { method: 'POST', body, headers: { 'X-Admin-Token': token } }),
  adminUpdate: (token, id, body) => req(`/api/admin/packages/${id}`, { method: 'PUT', body, headers: { 'X-Admin-Token': token } }),
  adminDelete: (token, id) => req(`/api/admin/packages/${id}`, { method: 'DELETE', headers: { 'X-Admin-Token': token } }),
  adminUpload: (token, file) => {
    const form = new FormData()
    form.append('file', file)
    return req('/api/admin/images', { method: 'POST', body: form, headers: { 'X-Admin-Token': token }, timeout: 60000 })
  },

  // --- on-demand trips ---
  tripQuote: (params) => req('/api/trips/quote?' + new URLSearchParams(params)),
  tripHistory: (travelerId) => req(`/api/trips/history/${travelerId}`),

  // --- live-source transparency ---
  health: () => req('/api/health'),
  sources: () => req('/api/conditions/sources'),
  refreshConditions: () => req('/api/conditions/refresh', { method: 'POST' }),

  // --- accounts & push ---
  authConfig: () => req('/api/auth/config'),
  me: () => req('/api/me'),
  updateMe: (body) => req('/api/me', { method: 'PATCH', body }),
  myBookings: () => req('/api/me/bookings'),
  setWishlist: (ids) => req('/api/me/wishlist', { method: 'PUT', body: { ids } }),
  notifications: () => req('/api/me/notifications'),
  readNotifications: () => req('/api/me/notifications/read', { method: 'POST' }),
  myReviews: () => req('/api/me/reviews'),
  myPlans: () => req('/api/me/plans'),
  savePlan: (body) => req('/api/me/plans', { method: 'POST', body }),
  deletePlan: (id) => req(`/api/me/plans/${id}`, { method: 'DELETE' }),
  aiPlan: (body) => req('/api/plan/ai', { method: 'POST', body, timeout: 90000 }),

  // --- reviews ---
  packageReviews: (id) => req(`/api/packages/${id}/reviews`),
  addReview: (body) => req('/api/reviews', { method: 'POST', body }),
  uploadPhoto: (file) => {
    const form = new FormData()
    form.append('file', file)
    return req('/api/admin/images', { method: 'POST', body: form, timeout: 60000 })
  },

  // --- safety, recommendations, map ---
  safety: () => req('/api/safety'),
  recommendations: () => req('/api/recommendations'),
  conditionsFor: (key) => req(`/api/conditions/${encodeURIComponent(key)}`),
  pois: (kind, lat, lng, radius = 15000) => req('/api/places/pois?' + new URLSearchParams({ kind, lat, lng, radius }), { timeout: 60000 }),

  // --- developer API keys (operators) ---
  devKeys: () => req('/api/developer/keys'),
  createDevKey: (label) => req('/api/developer/keys', { method: 'POST', body: { label } }),
  revokeDevKey: (id) => req(`/api/developer/keys/${id}`, { method: 'DELETE' }),

  // --- dashboard (admin / operator) ---
  adminStats: () => req('/api/admin/stats'),
  adminBookings: () => req('/api/admin/bookings'),
  setBookingStatus: (id, status) => req(`/api/admin/bookings/${id}`, { method: 'PATCH', body: { status } }),
  adminReviews: (status = '') => req('/api/admin/reviews' + (status ? `?status=${status}` : '')),
  moderateReview: (id, status) => req(`/api/admin/reviews/${id}`, { method: 'PATCH', body: { status } }),
  adminUsers: () => req('/api/admin/users'),
  setRole: (uid, role, operator_id = '') => req(`/api/admin/users/${uid}`, { method: 'PATCH', body: { role, operator_id } }),
  setRouteStatus: (id, status, status_note) => req(`/api/admin/routes/${id}`, { method: 'PATCH', body: { status, status_note } }),
  editOperator: (id, body) => req(`/api/admin/operators/${id}`, { method: 'PATCH', body }),
  savePackage: (id, body) => (id ? req(`/api/admin/packages/${id}`, { method: 'PUT', body })
                                 : req('/api/admin/packages', { method: 'POST', body })),
  deletePackage: (id) => req(`/api/admin/packages/${id}`, { method: 'DELETE' }),
  registerDevice: (body) => req('/api/devices/register', { method: 'POST', body }),

  // --- payments ---
  booking: (id) => req(`/api/bookings/${id}`),
  paymentProviders: () => req('/api/payments/providers'),
  startPayment: (body) => req('/api/payments/start', { method: 'POST', body }),
}

/**
 * Hand the browser off to a hosted checkout.
 *
 * Both Pakistani gateways expect a form POST rather than a redirect with
 * query parameters, so we build one, submit it, and let the gateway take
 * over the tab.
 */
/**
 * Where the Swagger UI lives, or '' when the SPA is statically hosted with
 * no backend origin to point at. Callers hide the link when it is empty —
 * a link that silently returns the SPA shell is worse than no link.
 */
export const apiDocsUrl = BASE ? `${BASE}/api/docs` : ''

/** The API's public origin, for the developer docs and share links. */
export const apiBase = () => BASE || window.location.origin

/** Uploaded images are served by the API; absolute URLs pass through. */
export const assetUrl = (u) => (u && u.startsWith('/api/') ? BASE + u : u)

/** wa.me link with a pre-filled message about one package. */
export function whatsappUrl(pkg) {
  const digits = String(pkg?.whatsapp || '').replace(/\D/g, '')
  if (!digits) return ''
  const text = `Hello ${pkg.operator?.name || ''}, I found your "${pkg.title}" package ` +
    `(${pkg.days} days, ${pkr(pkg.price_pkr)} per person) on Northern Trails. ` +
    'Is it available for my dates?'
  return `https://wa.me/${digits}?text=${encodeURIComponent(text.replace(/\s+/g, ' '))}`
}

export function postToGateway({ post_url, fields }) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = (post_url.startsWith('/') ? BASE : '') + post_url
  Object.entries(fields || {}).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  })
  document.body.appendChild(form)
  form.submit()
}

export function wsUrl(path) {
  const base = BASE || window.location.origin
  return base.replace(/^http/, 'ws') + path
}

export const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-PK')

export const relTime = (iso) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export const STATUS = {
  open:       { label: 'Open',        tone: 'text-emerald-300', dot: 'bg-emerald-400', ring: 'ring-emerald-400/25', bg: 'bg-emerald-400/10' },
  caution:    { label: 'Caution',     tone: 'text-amberz-300',  dot: 'bg-amberz-400',  ring: 'ring-amberz-400/25',  bg: 'bg-amberz-400/10' },
  restricted: { label: 'Restricted',  tone: 'text-orange-300',  dot: 'bg-orange-400',  ring: 'ring-orange-400/25',  bg: 'bg-orange-400/10' },
  seasonal:   { label: 'Seasonal',    tone: 'text-glacier-300', dot: 'bg-glacier-400', ring: 'ring-glacier-400/25', bg: 'bg-glacier-400/10' },
  closed:     { label: 'Closed',      tone: 'text-rose-300',    dot: 'bg-rose-400',    ring: 'ring-rose-400/25',    bg: 'bg-rose-400/10' },
}
