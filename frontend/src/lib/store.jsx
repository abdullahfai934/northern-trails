import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'
import snapshot from './demo-data.json'
import { fetchQuakes, fetchWeather } from './liveDirect'

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

/** How long first paint waits for the API before drawing the snapshot. */
const FIRST_PAINT_WAIT_MS = 3500
/** Retry schedule while the API is waking up or briefly unreachable. */
const RETRY_MS = [2000, 4000, 8000, 15000, 30000, 60000]

/**
 * Loads everything the pages share.
 *
 * The API is asked first. A free container host can take most of a minute
 * to wake from idle, so if it has not answered within a few seconds the
 * bundled snapshot is drawn instead — with weather and earthquakes fetched
 * live from Open-Meteo and USGS directly — and the API keeps being retried
 * in the background. When it answers, its data replaces the snapshot in
 * place. Every record keeps its own timestamp either way, so nothing is
 * presented as fresher than it is.
 */
export function DataProvider({ children }) {
  const [data, setData] = useState(null)
  //: true while the data on screen is the bundled snapshot, not the API's
  const [offline, setOffline] = useState(false)
  const liveRef = useRef(false)
  const alive = useRef(true)

  const applyLive = useCallback((d) => {
    liveRef.current = true
    setData(d)
    setOffline(false)
  }, [])

  const drawSnapshot = useCallback(() => {
    if (liveRef.current) return
    const base = hydrate(snapshot)
    setData((cur) => cur || base)
    setOffline(true)
    // Open-Meteo and USGS allow direct browser calls, so weather and
    // seismic data stay genuinely current even without the API.
    Promise.allSettled([
      fetchWeather((base.weather || []).map((w) => w.city)),
      fetchQuakes(),
    ]).then(([wx, quakes]) => {
      if (!alive.current || liveRef.current) return
      const live = {}
      if (wx.status === 'fulfilled' && wx.value.length) live.weather = wx.value
      if (quakes.status === 'fulfilled' && quakes.value.length) {
        live.alerts = [...quakes.value, ...(base.alerts || [])]
      }
      if (Object.keys(live).length) setData((d) => ({ ...d, ...live }))
    })
  }, [])

  useEffect(() => {
    alive.current = true
    let timer = null
    let attempt = 0
    const firstPaint = setTimeout(drawSnapshot, FIRST_PAINT_WAIT_MS)

    const tryApi = () => {
      api.bootstrap({ timeout: 70000 })
        .then((d) => {
          if (!alive.current) return
          clearTimeout(firstPaint)
          applyLive(d)
        })
        .catch(() => {
          if (!alive.current) return
          drawSnapshot()
          const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]
          attempt += 1
          timer = setTimeout(tryApi, wait)
        })
    }
    tryApi()
    return () => {
      alive.current = false
      clearTimeout(firstPaint)
      clearTimeout(timer)
    }
  }, [applyLive, drawSnapshot])

  /** Re-pull shared data, e.g. after the admin screen changes a package. */
  const refresh = useCallback(() => api.bootstrap().then(applyLive).catch(() => {}), [applyLive])

  return (
    <Ctx.Provider value={{ ...(data || {}), ready: !!data, offline, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

/** Stable per-browser traveler id so reconnects keep the same socket room. */
export function travelerId() {
  let id = null
  try { id = localStorage.getItem('nt-traveler') } catch { /* storage blocked */ }
  if (!id) {
    id = 'trv-' + Math.random().toString(36).slice(2, 9)
    try { localStorage.setItem('nt-traveler', id) } catch { /* keep it for this tab only */ }
  }
  return id
}
