import React from 'react'
import { motion } from 'framer-motion'
import { CloudOff } from 'lucide-react'

import { useData } from '../lib/store'

/**
 * Shown when the SPA could not reach its API and is rendering the bundled
 * snapshot instead.
 *
 * This exists so a statically-hosted build cannot quietly pass stale data
 * off as live conditions — the whole product is a claim about freshness, so
 * the one thing it must never do is lie about it.
 */
export default function OfflineBanner() {
  const { offline, directLive } = useData() || {}
  if (!offline) return null

  return (
    <motion.div
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-16 z-[70] border-b border-amberz-400/25 bg-amberz-400/[.12] backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-5 py-2 sm:px-8">
        <CloudOff className="h-3.5 w-3.5 shrink-0 text-amberz-300" />
        {directLive ? (
          <p className="text-[11.5px] leading-snug text-amberz-100">
            <span className="font-bold">Weather and seismic data are live</span>, fetched
            straight from Open-Meteo and USGS in your browser. Road status is a saved
            sample, and booking, matching and the assistant need the backend running.
          </p>
        ) : (
          <p className="text-[11.5px] leading-snug text-amberz-100">
            <span className="font-bold">Offline snapshot.</span>{' '}
            The live API is not reachable from here, so the data below is a saved
            sample. Fetching current weather and seismic data directly…
          </p>
        )}
      </div>
    </motion.div>
  )
}
