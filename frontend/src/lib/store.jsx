import React, { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'
import snapshot from './demo-data.json'

/**
 * Reshape the bundled snapshot to match what /api/bootstrap returns.
 *
 * The API joins each package to its operator server-side
 * (`package_with_operator`); the raw snapshot only carries `operator_id`.
 * Without this join the package cards dereference `pkg.operator.name` and
 * take the whole app down with them.
 */
function hydrate(raw) {
  const byId = Object.fromEntries((raw.operators || []).map((o) => [o.id, o]))
  return {
    ...raw,
    packages: (raw.packages || []).map((p) => ({
      ...p,
      operator: p.operator || byId[p.operator_id] || null,
    })).filter((p) => p.operator),
  }
}

const Ctx = createContext(null)
export const useData = () => useContext(Ctx)

export function DataProvider({ children }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let alive = true
    api.bootstrap()
      .then((d) => { if (alive) { setData(d); setOffline(false) } })
      .catch((e) => {
        if (!alive) return
        // The API is unreachable — most often because the SPA is hosted
        // statically (Firebase Hosting) with no backend deployed yet. Fall
        // back to a bundled snapshot so the UI is still browsable, and flag
        // it loudly: a snapshot must never be mistaken for live conditions.
        console.warn('API unreachable, using bundled snapshot:', e.message)
        setData(hydrate(snapshot))
        setOffline(true)
        setError(e.message)
      })
    return () => { alive = false }
  }, [])

  return (
    <Ctx.Provider value={{ ...(data || {}), ready: !!data, offline, error }}>
      {children}
    </Ctx.Provider>
  )
}

/** Stable per-browser traveler id so reconnects keep the same socket room. */
export function travelerId() {
  let id = localStorage.getItem('nt-traveler')
  if (!id) {
    id = 'trv-' + Math.random().toString(36).slice(2, 9)
    localStorage.setItem('nt-traveler', id)
  }
  return id
}
