import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowLeft, BadgeCheck, CalendarDays, Check, Users, X as XIcon,
  ShieldCheck, FileCheck2, AlertTriangle, Languages, Car, Heart, Share2,
  MessageCircle, ExternalLink,
} from 'lucide-react'

import { api, pkr, relTime, whatsappUrl } from '../lib/api'
import { useData } from '../lib/store'
import { useWishlist } from '../lib/wishlist'
import { Scene, sceneFor } from '../lib/scenes'
import PlacePhoto from '../components/PlacePhoto'
import Restaurants from '../components/Restaurants'
import { Gallery, sharePackage, usePackageActions } from '../components/PackageActions'
import { Reveal, Skeleton, StatusPill, Stars, ease, useToast } from '../components/ui'

export default function PackageDetail() {
  const { id } = useParams()
  const d = useData() || {}
  const [pkg, setPkg] = useState(null)
  const toast = useToast()
  const actions = usePackageActions()
  const wish = useWishlist()

  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 500], [0, 120])

  /* The detail view fetches its own package so it gets the joined route
     conditions and active alerts. If that call fails the trip has not
     stopped existing — the API is simply unreachable — so fall back to the
     copy already loaded by the store and rebuild those two fields locally.
     Reporting "Trip not found" for a network error sent people looking for
     a missing package that was there all along. */
  useEffect(() => {
    let alive = true
    api.package(id)
      .then((p) => { if (alive) setPkg(p) })
      .catch(() => {
        if (!alive) return
        const local = (d.packages || []).find((p) => p.id === id)
        // Still loading shared data: keep the skeleton rather than
        // declaring a package missing that simply has not arrived yet.
        if (!local) { if (d.ready) setPkg(false); return }
        const routes = local.routes || []
        const dest = (d.destinations || []).find((x) => x.name === local.destination)
        setPkg({
          ...local,
          route_conditions: (d.routes || []).filter((r) => routes.includes(r.id)),
          active_alerts: (d.alerts || []).filter(
            (a) => (a.routes || []).some((r) => routes.includes(r))),
          destination_info: dest ? { id: dest.id, name: dest.name, lat: dest.lat, lon: dest.lon,
                                     elevation_m: dest.elevation_m, attractions: dest.attractions, blurb: dest.blurb } : null,
        })
      })
    return () => { alive = false }
  }, [id, d.ready, d.packages, d.routes, d.alerts, d.destinations])

  if (pkg === false) return (
    <div className="mx-auto max-w-3xl px-5 py-32 text-center">
      <p className="text-frost-100">No trip with that id.</p>
      <p className="mt-2 text-[13px] text-frost-400">
        It may have been removed, or the link is wrong.
      </p>
      <Link to="/explore" className="btn-primary mt-6 inline-flex">
        <ArrowLeft className="h-4 w-4" /> Back to all packages
      </Link>
    </div>
  )
  if (!pkg) return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
      <Skeleton className="h-72 rounded-3xl" />
      <Skeleton className="mt-6 h-10 w-2/3" />
      <Skeleton className="mt-3 h-24" />
    </div>
  )

  const saved = wish.has(pkg.id)
  const wa = whatsappUrl(pkg)
  const dest = pkg.destination_info

  return (
    <div className="pb-20">
      {/* hero */}
      <div className="on-photo relative h-[56vh] min-h-[360px] overflow-hidden bg-abyss">
        <motion.div style={{ y: heroY }} className="absolute inset-0 scale-110">
          <Scene name={sceneFor(pkg)} className="absolute inset-0 h-full w-full" />
          <PlacePhoto query={pkg.photo_query || pkg.destination} name={pkg.destination} images={pkg.images}
                      large eager className="absolute inset-0 h-full w-full" imgClassName="animate-kenburns" />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-abyss via-abyss/45 to-abyss/30" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-5xl px-5 pb-8 sm:px-8">
            <Link to="/explore" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-frost-300 transition hover:text-frost-50">
              <ArrowLeft className="h-3.5 w-3.5" /> All packages
            </Link>
            <motion.div initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease }}>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {pkg.tags.map((t) => <span key={t} className="chip !text-[10px]">{t}</span>)}
              </div>
              <h1 className="max-w-3xl text-3xl font-bold leading-[1.08] tracking-tight text-frost-50 sm:text-5xl">
                {pkg.title}
              </h1>
              {pkg.highlight && <p className="mt-3 max-w-2xl text-[15px] text-frost-200">{pkg.highlight}</p>}
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

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-5 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          {/* photos */}
          <Reveal>
            <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Photos</h2>
            <div className="glass overflow-hidden rounded-2xl"><Gallery pkg={pkg} /></div>
          </Reveal>

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

          {/* where to eat */}
          {dest?.lat != null && (
            <Reveal>
              <Restaurants destination={dest.name} center={{ lat: dest.lat, lon: dest.lon }} />
            </Reveal>
          )}

          {/* operator verification */}
          <Reveal>
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl text-sm font-black text-abyss"
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

              <button onClick={() => actions.openBooking(pkg)} className="btn-primary mt-6 w-full">Book now</button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => toast(wish.toggle(pkg.id) ? 'Saved to your wishlist' : 'Removed from your wishlist')}
                  aria-pressed={saved}
                  className={`btn-ghost !px-3 !py-2.5 !text-[12.5px] ${saved ? '!border-rose-400/40 !text-rose-300' : ''}`}>
                  <Heart className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`} /> {saved ? 'Saved' : 'Wishlist'}
                </button>
                <button onClick={() => sharePackage(pkg, toast)} className="btn-ghost !px-3 !py-2.5 !text-[12.5px]">
                  <Share2 className="h-3.5 w-3.5" /> Share
                </button>
              </div>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer noopener" className="btn-ghost mt-2 w-full !py-2.5 !text-[12.5px]">
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-300" /> Contact on WhatsApp
                </a>
              )}
              {pkg.operator_url && (
                <a href={pkg.operator_url} target="_blank" rel="noreferrer noopener" className="btn-ghost mt-2 w-full !py-2.5 !text-[12.5px]">
                  <ExternalLink className="h-3.5 w-3.5" /> Visit operator website
                </a>
              )}
              <Link to="/assistant" className="btn-ghost mt-2 w-full !py-2.5 !text-[12.5px]">Ask about conditions</Link>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-frost-400">
                No charge now. The operator confirms availability within {pkg.operator.response_min * 30} minutes.
              </p>
            </div>
          </Reveal>
        </aside>
      </div>

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
