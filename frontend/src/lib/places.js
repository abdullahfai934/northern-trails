import { api } from './api'

/**
 * Restaurants near a destination.
 *
 * The backend answers from Google Places (when it has a key) or
 * OpenStreetMap, and caches the result. If it cannot be reached, the browser
 * queries OpenStreetMap's Overpass API itself, with the same widening
 * radius, so the map still fills in.
 */
const RADII = [2500, 8000, 25000]
const cache = new Map()

function km(lat1, lon1, lat2, lon2) {
  const r = 6371, rad = Math.PI / 180
  const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

export const directionsUrl = (lat, lon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`

const KINDS = { restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Fast food' }

async function overpassDirect(name, lat, lon) {
  for (const radius of RADII) {
    const q = `[out:json][timeout:20];nwr[amenity~"^(restaurant|cafe|fast_food)$"][name](around:${radius},${lat},${lon});out center 80;`
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: new URLSearchParams({ data: q }),
    })
    if (!res.ok) throw new Error('Overpass ' + res.status)
    const items = ((await res.json()).elements || []).map((e) => {
      const t = e.tags || {}
      const elat = e.lat ?? e.center?.lat, elon = e.lon ?? e.center?.lon
      if (elat == null || !t.name) return null
      const cuisine = (t.cuisine || '').split(';').filter(Boolean).slice(0, 3)
        .map((c) => c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase())).join(', ')
      return {
        id: `osm-${e.type}-${e.id}`, name: t.name, cuisine: cuisine || KINDS[t.amenity] || 'Restaurant',
        lat: elat, lon: elon, distance_km: Math.round(km(lat, lon, elat, elon) * 100) / 100,
        address: [t['addr:street'], t['addr:city']].filter(Boolean).join(', '),
        phone: t.phone || t['contact:phone'] || '', website: t.website || t['contact:website'] || '',
        opening_hours: t.opening_hours || '', source: 'openstreetmap',
        source_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        directions_url: directionsUrl(elat, elon),
      }
    }).filter(Boolean).sort((a, b) => a.distance_km - b.distance_km).slice(0, 20)
    if (items.length) return { ok: true, destination: name, center: { lat, lon }, radius_m: radius, source: 'openstreetmap', items }
  }
  return {
    ok: true, destination: name, center: { lat, lon }, radius_m: RADII.at(-1), source: 'openstreetmap', items: [],
    note: `OpenStreetMap lists no restaurants within ${RADII.at(-1) / 1000} km of ${name}.`,
  }
}

/** Resolves to the API's shape; rejects only when every source failed. */
export async function getRestaurants(destination, center) {
  if (cache.has(destination)) return cache.get(destination)
  let result
  try {
    result = await api.restaurants(destination)
    if (!result.ok && center) result = await overpassDirect(destination, center.lat, center.lon)
  } catch (e) {
    if (!center) throw e
    result = await overpassDirect(destination, center.lat, center.lon)
  }
  if (!result.ok) throw new Error(result.error || 'Restaurant lookup failed')
  cache.set(destination, result)
  return result
}
