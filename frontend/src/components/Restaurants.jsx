import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, ExternalLink, Navigation, Phone, UtensilsCrossed } from 'lucide-react'

import { getRestaurants } from '../lib/places'
import { ErrorState, Skeleton, ease } from './ui'

const RestaurantMap = lazy(() => import('./RestaurantMap'))

function MapFallback() {
  return <Skeleton className="h-full w-full !rounded-none" />
}

/**
 * Restaurants near a destination: an interactive map plus a list, each with
 * a Google Maps "Get directions" link built from the place's coordinates.
 */
export default function Restaurants({ destination, center }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const [selected, setSelected] = useState(null)

  const lat = center?.lat, lon = center?.lon
  const load = useCallback(() => {
    setState({ status: 'loading', data: null, error: '' })
    getRestaurants(destination, lat != null ? { lat, lon } : null)
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((e) => setState({ status: 'error', data: null, error: e.message }))
  }, [destination, lat, lon])

  useEffect(() => { load() }, [load])

  const { status, data } = state
  const items = data?.items || []
  const mapCenter = data?.center || center
  const src = data?.source === 'google-places' ? 'Google Places' : 'OpenStreetMap'

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">
          Places to eat near {destination}
        </h2>
        {status === 'ready' && items.length > 0 && (
          <span className="text-[11px] text-frost-400">
            {items.length} within {Math.round((data.radius_m || 0) / 1000)} km · from {src}
          </span>
        )}
      </div>

      {status === 'error' ? (
        <ErrorState title="Couldn't load restaurants" message={state.error} onRetry={load} />
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <div className="relative h-64 border-b border-white/[.07] sm:h-72">
            {/* Drawn once the list is in, so the map fits it in one pass
                instead of loading a view it is about to leave. */}
            {mapCenter && status === 'ready' ? (
              <Suspense fallback={<MapFallback />}>
                <RestaurantMap center={mapCenter} items={items} selected={selected} onSelect={setSelected} label={destination} />
              </Suspense>
            ) : <MapFallback />}
          </div>

          {status === 'loading' ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : items.length === 0 ? (
            <div className="flex items-start gap-3 p-5 text-[13px] text-frost-300">
              <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-frost-400" />
              <p>{data?.note || `No restaurants found near ${destination}.`}</p>
            </div>
          ) : (
            <ul className="max-h-[360px] divide-y divide-white/[.06] overflow-y-auto">
              {items.map((r, i) => (
                <motion.li key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.03, ease }}
                  className={`flex items-center gap-3 px-4 py-3 transition ${selected?.id === r.id ? 'bg-glacier-400/[.08]' : 'hover:bg-white/[.03]'}`}>
                  <button onClick={() => setSelected(r)} className="min-w-0 flex-1 text-left" aria-label={`Show ${r.name} on the map`}>
                    <div className="truncate text-[13.5px] font-semibold text-frost-50">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-frost-400">
                      <span>{r.cuisine}</span>
                      <span className="font-mono text-frost-300">{r.distance_km < 1 ? `${Math.round(r.distance_km * 1000)} m` : `${r.distance_km} km`}</span>
                      {r.opening_hours && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {r.opening_hours}</span>}
                      {r.rating && <span>★ {r.rating}</span>}
                    </div>
                  </button>
                  {r.phone && (
                    <a href={`tel:${r.phone.replace(/\s+/g, '')}`} aria-label={`Call ${r.name}`} title="Call"
                       className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-frost-300 transition hover:text-frost-50">
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {r.website && (
                    <a href={/^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer noopener" aria-label={`${r.name} website`} title="Website"
                       className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-frost-300 transition hover:text-frost-50">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <a href={r.directions_url} target="_blank" rel="noreferrer noopener"
                     className="btn-ghost shrink-0 !px-3 !py-2 !text-[11.5px]">
                    <Navigation className="h-3.5 w-3.5 text-glacier-300" /> <span className="hidden sm:inline">Get directions</span><span className="sm:hidden">Go</span>
                  </a>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
