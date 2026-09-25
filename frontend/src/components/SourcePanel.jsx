import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Database, RefreshCw, Wifi, WifiOff } from 'lucide-react'

import { api, relTime } from '../lib/api'

/**
 * Where the conditions on this page actually came from.
 *
 * The product claims live road, weather and hazard data. Some of those
 * sources are reachable and some are not, and that changes per deployment
 * and per minute. Rather than implying everything is live, this panel
 * states each source's real mode and how much of the layer it covers.
 */
const MODE = {
  live: { label: 'live', cls: 'border-glacier-500/40 bg-glacier-500/10 text-glacier-300', Icon: Wifi },
  fallback: { label: 'seeded', cls: 'border-amberz-400/30 bg-amberz-400/10 text-amberz-300', Icon: WifiOff },
  disabled: { label: 'off', cls: 'border-ink-700 bg-ink-850 text-frost-400', Icon: WifiOff },
}

const NAMES = {
  weather: 'Weather (Open-Meteo)',
  weather_2nd: 'Weather cross-check (OpenWeatherMap)',
  hazards: 'Hazards (GDACS)',
  seismic: 'Earthquakes (USGS)',
  advisory: 'Advisory (PMD)',
  roads: 'Road status (NHA)',
}

/** The adapter reports its own name; prefer it over our label guess. */
function sourceLabel(key, src) {
  if (key === 'weather' && src.name) {
    return `Weather (${src.name === 'openweathermap' ? 'OpenWeatherMap' : 'Open-Meteo'})`
  }
  return NAMES[key] || key
}

export default function SourcePanel() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setStatus(await api.sources()) } catch { /* endpoint absent — hide */ }
  }, [])

  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setBusy(true)
    try { setStatus(await api.refreshConditions()) } finally { setBusy(false) }
  }

  if (!status?.sources) return null
  const { sources, coverage } = status
  const entries = Object.entries(sources)

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-bold text-frost-100">
          <Database className="h-3.5 w-3.5 text-glacier-300" />
          Data sources
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-frost-300 transition hover:text-frost-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Polling…' : 'Refresh now'}
        </button>
      </div>

      <ul className="space-y-1.5">
        {entries.map(([key, src]) => {
          const mode = MODE[src.mode] || MODE.disabled
          return (
            <motion.li
              key={key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between gap-3 text-[12px]"
            >
              <span className="min-w-0 truncate text-frost-300">{sourceLabel(key, src)}</span>
              <span className="flex shrink-0 items-center gap-2">
                {src.mode === 'live' && (
                  <span className="font-mono text-[10px] text-frost-400"
                        title={src.count === 0 ? 'Source is up and reports nothing active in this region' : ''}>
                    {src.count === 0 ? 'clear' : src.count}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mode.cls}`}>
                  <mode.Icon className="h-2.5 w-2.5" />
                  {mode.label}
                </span>
              </span>
            </motion.li>
          )
        })}
      </ul>

      {coverage && (
        <p className="mt-3 border-t border-ink-800 pt-2.5 text-[11px] leading-relaxed text-frost-400">
          {coverage.alerts_live} of {coverage.alerts_total} alerts and{' '}
          {coverage.routes_live} of {coverage.routes_total} road statuses are from a live
          feed right now; the rest are the seeded baseline.
        </p>
      )}

      {entries.some(([, s]) => s.error) && (
        <ul className="mt-2 space-y-1">
          {entries.filter(([, s]) => s.error).map(([key, s]) => (
            <li key={key} className="text-[10px] leading-relaxed text-frost-400">
              <span className="text-frost-300">{NAMES[key] || key}:</span> {s.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Small inline badge marking one record's provenance. */
export function OriginTag({ origin }) {
  if (!origin || origin === 'seed') return null
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-glacier-500/40 bg-glacier-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-glacier-300">
      <Wifi className="h-2 w-2" />
      {origin}
    </span>
  )
}
