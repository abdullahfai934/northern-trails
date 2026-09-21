import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, MapPin, ShieldCheck, Users } from 'lucide-react'
import { Scene, sceneFor } from '../lib/scenes'
import { pkr } from '../lib/api'
import { Stars, item } from './ui'

export default function PackageCard({ pkg, index = 0 }) {
  return (
    <motion.article variants={item} className="group perspective">
      <Link to={`/explore/${pkg.id}`} className="block h-full">
        <motion.div
          whileHover={{ y: -8, rotateX: 3, rotateY: -3 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="glass flex h-full flex-col overflow-hidden rounded-2xl"
        >
          <div className="relative h-44 overflow-hidden">
            <Scene name={sceneFor(pkg)} seed={index}
                   className="h-full w-full scale-105 transition-transform duration-[1.4s] group-hover:scale-[1.18]" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              {pkg.tags.slice(0, 2).map((t) => (
                <span key={t} className="rounded-full bg-ink-950/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-frost-100 backdrop-blur-md">{t}</span>
              ))}
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-frost-200">
                <MapPin className="h-3 w-3 text-glacier-300" /> {pkg.pickup} → {pkg.destination}
              </span>
              <Stars value={pkg.rating} />
            </div>
          </div>

          <div className="flex flex-1 flex-col p-4">
            <h3 className="text-[15px] font-bold leading-snug text-frost-50 transition-colors group-hover:text-glacier-200">
              {pkg.title}
            </h3>

            <div className="mt-2 flex items-center gap-2 text-[12px] text-frost-300">
              <span
                className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-black text-ink-950"
                style={{ background: `hsl(${pkg.operator.avatar_hue} 70% 62%)` }}
              >
                {pkg.operator.name[0]}
              </span>
              <span className="truncate">{pkg.operator.name}</span>
              {pkg.operator.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-glacier-300" />}
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-frost-400">
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {pkg.days} days</span>
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {pkg.group_size}</span>
              <span className="chip !px-2 !py-0.5 !text-[10px]">{pkg.difficulty}</span>
            </div>

            <div className="mt-auto flex items-end justify-between pt-4">
              <div>
                <div className="text-[10px] uppercase tracking-[.14em] text-frost-400">from</div>
                <div className="font-mono text-[17px] font-bold text-frost-50">{pkr(pkg.price_pkr)}</div>
              </div>
              <span className="rounded-lg border border-white/10 bg-white/[.05] px-3 py-1.5 text-[11px] font-bold text-frost-100 transition-all group-hover:border-glacier-400/40 group-hover:bg-glacier-400/15 group-hover:text-glacier-200">
                View trip →
              </span>
            </div>
          </div>
        </motion.div>
      </Link>
    </motion.article>
  )
}
