import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck, Bell, Check, Clock, MapPin, Power, Users, X,
  TrendingUp, Wallet, Star, Inbox,
} from 'lucide-react'

import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { useAuth } from '../lib/auth'
import Guard from '../components/Guard'
import { api, pkr, wsUrl } from '../lib/api'
import { closeSocket } from '../lib/socket'
import { Reveal, SectionTitle, ease, useToast } from '../components/ui'

const WINDOW = 45

export default function Operator() {
  return (
    <Guard role="operator" reason="Sign in with your operator account to open the console">
      <Console />
    </Guard>
  )
}

function Console() {
  const d = useData()
  const auth = useAuth()
  const toast = useToast()
  // An operator account works its own queue; an admin can look at any.
  const [opId, setOpId] = useState(() => auth.profile?.operator_id || 'op-karakoram')
  useEffect(() => { if (auth.role === 'operator' && auth.profile?.operator_id) setOpId(auth.profile.operator_id) }, [auth.role, auth.profile])
  const [online, setOnline] = useState(true)
  const [jobs, setJobs] = useState([])
  const [confirmed, setConfirmed] = useState([])
  const wsRef = useRef(null)

  const op = (d.operators || []).find((o) => o.id === opId)

  /* ------------------------------------------------- operator socket */
  useEffect(() => {
    // Wait until the API has answered: until then there is no dispatcher
    // to open a socket to, and the store keeps retrying in the background.
    if (d?.offline || !d?.ready) return undefined
    const ws = new WebSocket(wsUrl(`/ws/operator/${opId}`))
    wsRef.current = ws
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.type === 'hello') setJobs((m.open_jobs || []).map(withDeadline))
      if (m.type === 'job.offered') {
        setJobs((j) => [withDeadline(m.request), ...j.filter((x) => x.id !== m.request.id)])
        toast('New job request from ' + m.request.pickup)
      }
      if (m.type === 'job.confirmed') {
        setConfirmed((c) => [m.request, ...c])
        setJobs((j) => j.filter((x) => x.id !== m.request.id))
        toast('You won the job — ' + m.request.id)
      }
      if (m.type === 'job.taken') setJobs((j) => j.filter((x) => x.id !== m.request_id))
    }
    return () => closeSocket(ws)
  }, [opId, toast, d?.offline, d?.ready])

  /* countdown tick */
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setJobs([]); setConfirmed([])
    if (d?.offline || !d?.ready) return
    api.jobs(opId).then((r) => setJobs((r.open || []).map(withDeadline)))
      .catch((e) => toast('Could not load your jobs: ' + e.message, 'bad'))
  }, [opId, d?.offline, d?.ready, toast])

  const toggle = async () => {
    const next = !online
    setOnline(next)
    try {
      await api.availability(opId, next)
      toast(next ? 'You are online — jobs will be dispatched to you.' : 'You are offline.', next ? 'ok' : 'warn')
    } catch (e) {
      setOnline(!next)
      toast('Could not change availability: ' + e.message, 'bad')
    }
  }

  const bid = async (job, delta = 0) => {
    try {
      await api.offer(job.id, {
        operator_id: opId,
        price_pkr: Math.max(3000, job.estimate_pkr + delta),
        eta_min: 12 + Math.round(Math.random() * 18),
        message: delta < 0 ? 'Can beat the reference quote, vehicle is ready now.' : 'Available immediately.',
      })
      toast('Offer sent')
      setJobs((j) => j.map((x) => (x.id === job.id ? { ...x, bid: true } : x)))
    } catch { toast('That job is no longer open.', 'warn') }
  }

  const decline = async (job) => {
    try {
      await api.reject(job.id, { operator_id: opId, reason: 'Vehicle already booked' })
      setJobs((j) => j.filter((x) => x.id !== job.id))
    } catch (e) {
      toast('Could not decline: ' + e.message, 'bad')
    }
  }

  if (!d.ready) return <div className="px-5 py-32 text-center text-frost-400">Loading console…</div>

  const earnings = confirmed.reduce((s, c) => s + (c.accepted_by?.price_pkr || 0), 0)

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8">
      {d?.offline && (
        <div className="mb-6 flex items-center gap-2 text-[12px] text-frost-400" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-glacier-300 border-t-transparent" />
          Connecting to the dispatcher…
        </div>
      )}

      <Reveal>
        <SectionTitle
          eyebrow="Operator side"
          title="The operator console."
          sub="The counterpart app: accept or decline incoming jobs inside the response window, bid a price, and flip your availability. Open this in a second tab alongside Instant to watch a match happen end to end."
          right={
            <button onClick={toggle}
              className={`btn !px-4 !py-2.5 !text-[13px] ${online
                ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border border-white/10 bg-white/[.04] text-frost-400'}`}>
              <Power className="h-3.5 w-3.5" /> {online ? 'Online' : 'Offline'}
            </button>
          }
        />
      </Reveal>

      <Reveal delay={0.03}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Link to="/admin" className="btn-ghost !px-3.5 !py-2 !text-[12.5px]">Manage packages & bookings</Link>
          <Link to="/conditions" className="btn-ghost !px-3.5 !py-2 !text-[12.5px]">Update road status</Link>
          <Link to="/developers" className="btn-ghost !px-3.5 !py-2 !text-[12.5px]">API keys</Link>
        </div>
      </Reveal>

      {/* operator switcher (admins only; an operator account is fixed to its own) */}
      {auth.isAdmin && (
      <Reveal delay={0.05}>
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {d.operators.map((o) => (
            <button key={o.id} onClick={() => setOpId(o.id)}
              className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-300
                ${opId === o.id ? 'border-glacier-400/50 bg-glacier-400/10' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
              <span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-black text-abyss"
                    style={{ background: `hsl(${o.avatar_hue} 70% 62%)` }}>{o.name[0]}</span>
              <span className="text-left">
                <span className={`block text-[12.5px] font-bold ${opId === o.id ? 'text-glacier-200' : 'text-frost-100'}`}>{o.name}</span>
                <span className="block text-[10.5px] text-frost-400">{o.base}</span>
              </span>
            </button>
          ))}
        </div>
      </Reveal>
      )}

      {/* stat row */}
      <Reveal delay={0.08}>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={Inbox} label="Open requests" value={jobs.length} tone="glacier" />
          <Stat icon={Check} label="Won today" value={confirmed.length} tone="emerald" />
          <Stat icon={Wallet} label="Earnings today" value={pkr(earnings)} tone="amberz" mono />
          <Stat icon={Star} label="Rating" value={op?.rating ?? '—'} tone="amberz" />
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* job queue */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">
            <Bell className="h-3.5 w-3.5 text-glacier-300" /> Incoming job requests
          </div>

          <AnimatePresence initial={false}>
            {jobs.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="glass rounded-2xl p-10 text-center">
                <Inbox className="mx-auto h-7 w-7 text-frost-400" strokeWidth={1.6} />
                <div className="mt-3 text-[14px] font-bold text-frost-100">No open requests</div>
                <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-frost-400">
                  Post one from the <span className="text-glacier-300">Instant</span> page in another tab —
                  it will arrive here over the WebSocket within a couple of seconds.
                </p>
              </motion.div>
            )}

            {jobs.map((job) => {
              const left = Math.max(0, Math.round((job._deadline - Date.now()) / 1000))
              const svc = d.services.find((s) => s.id === job.service)
              return (
                <motion.div key={job.id} layout
                  initial={{ opacity: 0, x: 40, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -40, height: 0, marginBottom: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  className="glass mb-3 overflow-hidden rounded-2xl">
                  <div className="h-0.5 bg-white/[.06]">
                    <motion.div className={`h-full ${left < 12 ? 'bg-rose-400' : 'bg-glacier-400'}`}
                      animate={{ width: `${(left / WINDOW) * 100}%` }} transition={{ duration: 1, ease: 'linear' }} />
                  </div>
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[14px] font-bold text-frost-50">{svc?.label || job.service}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-frost-300">
                          <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-glacier-300" />{job.pickup} → {job.dropoff}</span>
                          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{job.passengers} pax</span>
                          <span>{job.distance_km} km</span>
                        </div>
                        {job.notes && <p className="mt-2 text-[12.5px] italic text-frost-400">“{job.notes}”</p>}
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-frost-400">reference</div>
                        <div className="font-mono text-[16px] font-bold text-frost-50">{pkr(job.estimate_pkr)}</div>
                        <div className={`mt-1 inline-flex items-center gap-1 font-mono text-[11px] ${left < 12 ? 'text-rose-300' : 'text-frost-400'}`}>
                          <Clock className="h-3 w-3" /> {left}s
                        </div>
                      </div>
                    </div>

                    {job.bid ? (
                      <div className="mt-4 rounded-xl bg-emerald-400/10 px-4 py-2.5 text-center text-[12.5px] font-semibold text-emerald-300">
                        Offer sent — waiting for the traveler
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => bid(job, -1500)} className="btn-primary flex-1 !py-2.5 !text-[12.5px]">
                          <Check className="h-3.5 w-3.5" /> Bid {pkr(Math.max(3000, job.estimate_pkr - 1500))}
                        </button>
                        <button onClick={() => bid(job, 0)} className="btn-ghost !py-2.5 !text-[12.5px]">
                          At reference
                        </button>
                        <button onClick={() => decline(job)} className="btn-ghost !px-3 !py-2.5 text-frost-400 hover:text-rose-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          {confirmed.length > 0 && (
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-300" /> Confirmed jobs
              </div>
              {confirmed.map((c) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                  className="glass mb-2 flex items-center justify-between rounded-xl p-4">
                  <div>
                    <div className="text-[13px] font-bold text-frost-50">{c.pickup} → {c.dropoff}</div>
                    <div className="font-mono text-[11px] text-frost-400">{c.id}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-bold text-emerald-300">{pkr(c.accepted_by?.price_pkr)}</div>
                    <div className="text-[11px] text-frost-400">ETA {c.accepted_by?.eta_min} min</div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* verification rail */}
        <aside className="space-y-4">
          {op && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl text-sm font-black text-abyss"
                      style={{ background: `hsl(${op.avatar_hue} 70% 62%)` }}>{op.name[0]}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold text-frost-50">
                    <span className="truncate">{op.name}</span>
                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-glacier-300" />
                  </div>
                  <div className="text-[11px] text-frost-400">since {op.since} · {op.trips} trips</div>
                </div>
              </div>
              <div className="hairline my-4" />
              <div className="text-[10px] font-bold uppercase tracking-[.16em] text-frost-400">Verification</div>
              <div className="mt-2 font-mono text-[11px] text-glacier-300">{op.verification.tourism_dept_reg}</div>
              <div className="mt-3 space-y-1.5">
                {op.verification.checks.map((c) => (
                  <div key={c} className="flex items-start gap-2 text-[11.5px] text-frost-300">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" /> {c}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="glass rounded-2xl p-5">
            <div className="mb-2 text-[12px] font-bold text-frost-100">How dispatch works</div>
            <ol className="space-y-2.5 text-[12px] leading-relaxed text-frost-400">
              {[
                'Traveler posts a request with pickup, drop-off and passengers.',
                'The dispatcher ranks operators by proximity, rating and response time.',
                'Each gets the job over WebSocket, staggered ~1.6 s apart.',
                'Offers with a price and ETA flow back; the traveler picks one.',
                'The winner gets job.confirmed; everyone else gets job.taken.',
              ].map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-bold text-frost-200">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  )
}

function withDeadline(job) {
  return { ...job, _deadline: Date.now() + WINDOW * 1000 }
}

function Stat({ icon: Icon, label, value, tone, mono }) {
  const tones = {
    glacier: 'text-glacier-300 bg-glacier-400/10',
    emerald: 'text-emerald-300 bg-emerald-400/10',
    amberz: 'text-amberz-300 bg-amberz-400/10',
  }
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}
      className="glass rounded-2xl p-4">
      <div className={`mb-3 grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`text-xl font-bold text-frost-50 ${mono ? 'font-mono text-[17px]' : ''}`}>{value}</div>
      <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-frost-400">{label}</div>
    </motion.div>
  )
}
