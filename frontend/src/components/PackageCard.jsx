import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, ExternalLink, Heart, MapPin, MessageCircle, Share2, ShieldCheck, Users } from 'lucide-react'

import { pkr, whatsappUrl } from '../lib/api'
import { useWishlist } from '../lib/wishlist'
import PlacePhoto from './PlacePhoto'
import { sharePackage, usePackageActions } from './PackageActions'
import { Stars, item, useToast } from './ui'

function IconAction({ label, onClick, href, children, active = false }) {
  const cls = `grid h-9 w-9 place-items-center rounded-lg border transition-all duration-300
    ${active ? 'border-rose-400/40 bg-rose-400/10 text-rose-300'
             : 'border-white/10 bg-white/[.04] text-frost-300 hover:-translate-y-0.5 hover:border-glacier-400/40 hover:bg-glacier-400/10 hover:text-glacier-200'}`
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label} className={cls}
         onClick={(e) => e.stopPropagation()}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active || undefined} className={cls}>
      {children}
    </button>
  )
}

/**
 * A package in a grid or carousel.
 *
 * `standalone` renders it without the stagger variant, for carousels that are
 * not inside a <Stagger>.
 */
export default function PackageCard({ pkg, index = 0, eager = false, standalone = false }) {
  const actions = usePackageActions()
  const wish = useWishlist()
  const toast = useToast()
  const saved = wish.has(pkg.id)
  const wa = whatsappUrl(pkg)

  const toggleSave = (e) => {
    e?.preventDefault()
    toast(wish.toggle(pkg.id) ? 'Saved to your wishlist' : 'Removed from your wishlist')
  }

  return (
    <motion.article variants={standalone ? undefined : item} className="group h-full">
      <motion.div
        whileHover={{ y: -8 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="glass flex h-full flex-col overflow-hidden rounded-2xl transition-shadow duration-500 hover:shadow-glow"
      >
        <div className="relative h-48 overflow-hidden">
          <Link to={`/explore/${pkg.id}`} aria-label={pkg.title} draggable="false" className="block h-full">
            <PlacePhoto query={pkg.photo_query || pkg.destination} name={pkg.destination} images={pkg.images}
                        index={index % 3} eager={eager}
                        className="h-full w-full" imgClassName="group-hover:!scale-110 !duration-[1.4s]" />
            <div className="absolute inset-0 bg-gradient-to-t from-abyss/85 via-abyss/15 to-transparent" />
          </Link>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
            {pkg.tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded-full bg-abyss/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-snow backdrop-blur-md">{t}</span>
            ))}
          </div>
          <button type="button" onClick={toggleSave} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={saved}
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-abyss/45 text-snow backdrop-blur-md transition hover:scale-110 hover:bg-abyss/65">
            <motion.span key={String(saved)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}>
              <Heart className={`h-4 w-4 ${saved ? 'fill-rose-400 text-rose-400' : ''}`} />
            </motion.span>
          </button>
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-snow/90">
              <MapPin className="h-3 w-3" /> {pkg.pickup} → {pkg.destination}
            </span>
            <span className="rounded-full bg-abyss/55 px-2 py-0.5 backdrop-blur-md on-photo"><Stars value={pkg.rating} /></span>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <Link to={`/explore/${pkg.id}`} draggable="false">
            <h3 className="line-clamp-2 text-[15.5px] font-semibold leading-snug text-frost-50 transition-colors group-hover:text-glacier-300">
              {pkg.title}
            </h3>
          </Link>
          {pkg.highlight && (
            <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-frost-300">{pkg.highlight}</p>
          )}

          <div className="mt-3 flex items-center gap-2 text-[12px] text-frost-300">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black text-abyss"
                  style={{ background: `hsl(${pkg.operator.avatar_hue} 70% 62%)` }}>
              {pkg.operator.name[0]}
            </span>
            <span className="truncate">{pkg.operator.name}</span>
            {pkg.operator.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-glacier-300" aria-label="Verified operator" />}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-frost-400">
            <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {pkg.days} {pkg.days === 1 ? 'day' : 'days'}</span>
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {pkg.group_size}</span>
            <span className="chip !px-2 !py-0.5 !text-[10px]">{pkg.difficulty}</span>
          </div>

          <div className="mt-auto pt-4">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[.14em] text-frost-400">per person</div>
                <div className="font-mono text-[17px] font-bold text-frost-50">{pkr(pkg.price_pkr)}</div>
              </div>
              <div className="flex gap-1.5">
                <IconAction label="Share" onClick={() => sharePackage(pkg, toast)}><Share2 className="h-3.5 w-3.5" /></IconAction>
                {wa && <IconAction label="Contact on WhatsApp" href={wa}><MessageCircle className="h-3.5 w-3.5" /></IconAction>}
                {pkg.operator_url && (
                  <IconAction label="Visit operator website" href={pkg.operator_url}><ExternalLink className="h-3.5 w-3.5" /></IconAction>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => actions.openDetails(pkg)} className="btn-ghost !px-3 !py-2.5 !text-[12.5px]">
                View details
              </button>
              <button type="button" onClick={() => actions.openBooking(pkg)} className="btn-primary !px-3 !py-2.5 !text-[12.5px]">
                Book now
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.article>
  )
}
