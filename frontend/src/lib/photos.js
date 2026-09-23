import { useEffect, useState } from 'react'
import { api } from './api'

/**
 * Destination photos by place name.
 *
 * The backend does the lookup (Unsplash when it has a key, Wikimedia
 * Commons otherwise), so API keys never reach the browser. If the backend
 * cannot be reached, the browser asks Wikimedia directly: its API allows
 * cross-origin calls and needs no key. Results are cached in memory and in
 * localStorage for a week, and concurrent requests for the same place share
 * one fetch, so a carousel of twelve cards costs a handful of lookups.
 */
const TTL_MS = 7 * 24 * 3600 * 1000
const KEY = (q, n) => `nt-photos:v1:${q.toLowerCase()}|${n}`
const memory = new Map()
const inflight = new Map()

const REJECT = /\b(map|diagram|painting|drawing|logo|flag|seal|stamp|poster|chart|plan|sketch|coin|ISS\d+|18\d\d|19[0-5]\d)\b/i

function readCache(key) {
  if (memory.has(key)) return memory.get(key)
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null')
    if (hit && Date.now() - hit.at < TTL_MS && Array.isArray(hit.items)) {
      memory.set(key, hit.items)
      return hit.items
    }
  } catch { /* storage blocked or corrupt */ }
  return null
}

function writeCache(key, items) {
  memory.set(key, items)
  if (!items.length) return
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), items })) } catch { /* quota */ }
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').trim()

async function wikimediaDirect(query, count) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '24',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName', iiurlwidth: '1280',
  })
  for (const host of ['https://commons.wikimedia.org', 'https://en.wikipedia.org']) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 10000)
      const res = await fetch(`${host}/w/api.php?${params}`, { signal: ctrl.signal })
      clearTimeout(t)
      if (!res.ok) continue
      const pages = ((await res.json()).query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0))
      const out = []
      for (const p of pages) {
        const ii = p.imageinfo?.[0] || {}
        const w = ii.width || 0, h = ii.height || 0
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(ii.mime)) continue
        if (w < 1000 || !h || w / h < 1.2 || REJECT.test(p.title || '')) continue
        const url = ii.thumburl || ii.url
        if (!url) continue
        out.push({
          id: `wm-${p.pageid}`, url, thumb: url.replace(/\/\d+px-/, '/960px-'),
          alt: (p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
          credit: stripHtml(ii.extmetadata?.Artist?.value) || 'Wikimedia Commons',
          credit_url: ii.descriptionurl || 'https://commons.wikimedia.org',
          license: ii.extmetadata?.LicenseShortName?.value || '',
          source: 'wikimedia',
        })
        if (out.length >= count) break
      }
      return out
    } catch { /* try the next host */ }
  }
  return []
}

export function getPhotos(query, count = 6) {
  const q = String(query || '').trim()
  if (q.length < 2) return Promise.resolve([])
  const key = KEY(q, count)
  const cached = readCache(key)
  if (cached) return Promise.resolve(cached)
  if (inflight.has(key)) return inflight.get(key)

  const p = api.photos(q, count)
    .then((r) => r.items || [])
    .catch(() => [])
    .then((items) => (items.length ? items : wikimediaDirect(q, count)))
    .catch(() => [])
    .then((items) => { writeCache(key, items); return items })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** { items, status } where status is 'loading' | 'ready' | 'empty'. */
export function usePhotos(query, count = 6) {
  const initial = query ? readCache(KEY(String(query).trim(), count)) : null
  const [state, setState] = useState(() => ({
    items: initial || [], status: initial ? (initial.length ? 'ready' : 'empty') : 'loading',
  }))

  useEffect(() => {
    let alive = true
    if (!query) { setState({ items: [], status: 'empty' }); return undefined }
    const hit = readCache(KEY(String(query).trim(), count))
    if (hit) { setState({ items: hit, status: hit.length ? 'ready' : 'empty' }); return undefined }
    setState((s) => ({ ...s, status: 'loading' }))
    getPhotos(query, count).then((items) => {
      if (alive) setState({ items, status: items.length ? 'ready' : 'empty' })
    })
    return () => { alive = false }
  }, [query, count])

  return state
}
