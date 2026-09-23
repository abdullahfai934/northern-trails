import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, Heart,
  MapPin, MessageCircle, Share2, ShieldCheck, Users, X as XIcon,
} from 'lucide-react'

import { pkr, whatsappUrl } from '../lib/api'
import { useWishlist } from '../lib/wishlist'
import PlacePhoto from './PlacePhoto'
import BookingFlow from './BookingFlow'
import { Modal, Sheet, Stars, ease, useToast } from './ui'

/**
 * One details modal and one booking sheet for the whole app.
 *
 * Cards call `openDetails(pkg)` / `openBooking(pkg)` instead of mounting
 * their own, so a carousel that renders each card several times still has a
 * single modal, and opening "Book now" from inside the details modal swaps
 * one for the other cleanly.
 */
const Ctx = createContext(null)
export const usePackageActions = () => useContext(Ctx)

export function sharePackage(pkg, toast) {
  const url = `${window.location.origin}/explore/${pkg.id}`
  const text = `${pkg.title} — ${pkg.days} days, ${pkr(pkg.price_pkr)} per person`
  if (navigator.share) {
    return navigator.share({ title: pkg.title, text, url }).catch((e) => {
      if (e?.name !== 'AbortError') toast?.('Could not open the share sheet', 'bad')
    })
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(url)
      .then(() => toast?.('Link copied to clipboard'))
      .catch(() => toast?.(url))
  }
  toast?.(url)
  return Promise.resolve()
}

export function PackageActionsProvider({ children }) {
  const [details, setDetails] = useState(null)
  const [booking, setBooking] = useState(null)

  const openDetails = useCallback((pkg) => setDetails(pkg), [])
  const openBooking = useCallback((pkg) => { setDetails(null); setBooking(pkg) }, [])
  const value = useMemo(() => ({ openDetails, openBooking }), [openDetails, openBooking])

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal open={Boolean(details)} onClose={() => setDetails(null)} title={details?.title || ''} wide>
        {details && <PackageDetails pkg={details} onBook={() => openBooking(details)} onClose={() => setDetails(null)} />}
      </Modal>
      <Sheet open={Boolean(booking)} onClose={() => setBooking(null)} title="Reserve your trip">
        {booking && <BookingFlow key={booking.id} pkg={booking} onDone={() => setBooking(null)} />}
      </Sheet>
    </Ctx.Provider>
  )
}

