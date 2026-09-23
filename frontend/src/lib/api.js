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

async function req(path, opts = {}) {
  const { timeout = 30000, headers: extra, body, ...rest } = opts
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
    throw new ApiError(e?.name === 'AbortError'
      ? 'The server took too long to respond. Please try again.'
      : 'Could not reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
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
  me: () => req('/api/auth/me'),
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
