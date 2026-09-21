import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowLeft, BadgeCheck, CalendarDays, Check, Users, X as XIcon,
  ShieldCheck, FileCheck2, AlertTriangle, Languages, Car,
} from 'lucide-react'

import { api, pkr, relTime, postToGateway } from '../lib/api'
import { Scene, sceneFor } from '../lib/scenes'
import { Reveal, Sheet, Skeleton, StatusPill, Stars, ease, useToast } from '../components/ui'

export default function PackageDetail() {
  const { id } = useParams()
  const [pkg, setPkg] = useState(null)
  const [booking, setBooking] = useState(false)
  const [paying, setPaying] = useState(false)
  const [confirmed, setConfirmed] = useState(null)
  const [travelers, setTravelers] = useState(2)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState('')
  const toast = useToast()

  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 500], [0, 120])

  useEffect(() => { api.package(id).then(setPkg).catch(() => setPkg(false)) }, [id])

  if (pkg === false) return <div className="mx-auto max-w-3xl px-5 py-32 text-center text-frost-300">Trip not found.</div>
  if (!pkg) return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <Skeleton className="h-72 rounded-3xl" />
      <Skeleton className="mt-6 h-10 w-2/3" />
      <Skeleton className="mt-3 h-24" />
    </div>
  )

  const submit = async () => {
    try {
      const res = await api.book({
        package_id: pkg.id, traveler_name: name || 'Traveler', phone,
        start_date: date, travelers,
      })
      setConfirmed(res)
      toast('Booking held — ' + res.booking_id)
    } catch (e) { toast('Booking failed: ' + e.message, 'bad') }
  }

  /** Hand the browser to the gateway; it returns to /pay/return. */
  const pay = async (provider) => {
    if (!confirmed) return
    setPaying(true)
    try {
      const checkout = await api.startPayment({
        booking_id: confirmed.booking_id, provider, phone,
      })
      postToGateway(checkout)
    } catch (e) {
      setPaying(false)
      toast('Could not start payment: ' + e.message, 'bad')
    }
  }

  return (
    <div className="pb-20">
      {/* hero */}
      <div className="relative h-[46vh] min-h-[320px] overflow-hidden">
        <motion.div style={{ y: heroY }} className="absolute inset-0">
          <Scene name={sceneFor(pkg)} className="h-full w-full scale-110" />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-ink-950/30" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-5xl px-5 pb-8 sm:px-8">
            <Link to="/explore" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-frost-300 transition hover:text-frost-50">
              <ArrowLeft className="h-3.5 w-3.5" /> All packages
            </Link>
            <motion.div initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease }}>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {pkg.tags.map((t) => <span key={t} className="chip !text-[10px]">{t}</span>)}
              </div>
              <h1 className="max-w-3xl text-3xl font-extrabold leading-[1.08] tracking-tight text-frost-50 sm:text-5xl">
                {pkg.title}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-frost-300">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-glacier-300" /> {pkg.days} days</span>
                <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-glacier-300" /> {pkg.group_size} travelers</span>
                <span className="chip !py-0.5">{pkg.difficulty}</span>
                <Stars value={pkg.rating} /> <span className="text-frost-400">({pkg.reviews} reviews)</span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 px-5 pt-10 sm:px-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-10">
          {/* live conditions on this route */}
          {pkg.route_conditions?.length > 0 && (
            <Reveal>
              <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Conditions on this route right now</h2>
              <div className="space-y-3">
                {pkg.active_alerts?.map((a) => (
                  <div key={a.id} className="glass flex items-start gap-3 rounded-xl border-rose-400/20 bg-rose-400/[.06] p-4">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                    <div>
                      <div className="text-[13px] font-bold text-rose-200">{a.title}</div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-frost-300">{a.body}</p>
                    </div>
                  </div>
                ))}
                {pkg.route_conditions.map((r) => (
                  <div key={r.id} className="glass rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[13px] font-bold text-frost-50">{r.name}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-frost-300">{r.status_note}</p>
                    <div className="mt-2 text-[11px] text-frost-400">{r.source} · {relTime(r.updated_at)}</div>
                    {r.permits.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {r.permits.map((p) => (
                          <span key={p} className="chip !text-[10px]"><FileCheck2 className="h-3 w-3 text-amberz-300" /> {p}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Reveal>
          )}

          {/* itinerary */}
          <Reveal>
            <h2 className="mb-5 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Day by day</h2>
            <ol className="relative space-y-5 border-l border-white/10 pl-6">
              {pkg.itinerary.map(([day, title, body], i) => (
                <motion.li key={i}
                  initial={{ opacity: 0, x: 18 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.55, delay: i * 0.06, ease }}
                  className="relative">
                  <span className="absolute -left-[31px] top-1 grid h-3 w-3 place-items-center rounded-full bg-glacier-400 ring-4 ring-glacier-400/15" />
                  <div className="text-[10px] font-bold uppercase tracking-[.16em] text-glacier-300">{day}</div>
                  <div className="mt-0.5 text-[15px] font-bold text-frost-50">{title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-frost-300">{body}</p>
                </motion.li>
              ))}
            </ol>
          </Reveal>

          {/* inclusions */}
          <Reveal>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="glass rounded-2xl p-5">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Included</h3>
                <ul className="space-y-2">
                  {pkg.includes.map((x) => (
                    <li key={x} className="flex items-start gap-2 text-[13px] text-frost-200">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> {x}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="glass rounded-2xl p-5">
                <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Not included</h3>
                <ul className="space-y-2">
                  {pkg.excludes.map((x) => (
                    <li key={x} className="flex items-start gap-2 text-[13px] text-frost-400">
                      <XIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400/80" /> {x}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>

          {/* operator verification */}
          <Reveal>
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl text-sm font-black text-ink-950"
                      style={{ background: `hsl(${pkg.operator.avatar_hue} 70% 62%)` }}>
                  {pkg.operator.name[0]}
                </span>
                <div>
                  <div className="flex items-center gap-2 text-[15px] font-bold text-frost-50">
                    {pkg.operator.name}
                    {pkg.operator.verified && <BadgeCheck className="h-4 w-4 text-glacier-300" />}
                  </div>
                  <div className="text-[12px] text-frost-400">
                    {pkg.operator.base} · since {pkg.operator.since} · {pkg.operator.trips} trips
                  </div>
                </div>
                <Stars value={pkg.operator.rating} className="ml-auto" />
              </div>

              <div className="hairline my-5" />

              <div className="flex items-center gap-2 text-[12px] font-semibold text-glacier-200">
                <ShieldCheck className="h-4 w-4" />
                Tourism dept. registration {pkg.operator.verification.tourism_dept_reg} · verified {pkg.operator.verification.verified_on}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pkg.operator.verification.checks.map((c) => (
                  <span key={c} className="chip !text-[10px]"><Check className="h-3 w-3 text-emerald-400" /> {c}</span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-frost-300">
                <span className="flex items-center gap-1.5"><Car className="h-3.5 w-3.5 text-frost-400" /> {pkg.operator.vehicles.join(' · ')}</span>
                <span className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5 text-frost-400" /> {pkg.operator.languages.join(' · ')}</span>
              </div>
            </div>
          </Reveal>
        </div>

        {/* booking rail */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <Reveal delay={0.1}>
            <div className="glass-strong rounded-2xl p-6">
              <div className="text-[10px] uppercase tracking-[.16em] text-frost-400">per person, all-in</div>
              <div className="mt-1 font-mono text-3xl font-bold text-frost-50">{pkr(pkg.price_pkr)}</div>
              <div className="mt-1 text-[12px] text-frost-400">{pkg.days} days · {pkg.pickup} → {pkg.destination}</div>

              <div className="hairline my-5" />

              <div className="space-y-2 text-[12.5px]">
                <Row k="Duration" v={`${pkg.days} days`} />
                <Row k="Group size" v={pkg.group_size} />
                <Row k="Difficulty" v={pkg.difficulty} />
                <Row k="Operator" v={pkg.operator.name} />
              </div>

              <button onClick={() => setBooking(true)} className="btn-primary mt-6 w-full">Reserve this trip</button>
              <Link to="/assistant" className="btn-ghost mt-2 w-full !py-2.5 !text-[13px]">Ask about conditions</Link>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-frost-400">
                No charge now. The operator confirms availability within {pkg.operator.response_min * 30} minutes.
              </p>
            </div>
          </Reveal>
        </aside>
      </div>

      {/* booking sheet */}
      <Sheet open={booking} onClose={() => { setBooking(false); setConfirmed(null) }} title={confirmed ? 'Booking confirmed' : 'Reserve your trip'}>
        {confirmed ? (
          <div className="space-y-5">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                        className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
              <Check className="h-8 w-8" strokeWidth={3} />
            </motion.div>
            <div className="text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amberz-300">
                Held — payment required
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-frost-50">{confirmed.booking_id}</div>
              <div className="mt-1 text-[13px] text-frost-300">{confirmed.package}</div>
              <div className="mt-0.5 text-[12px] text-frost-400">with {confirmed.operator}</div>
            </div>
            <div className="glass rounded-xl p-4 text-[13px]">
              <Row k="Travelers" v={confirmed.travelers} />
              <Row k="Total" v={pkr(confirmed.total_pkr)} />
            </div>
            {confirmed.condition_warnings?.length > 0 && (
              <div className="glass rounded-xl border-amberz-400/20 bg-amberz-400/[.06] p-4">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-amberz-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Condition alerts on your route
                </div>
                <ul className="space-y-1.5 text-[12px] leading-relaxed text-frost-300">
                  {confirmed.condition_warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
                <p className="mt-2.5 text-[11px] text-frost-400">
                  Sign in with your phone to get a push notification if this changes before
                  departure, with a reroute suggestion.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[12px] font-semibold text-frost-200">Pay to confirm</div>
              {(confirmed.payment?.providers || []).map((prov) => (
                <button
                  key={prov.id}
                  disabled={paying}
                  onClick={() => pay(prov.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-[13px] transition disabled:opacity-50
                    ${prov.configured
                      ? 'border-glacier-500/40 bg-glacier-500/10 text-frost-50 hover:border-glacier-400'
                      : 'border-ink-700 bg-ink-850 text-frost-400'}`}
                >
                  <span className="font-semibold">
                    {prov.id === 'mock' ? 'Sandbox gateway' : prov.name}
                  </span>
                  <span className="text-[11px]">
                    {prov.configured ? pkr(confirmed.total_pkr) : 'credentials needed'}
                  </span>
                </button>
              ))}
              <p className="text-[11px] text-frost-400">
                JazzCash and Easypaisa activate once merchant credentials are set. The
                sandbox gateway runs the same signed callback flow.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="As on your CNIC / passport" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="field" placeholder="+92 3xx xxxxxxx" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Start date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field" />
              </div>
              <div>
                <label className="label">Travelers</label>
                <input type="number" min="1" max="14" value={travelers}
                       onChange={(e) => setTravelers(+e.target.value)} className="field" />
              </div>
            </div>
            <div className="glass rounded-xl p-4">
              <Row k={`${pkr(pkg.price_pkr)} × ${travelers}`} v={pkr(pkg.price_pkr * travelers)} />
            </div>
            <button onClick={submit} className="btn-primary w-full">Confirm reservation</button>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-frost-400">{k}</span>
      <span className="font-semibold text-frost-100">{v}</span>
    </div>
  )
}
