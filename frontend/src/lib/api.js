const BASE = import.meta.env.VITE_API_BASE || ''

/**
 * Supplies the current Firebase ID token, if the user is signed in.
 * Injected by AuthProvider so this module never imports Firebase itself —
 * the SDK stays out of the bundle for anyone who does not sign in.
 */
let tokenProvider = async () => ''
export function setTokenProvider(fn) { tokenProvider = fn }

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  try {
    const token = await tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* signed out, or Firebase unavailable — call anonymously */ }

  const res = await fetch(BASE + path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res.json()
}

export const api = {
  bootstrap: () => req('/api/bootstrap'),
  packages: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== 0))
    return req('/api/packages?' + q)
  },
  package: (id) => req(`/api/packages/${id}`),
  book: (body) => req('/api/bookings', { method: 'POST', body }),
  conditions: () => req('/api/conditions'),
  requestTrip: (body) => req('/api/trips/request', { method: 'POST', body }),
  acceptOffer: (rid, offer_id) => req(`/api/trips/${rid}/accept`, { method: 'POST', body: { offer_id } }),
  offer: (rid, body) => req(`/api/trips/${rid}/offer`, { method: 'POST', body }),
  reject: (rid, body) => req(`/api/trips/${rid}/reject`, { method: 'POST', body }),
  jobs: (opId) => req(`/api/operators/${opId}/jobs`),
  availability: (opId, available) => req(`/api/operators/${opId}/availability`, { method: 'POST', body: { available } }),
  chat: (message, history = []) => req('/api/assistant/chat', { method: 'POST', body: { message, history } }),

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

/** True when this build was given an explicit API origin. */
export const hasApiOrigin = Boolean(BASE)

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
