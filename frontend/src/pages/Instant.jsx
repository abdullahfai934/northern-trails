import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Zap, MapPin, Users, ArrowRight, Check, X, Clock, BadgeCheck,
  Navigation, Radar, CarFront, RotateCcw,
} from 'lucide-react'

import { useData, travelerId } from '../lib/store'
import { api, pkr, wsUrl } from '../lib/api'
import { fetchRoute } from '../lib/liveDirect'
import { Reveal, SectionTitle, Stars, ease, useToast } from '../components/ui'

const STAGE_STEPS = [
  ['driver_enroute', 'Driver en route'],
  ['arrived', 'Arrived at pickup'],
  ['in_progress', 'Trip in progress'],
  ['completed', 'Completed'],
]

export default function Instant() {
  const d = useData()
  const toast = useToast()
  const me = useMemo(travelerId, [])

  const [service, setService] = useState('jeep')
  const [pickup, setPickup] = useState('Gilgit')
  const [dropoff, setDropoff] = useState('Karimabad (Hunza)')
  const [passengers, setPassengers] = useState(2)
  const [notes, setNotes] = useState('')

  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [history, setHistory] = useState([])

  const [phase, setPhase] = useState('form')      // form | searching | confirmed
  const [request, setRequest] = useState(null)
  const [offers, setOffers] = useState([])
  const [feed, setFeed] = useState([])
  const [countdown, setCountdown] = useState(0)
  const [trip, setTrip] = useState(null)
  const [stage, setStage] = useState(null)
  const wsRef = useRef(null)

  /* ------------------------------------------------- traveler socket */
  useEffect(() => {
    const ws = new WebSocket(wsUrl(`/ws/traveler/${me}`))
    wsRef.current = ws
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.type === 'search.started') {
        setFeed((f) => [{ id: Math.random(), text: `Dispatching to ${m.candidate_count} nearby operators…`, tone: 'info' }, ...f])
      }
      if (m.type === 'search.notified') {
        setFeed((f) => [{ id: Math.random(), text: `Request sent to ${m.operator.name}`, tone: 'info' }, ...f])
      }
      if (m.type === 'offer.received') {
        setOffers((o) => [...o, m.offer])
        setFeed((f) => [{
          id: Math.random(),
          text: `${m.offer.operator.name}${m.offer.simulated ? ' (stand-in)' : ''} responded — `
                + `${pkr(m.offer.price_pkr)}, ETA ${m.offer.eta_min} min`,
          tone: 'good',
        }, ...f])
      }
      if (m.type === 'offer.declined') {
        setFeed((f) => [{ id: Math.random(), text: `${m.operator.name} declined${m.reason ? ' — ' + m.reason : ''}`, tone: 'bad' }, ...f])
      }
      if (m.type === 'trip.confirmed') {
        setTrip(m.request); setPhase('confirmed'); setStage(null)
      }
      if (m.type === 'trip.update') {
        setStage(m.stage)
        setFeed((f) => [{ id: Math.random(), text: m.note, tone: 'good' }, ...f])
      }
      if (m.type === 'search.expired') {
        setPhase('form')
        toast('No operator responded in time. Try widening the pickup point.', 'warn')
      }
    }
    return () => ws.close()
  }, [me, toast])

  /* --------------------------------------------- live fare + routing
     The fare comes from the real road route between the two towns, so the
     number on screen is the number the API will charge — not a guess. */
  useEffect(() => {
    if (phase !== 'form' || !pickup || !dropoff) return undefined
    if (pickup === dropoff) {
      setQuote(null); setQuoteError('Pickup and drop-off are the same place')
      return undefined
    }
    let alive = true
    setQuoting(true); setQuoteError('')
    const timer = setTimeout(() => {
      api.tripQuote({ service, pickup, dropoff, passengers })
        .then((q) => { if (alive) { setQuote(q); setQuoteError('') } })
        .catch(async (err) => {
          if (!alive) return
          // No backend: OSRM allows direct browser calls, so the distance
          // and duration can still be real. Only the fare formula lives
          // server-side, so price it here from the service rates.
          const route = await fetchRoute(pickup, dropoff).catch(() => null)
          if (!alive) return
          if (route) {
            setQuote({ ...route, ...localFare(d, service, route.distance_km, passengers) })
            setQuoteError('')
          } else {
            setQuote(null)
            setQuoteError(cleanError(err.message))
          }
        })
        .finally(() => { if (alive) setQuoting(false) })
    }, 250)
    return () => { alive = false; clearTimeout(timer); }
  }, [service, pickup, dropoff, passengers, phase, d])

  /* ------------------------------------------- real, persisted history */
  useEffect(() => {
    api.tripHistory(me).then((r) => setHistory(r.items || [])).catch(() => {})
  }, [me, phase])

  /* ------------------------------------------------------- countdown */
  useEffect(() => {
    if (phase !== 'searching' || !countdown) return
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [phase, countdown])

  const submit = async () => {
    setOffers([]); setFeed([]); setTrip(null); setStage(null)
    try {
      // No client-side distance: the server routes it for real.
      const r = await api.requestTrip({
        traveler_id: me, traveler_name: 'Traveler', service, pickup, dropoff,
        passengers, notes,
      })
      setRequest(r); setCountdown(r.expires_in); setPhase('searching')
    } catch (e) { toast('Could not post the request: ' + e.message, 'bad') }
  }

  const accept = async (offer) => {
    try { await api.acceptOffer(request.id, offer.id) }
    catch (e) { toast('That offer was withdrawn.', 'warn') }
  }

  const reset = () => { setPhase('form'); setOffers([]); setFeed([]); setTrip(null); setStage(null) }

  if (!d.ready) return <div className="px-5 py-32 text-center text-frost-400">Loading…</div>

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle
          eyebrow="On-demand · real time"
          title="Need a jeep in the next hour?"
          sub="Post what you need. Nearby verified operators get it over WebSocket, bid against each other, and you pick. Same interaction as ride-hailing, built for mountain roads."
        />
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ------------------------------------------------- left column */}
        <div>
          <AnimatePresence mode="wait">
            {phase === 'form' && (
              <motion.div key="form"
                initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.45, ease }} className="glass rounded-2xl p-6">

                <label className="label">What do you need?</label>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {d.services.map((s) => (
                    <button key={s.id} onClick={() => setService(s.id)}
                      className={`relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-300
                        ${service === s.id
                          ? 'border-glacier-400/50 bg-glacier-400/10'
                          : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      {service === s.id && (
                        <motion.span layoutId="svc" className="absolute inset-0 -z-10 bg-glacier-400/[.07]"
                          transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
                      )}
                      <div className="flex items-center justify-between">
                        <span className={`text-[13px] font-bold ${service === s.id ? 'text-glacier-200' : 'text-frost-100'}`}>{s.label}</span>
                        {service === s.id && <Check className="h-4 w-4 text-glacier-300" />}
                      </div>
                      <div className="mt-1 text-[11px] text-frost-400">{s.note}</div>
                      <div className="mt-2 font-mono text-[11px] text-frost-300">from {pkr(s.base_pkr)}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Pickup</label>
                    <select value={pickup} onChange={(e) => setPickup(e.target.value)} className="field">
                      {d.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Drop-off</label>
                    <select value={dropoff} onChange={(e) => setDropoff(e.target.value)} className="field">
                      {d.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Passengers</label>
                    <input type="number" min="1" max="12" value={passengers}
                           onChange={(e) => setPassengers(+e.target.value)} className="field" />
                  </div>
                  <div>
                    <label className="label">Road distance</label>
                    <div className="field flex items-center gap-2 !py-3 text-frost-300">
                      <Navigation className={`h-3.5 w-3.5 text-glacier-300 ${quoting ? 'animate-pulse' : ''}`} />
                      {quoting
                        ? <span className="text-frost-400">routing…</span>
                        : quote?.distance_km != null
                          ? <span><span className="text-frost-100">{quote.distance_km} km</span>
                              <span className="text-frost-400"> · {formatMins(quote.duration_min)}</span></span>
                          : <span className="text-frost-400">—</span>}
                    </div>
                  </div>
                </div>

                <FarePanel quote={quote} quoting={quoting} error={quoteError} />

                <div className="mt-4">
                  <label className="label">Notes for the operator</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field"
                         placeholder="Two large bags, need a child seat, English-speaking driver…" />
                </div>

                <button onClick={submit} className="btn-primary mt-6 w-full">
                  <Zap className="h-4 w-4" /> Request and match me now
                </button>
                <p className="mt-3 text-center text-[11px] text-frost-400">
                  Operators have 45 seconds to respond. You are not charged until you accept an offer.
                </p>
              </motion.div>
            )}

            {phase === 'searching' && (
              <motion.div key="searching"
                initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.45, ease }} className="space-y-4">

                <div className="glass relative overflow-hidden rounded-2xl p-8 text-center">
                  <RadarSweep />
                  <div className="relative">
                    <div className="text-[13px] font-bold uppercase tracking-[.18em] text-glacier-300">Matching you now</div>
                    <div className="mt-2 text-2xl font-extrabold text-frost-50">
                      {offers.length === 0 ? 'Reaching nearby operators…' : `${offers.length} offer${offers.length > 1 ? 's' : ''} in`}
                    </div>
                    <div className="mt-1 text-[13px] text-frost-400">{pickup} → {dropoff} · {passengers} pax</div>
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/[.05] px-4 py-2 font-mono text-[13px] text-frost-100">
                      <Clock className="h-3.5 w-3.5 text-amberz-300" /> {countdown}s left
                    </div>
                    <div className="mx-auto mt-4 h-1 w-56 overflow-hidden rounded-full bg-white/10">
                      <motion.div className="h-full bg-gradient-to-r from-glacier-300 to-amberz-400"
                        initial={{ width: '100%' }} animate={{ width: '0%' }}
                        transition={{ duration: request?.expires_in || 45, ease: 'linear' }} />
                    </div>
                    <div className="mt-4 text-[12px] text-frost-400">
                      Reference quote <span className="font-mono text-frost-200">{pkr(request?.estimate_pkr)}</span>
                    </div>
                    <button onClick={reset} className="btn-ghost mt-5 !py-2 !text-[12px]"><X className="h-3.5 w-3.5" /> Cancel request</button>
                  </div>
                </div>

                <AnimatePresence>
                  {offers.map((o, i) => (
                    <motion.div key={o.id}
                      initial={{ opacity: 0, x: 40, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -40 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 26, delay: i * 0.04 }}
                      className="glass rounded-2xl p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black text-ink-950"
                              style={{ background: `hsl(${o.operator.avatar_hue} 70% 62%)` }}>
                          {o.operator.name[0]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[14px] font-bold text-frost-50">
                            {o.operator.name}
                            {o.operator.verified && <BadgeCheck className="h-3.5 w-3.5 text-glacier-300" />}
                            {o.simulated && (
                              <span
                                title="No operator app is connected for this company, so the platform answered on their behalf. Open /operator in another tab to bid for real."
                                className="rounded-full border border-amberz-400/40 bg-amberz-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amberz-200">
                                stand-in
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-frost-400">
                            <Stars value={o.operator.rating} />
                            <span>{o.operator.trips} trips</span>
                            <span>{o.operator.base}</span>
                          </div>
                          {o.message && <p className="mt-2 text-[12.5px] leading-relaxed text-frost-300">“{o.message}”</p>}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {o.operator.vehicles.slice(0, 2).map((v) => <span key={v} className="chip !text-[10px]"><CarFront className="h-3 w-3" /> {v}</span>)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[17px] font-bold text-frost-50">{pkr(o.price_pkr)}</div>
                          <div className="mt-0.5 text-[11px] text-frost-400">ETA {o.eta_min} min</div>
                          <button onClick={() => accept(o)} className="btn-primary mt-3 !px-4 !py-2 !text-[12px]">Accept</button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}

            {phase === 'confirmed' && trip && (
              <motion.div key="confirmed"
                initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.45, ease }} className="glass rounded-2xl p-6">
                <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: 'spring', stiffness: 250, damping: 16 }}
                            className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Check className="h-8 w-8" strokeWidth={3} />
                </motion.div>
                <div className="mt-4 text-center">
                  <div className="text-xl font-extrabold text-frost-50">Trip confirmed</div>
                  <div className="mt-1 text-[13px] text-frost-300">
                    {trip.accepted_by.operator.name} · {pkr(trip.accepted_by.price_pkr)} · ETA {trip.accepted_by.eta_min} min
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-frost-400">{trip.id}</div>
                </div>

                {/* live tracking timeline */}
                <div className="mt-8">
                  <div className="mb-4 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Live trip tracking</div>
                  <div className="space-y-0">
                    {STAGE_STEPS.map(([key, label], i) => {
                      const idx = STAGE_STEPS.findIndex(([k]) => k === stage)
                      const done = idx >= i && idx !== -1
                      const active = stage === key
                      return (
                        <div key={key} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <motion.span
                              animate={{ scale: active ? [1, 1.35, 1] : 1 }}
                              transition={{ repeat: active ? Infinity : 0, duration: 1.8 }}
                              className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold transition-colors duration-500
                                ${done ? 'bg-glacier-400 text-ink-950' : 'bg-white/10 text-frost-400'}`}>
                              {done ? <Check className="h-3 w-3" strokeWidth={3.5} /> : i + 1}
                            </motion.span>
                            {i < STAGE_STEPS.length - 1 && (
                              <span className="relative my-1 h-8 w-px bg-white/10">
                                <motion.span className="absolute inset-x-0 top-0 bg-glacier-400"
                                  initial={{ height: 0 }} animate={{ height: done ? '100%' : 0 }}
                                  transition={{ duration: 0.6, ease }} />
                              </span>
                            )}
                          </div>
                          <div className={`pb-2 pt-0.5 text-[13px] font-semibold transition-colors duration-500
                            ${done ? 'text-frost-50' : 'text-frost-400'}`}>
                            {label}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <button onClick={reset} className="btn-ghost mt-6 w-full !py-2.5 !text-[13px]">
                  <RotateCcw className="h-3.5 w-3.5" /> Book another trip
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <RideHistory items={history} />
        </div>

        {/* ------------------------------------------------ right column */}
        <aside className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">
              <Radar className="h-3.5 w-3.5 text-glacier-300" /> Dispatch feed
            </div>
            <div className="max-h-[320px] space-y-2 overflow-y-auto no-scrollbar">
              <AnimatePresence initial={false}>
                {feed.length === 0 && (
                  <p className="text-[12.5px] leading-relaxed text-frost-400">
                    Post a request and every dispatch event — operator notified, offer received,
                    declined, trip stage — streams here over the same WebSocket the operator app uses.
                  </p>
                )}
                {feed.map((f) => (
                  <motion.div key={f.id}
                    initial={{ opacity: 0, x: 24, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease }}
                    className="flex items-start gap-2 text-[12px] leading-relaxed">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full
                      ${f.tone === 'good' ? 'bg-emerald-400' : f.tone === 'bad' ? 'bg-rose-400' : 'bg-glacier-400'}`} />
                    <span className="text-frost-300">{f.text}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Operators online</div>
            <div className="space-y-3">
              {d.operators.map((o) => (
                <div key={o.id} className="flex items-center gap-3">
                  <span className="relative grid h-8 w-8 place-items-center rounded-lg text-[11px] font-black text-ink-950"
                        style={{ background: `hsl(${o.avatar_hue} 70% 62%)` }}>
                    {o.name[0]}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-ink-950" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-frost-100">{o.name}</div>
                    <div className="text-[11px] text-frost-400">{o.base} · responds in ~{o.response_min} min</div>
                  </div>
                  <Stars value={o.rating} />
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-frost-100">
              <MapPin className="h-3.5 w-3.5 text-amberz-300" /> Why this matters here
            </div>
            <p className="text-[12.5px] leading-relaxed text-frost-400">
              Last-minute transport in the North is arranged by phoning strangers from a Facebook
              group. Request-and-match puts the same trip in front of registered operators with a
              price, a rating and a trip record behind it.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- radar viz */
function RadarSweep() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-70">
      <div className="relative h-56 w-56">
        {[0, 1, 2].map((i) => (
          <span key={i}
            className="absolute inset-0 rounded-full border border-glacier-400/25 animate-ping2"
            style={{ animationDelay: `${i * 0.85}s` }} />
        ))}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ background: 'conic-gradient(from 0deg, rgba(56,201,214,.28), transparent 32%)' }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 3.6, ease: 'linear' }}
        />
        <div className="absolute inset-[38%] rounded-full bg-glacier-400/25 blur-md" />
      </div>
    </div>
  )
}


/** Live fare, with the routing evidence that produced it. */
function FarePanel({ quote, quoting, error }) {
  if (error) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[.07] px-4 py-3 text-[12px] text-rose-200">
        {error}
      </motion.div>
    )
  }
  if (!quote && !quoting) return null

  const measured = quote?.route_method === 'osrm'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="relative mt-4 overflow-hidden rounded-2xl border border-glacier-400/25 bg-gradient-to-br from-glacier-400/[.10] via-white/[.03] to-transparent p-4"
    >
      {/* slow sheen so a live number feels live */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[.07] to-transparent"
        animate={{ x: ['0%', '420%'] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.6 }}
      />
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.16em] text-frost-400">
            Estimated fare
          </div>
          <AnimatePresence mode="popLayout">
            <motion.div
              key={quote?.estimate_pkr ?? 'loading'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease }}
              className="font-display text-2xl font-extrabold text-frost-50"
            >
              {quoting && !quote ? '···' : pkr(quote.estimate_pkr)}
            </motion.div>
          </AnimatePresence>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide
          ${measured
            ? 'border-glacier-400/40 bg-glacier-400/10 text-glacier-200'
            : 'border-amberz-400/40 bg-amberz-400/10 text-amberz-200'}`}>
          {measured ? 'measured route' : 'estimated'}
        </span>
      </div>
      {quote && (
        <p className="mt-2 text-[11px] leading-relaxed text-frost-400">
          {quote.priced_on === 'day-rate'
            ? 'Day rate — guides and porters are not priced by distance.'
            : quote.route_note}
        </p>
      )}
    </motion.div>
  )
}

function formatMins(mins) {
  if (mins == null) return '—'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function cleanError(msg) {
  try {
    const parsed = JSON.parse(msg)
    return parsed.detail || msg
  } catch { return msg }
}

/** Real, persisted rides for this browser — not the in-flight animation. */
function RideHistory({ items }) {
  if (!items?.length) return null
  const tone = {
    completed: 'text-glacier-300 border-glacier-400/30 bg-glacier-400/10',
    confirmed: 'text-glacier-200 border-glacier-400/30 bg-glacier-400/10',
    searching: 'text-amberz-200 border-amberz-400/30 bg-amberz-400/10',
    expired: 'text-frost-400 border-white/10 bg-white/[.04]',
    cancelled: 'text-frost-400 border-white/10 bg-white/[.04]',
  }
  return (
    <Reveal>
      <div className="glass mt-6 rounded-2xl p-5">
        <div className="mb-3 flex items-center gap-2">
          <RotateCcw className="h-3.5 w-3.5 text-glacier-300" />
          <span className="text-[12px] font-bold text-frost-100">Your rides</span>
          <span className="text-[10px] text-frost-400">· stored records</span>
        </div>
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {items.slice(0, 6).map((t, i) => (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, delay: i * 0.04, ease }}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-frost-100">
                    {t.pickup} → {t.dropoff}
                  </div>
                  <div className="mt-0.5 text-[10px] text-frost-400">
                    {t.distance_km != null ? `${t.distance_km} km` : '—'}
                    {t.duration_min != null && ` · ${formatMins(t.duration_min)}`}
                    {' · '}{pkr(t.agreed_pkr || t.estimate_pkr)}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone[t.status] || tone.expired}`}>
                  {t.status}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </Reveal>
  )
}

/**
 * Fare computed in the browser, using the same rates the API uses.
 *
 * Only reached when the backend is unreachable. Guides and porters are
 * day-rated (per_km is 0), so distance must not inflate them.
 */
function localFare(d, serviceId, km, passengers) {
  const svc = (d?.services || []).find((s) => s.id === serviceId) || (d?.services || [])[0]
  if (!svc) return { estimate_pkr: 0, priced_on: 'distance' }
  const byDistance = svc.per_km > 0
  let price = svc.base_pkr + (byDistance ? svc.per_km * km : 0)
  if (passengers > 4) price = Math.round(price * 1.25)
  return {
    estimate_pkr: Math.round(price / 500) * 500,
    priced_on: byDistance ? 'distance' : 'day-rate',
  }
}