/* ------------------------------------------------------------- gallery */
export function Gallery({ pkg }) {
  const [photos, setPhotos] = useState([])
  const [i, setI] = useState(0)
  const n = Math.max(1, photos.length)
  const go = (d) => setI((v) => (v + d + n) % n)
  const onPhotos = useCallback((list) => setPhotos(list), [])

  return (
    <div>
      <div className="relative aspect-[16/9] overflow-hidden bg-ink-850 sm:aspect-[21/9]">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={i} className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease }}>
            <PlacePhoto query={pkg.photo_query || pkg.destination} name={pkg.destination} images={pkg.images}
                        index={i} large credit count={8} eager className="h-full w-full" onPhotos={i === 0 ? onPhotos : undefined} />
          </motion.div>
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous photo"
              className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-abyss/50 text-snow backdrop-blur transition hover:bg-abyss/70">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => go(1)} aria-label="Next photo"
              className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-abyss/50 text-snow backdrop-blur transition hover:bg-abyss/70">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-5 py-3 no-scrollbar">
          {photos.map((p, idx) => (
            <button key={p.id} onClick={() => setI(idx)} aria-label={`Photo ${idx + 1}`}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition
                ${idx === i ? 'ring-glacier-400' : 'ring-transparent opacity-60 hover:opacity-100'}`}>
              <span className="absolute inset-0 bg-gradient-to-br from-glacier-400/30 to-ink-800" />
              <img src={p.thumb || p.url} alt="" loading="lazy" className="relative h-full w-full object-cover"
                   onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------ details content */
function PackageDetails({ pkg, onBook, onClose }) {
  const wish = useWishlist()
  const toast = useToast()
  const saved = wish.has(pkg.id)
  const wa = whatsappUrl(pkg)

  return (
    <div>
      <Gallery pkg={pkg} />
      <div className="grid grid-cols-1 gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-7">
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-frost-300">
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-glacier-300" /> {pkg.pickup} → {pkg.destination}</span>
              <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-glacier-300" /> {pkg.days} days</span>
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-glacier-300" /> {pkg.group_size}</span>
              <Stars value={pkg.rating} />
            </div>
            {pkg.highlight && <p className="mt-3 text-[15px] leading-relaxed text-frost-100">{pkg.highlight}</p>}
          </div>

          <section>
            <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Itinerary, day by day</h4>
            <ol className="relative space-y-4 border-l border-white/10 pl-6">
              {pkg.itinerary.map(([day, title, body], i) => (
                <motion.li key={i} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.1 + i * 0.05, ease }} className="relative">
                  <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-glacier-400 ring-4 ring-glacier-400/15" />
                  <div className="text-[10px] font-bold uppercase tracking-[.16em] text-glacier-300">{day}</div>
                  <div className="mt-0.5 text-[14px] font-bold text-frost-50">{title}</div>
                  {body && <p className="mt-1 text-[12.5px] leading-relaxed text-frost-300">{body}</p>}
                </motion.li>
              ))}
            </ol>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="glass rounded-2xl p-4">
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Included</h4>
              <ul className="space-y-2">
                {pkg.includes.length ? pkg.includes.map((x) => (
                  <li key={x} className="flex items-start gap-2 text-[12.5px] text-frost-200">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> {x}
                  </li>
                )) : <li className="text-[12.5px] text-frost-400">The operator has not listed inclusions.</li>}
              </ul>
            </div>
            <div className="glass rounded-2xl p-4">
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">Not included</h4>
              <ul className="space-y-2">
                {pkg.excludes.length ? pkg.excludes.map((x) => (
                  <li key={x} className="flex items-start gap-2 text-[12.5px] text-frost-400">
                    <XIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400/80" /> {x}
                  </li>
                )) : <li className="text-[12.5px] text-frost-400">The operator has not listed exclusions.</li>}
              </ul>
            </div>
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:h-fit">
          <div className="glass rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-[.16em] text-frost-400">per person</div>
            <div className="mt-1 font-mono text-2xl font-bold text-frost-50">{pkr(pkg.price_pkr)}</div>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-frost-300">
              <ShieldCheck className="h-3.5 w-3.5 text-glacier-300" /> {pkg.operator?.name}
            </div>
            <button onClick={onBook} className="btn-primary mt-5 w-full">Book now</button>
            <Link to={`/explore/${pkg.id}`} onClick={onClose} className="btn-ghost mt-2 w-full !py-2.5 !text-[13px]">
              Full page, map & restaurants <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => toast(wish.toggle(pkg.id) ? 'Saved to your wishlist' : 'Removed from your wishlist')}
              className={`btn-ghost !px-3 !py-2.5 !text-[12px] ${saved ? '!border-rose-400/40 !text-rose-300' : ''}`}
              aria-pressed={saved}>
              <Heart className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`} /> {saved ? 'Saved' : 'Save'}
            </button>
            <button onClick={() => sharePackage(pkg, toast)} className="btn-ghost !px-3 !py-2.5 !text-[12px]">
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
          </div>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full !py-2.5 !text-[12.5px]">
              <MessageCircle className="h-3.5 w-3.5 text-emerald-300" /> Contact on WhatsApp
            </a>
          )}
          {pkg.operator_url && (
            <a href={pkg.operator_url} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full !py-2.5 !text-[12.5px]">
              <ExternalLink className="h-3.5 w-3.5" /> Visit operator website
            </a>
          )}
        </aside>
      </div>
    </div>
  )
}
