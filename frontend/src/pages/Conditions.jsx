import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, CloudSun, FileCheck2, Mountain, Route as RouteIcon,
  ShieldAlert, Wind, Eye, Droplets, Gauge, ChevronDown, Loader2,
} from 'lucide-react'

import { useData } from '../lib/store'
import { STATUS, api, relTime } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Reveal, SectionTitle, Skeleton, StatusPill, Stagger, ease, item, useToast } from '../components/ui'
import SourcePanel, { OriginTag } from '../components/SourcePanel'

/** Operators and admins set a road's status; the change is stored with who and when. */
function RouteEditor({ route, onSaved }) {
  const toast = useToast()
  const [status, setStatus] = useState(route.status)
  const [note, setNote] = useState(route.status_note)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    if (note.trim().length < 3) { setError('Describe the condition in a few words'); return }
    setBusy(true); setError('')
    try {
      await api.setRouteStatus(route.id, status, note.trim())
      toast('Road status updated')
      await onSaved?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="mt-4 rounded-xl border border-glacier-400/20 bg-glacier-400/[.04] p-4">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-glacier-300">Update road status</div>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="field !py-2" aria-label="Status">
          {['open', 'caution', 'restricted', 'seasonal', 'closed'].map((x) => <option key={x} value={x}>{STATUS[x].label}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className="field !py-2" aria-label="What travelers need to know" placeholder="What travelers need to know" />
        <button type="submit" disabled={busy} className="btn-primary !px-4 !py-2 !text-[13px]">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-rose-300">{error}</p>}
    </form>
  )
}

export default function Conditions() {
  const d = useData()
  const auth = useAuth()
  const [valley, setValley] = useState('All')
  const [open, setOpen] = useState(null)

  if (!d.ready) {
    return (
      <div className="mx-auto max-w-7xl space-y-3 px-5 pb-16 pt-14 sm:px-8">
        <Skeleton className="h-12 w-2/3" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  const valleys = ['All', ...new Set(d.routes.map((r) => r.valley))]
  const routes = valley === 'All' ? d.routes : d.routes.filter((r) => r.valley === valley)
  const counts = d.routes.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {})

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle
          eyebrow="Live conditions layer"
          title="Every route, tracked and timestamped."
          sub="Live weather from Open-Meteo, hazards from GDACS, earthquakes from USGS and the PMD tourist advisory — fused per route. Road status is reported by verified operators and admins on the ground, and every road shows who updated it and when."
        />
      </Reveal>

      {/* summary row */}
      <Stagger className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(STATUS).map(([k, s]) => (
          <motion.div key={k} variants={item} className="glass rounded-xl p-4">
            <div className={`font-mono text-2xl font-bold ${s.tone}`}>{counts[k] || 0}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-frost-400">{s.label}</div>
          </motion.div>
        ))}
      </Stagger>

      <Reveal><div className="mb-6"><SourcePanel /></div></Reveal>

      {/* alerts */}
      {d.alerts.length > 0 && (
        <Reveal>
          <div className="mb-8 space-y-3">
            {d.alerts.map((a, i) => (
              <motion.div key={a.id}
                initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08, ease }}
                className={`glass flex items-start gap-4 rounded-2xl p-5
                  ${a.severity === 'high' ? 'border-rose-400/20 bg-rose-400/[.05]' : 'border-amberz-400/20 bg-amberz-400/[.05]'}`}>
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl
                  ${a.severity === 'high' ? 'bg-rose-400/15 text-rose-300' : 'bg-amberz-400/15 text-amberz-300'}`}>
                  {a.kind === 'GLOF' ? <Droplets className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[14px] font-bold ${a.severity === 'high' ? 'text-rose-200' : 'text-amberz-200'}`}>{a.title}</span>
                    <span className="chip !py-0.5 !text-[10px] uppercase">{a.kind}</span>
                    <OriginTag origin={a.origin} />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-frost-300">{a.body}</p>
                  <div className="mt-2 text-[11px] text-frost-400">{a.source} · issued {relTime(a.issued_at)}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Reveal>
      )}

      {/* weather strip */}
      <Reveal>
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {d.weather.map((w, i) => (
            <motion.div key={w.city}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.5, delay: i * 0.06, ease }}
              className={`group relative overflow-hidden rounded-2xl p-4 transition-colors duration-500
                glass ${w.driving_hazard ? 'border-amberz-400/30' : ''}`}>
              {/* a live card should feel alive: a slow pass of light */}
              {w.origin && w.origin !== 'seed' && (
                <motion.span aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/[.05] to-transparent"
                  animate={{ x: ['0%', '400%'] }}
                  transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut',
                                repeatDelay: 2.5 + i * 0.6 }} />
              )}
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-frost-50">{w.city}</div>
                  <div className="truncate text-[11px] text-frost-400">{w.condition}</div>
                </div>
                <CloudSun className="h-6 w-6 shrink-0 text-glacier-300 transition-transform duration-500 group-hover:scale-110"
                          strokeWidth={1.6} />
              </div>
              <div className="mt-3 flex items-end gap-2">
                <span className="font-mono text-3xl font-bold text-frost-50">{w.temp_c}°</span>
                {w.origin && w.origin !== 'seed' && (
                  <span className="mb-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-glacier-300">
                    <motion.span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-glacier-300"
                      animate={{ opacity: [1, 0.25, 1], scale: [1, 0.82, 1] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />
                    live
                  </span>
                )}
              </div>
              {w.elevation_m > 0 && (
                <div className="mt-0.5 font-mono text-[10px] text-frost-400">
                  {w.elevation_m.toLocaleString()} m
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-frost-400">
                <span className="flex items-center gap-1"><Wind className="h-3 w-3" />{w.wind_kmh} km/h</span>
                <span className="flex items-center gap-1"><Droplets className="h-3 w-3" />{w.humidity}%</span>
                <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{w.visibility_km} km</span>
              </div>
              {w.cross_checked && (
                <div className={`mt-2.5 flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] leading-snug
                  ${w.sources_agree
                    ? 'border-glacier-400/25 bg-glacier-400/[.07] text-glacier-200'
                    : 'border-amberz-400/30 bg-amberz-400/10 text-amberz-200'}`}>
                  <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
                  <span>
                    {w.sources_agree
                      ? `Confirmed by a second provider (${w.second_opinion?.temp_c}°, OpenWeatherMap).`
                      : `Providers disagree by ${w.temp_gap_c}° — OpenWeatherMap reads ${w.second_opinion?.temp_c}°. Treat with caution.`}
                    {typeof w.confidence === 'number' && (
                      <span className="opacity-70"> Confidence {Math.round(w.confidence * 100)}%.</span>
                    )}
                  </span>
                </div>
              )}
              {w.driving_hazard && (
                <div className="mt-2.5 rounded-lg border border-amberz-400/25 bg-amberz-400/10 px-2 py-1.5 text-[10px] leading-snug text-amberz-200">
                  Driving conditions affected — allow extra time on this stretch.
                </div>
              )}
              <div className="mt-3 flex justify-between border-t border-white/[.07] pt-2.5">
                {w.forecast.map(([day, hi, lo]) => (
                  <div key={day} className="text-center">
                    <div className="text-[10px] font-semibold text-frost-400">{day}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-frost-100">{hi}°</div>
                    <div className="font-mono text-[10px] text-frost-400">{lo}°</div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </Reveal>

      {/* valley filter */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {valleys.map((v) => (
          <button key={v} onClick={() => setValley(v)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-300
              ${valley === v
                ? 'bg-gradient-to-r from-glacier-400/25 to-glacier-400/10 text-glacier-200 ring-1 ring-glacier-400/40'
                : 'border border-white/10 bg-white/[.03] text-frost-300 hover:bg-white/[.07]'}`}>
            {v}
          </button>
        ))}
      </div>

      {/* routes */}
      <div className="space-y-3">
        {routes.map((r, i) => {
          const isOpen = open === r.id
          return (
            <motion.div key={r.id} layout
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.04, ease }}
              className="glass overflow-hidden rounded-2xl">
              <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-center gap-4 p-5 text-left">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${STATUS[r.status]?.bg}`}>
                  <RouteIcon className={`h-5 w-5 ${STATUS[r.status]?.tone}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold text-frost-50">{r.name}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <p className="mt-1 line-clamp-1 text-[12.5px] text-frost-300">{r.status_note}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-frost-400">
                    <span>{r.distance_km} km</span>
                    <span>~{r.drive_hours} h</span>
                    <span className="flex items-center gap-1"><Mountain className="h-3 w-3" />{r.elevation_m} m</span>
                    <span title={r.updated_at ? new Date(r.updated_at).toLocaleString() : ''}>
                      Updated {relTime(r.updated_at)}{r.updated_by ? ` by ${r.updated_by}` : ''}
                    </span>
                  </div>
                </div>
                <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
                  <ChevronDown className="h-4 w-4 text-frost-400" />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease }} className="overflow-hidden">
                    <div className="border-t border-white/[.07] p-5 pt-4">
                      <p className="text-[13px] leading-relaxed text-frost-200">{r.status_note}</p>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        {r.permits.length > 0 && (
                          <div>
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-frost-400">Permits required</div>
                            <ul className="space-y-1.5">
                              {r.permits.map((p) => (
                                <li key={p} className="flex items-start gap-2 text-[12.5px] text-frost-200">
                                  <FileCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberz-300" /> {p}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {r.hazards.length > 0 && (
                          <div>
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-frost-400">Hazards</div>
                            <ul className="space-y-1.5">
                              {r.hazards.map((h) => (
                                <li key={h} className="flex items-start gap-2 text-[12.5px] text-frost-200">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" /> {h}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-white/[.07] pt-4 text-[11px] text-frost-400">
                        <span className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> confidence {Math.round(r.confidence * 100)}%</span>
                        <span>{r.traveler_reports} traveler reports</span>
                        <span className="truncate">source: {r.source}</span>
                        {r.updated_at && <span>last updated {new Date(r.updated_at).toLocaleString()}</span>}
                      </div>
                      {auth.isOperator && <RouteEditor route={r} onSaved={d.refresh} />}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
