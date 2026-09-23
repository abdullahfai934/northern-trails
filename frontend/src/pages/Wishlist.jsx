import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Compass, Heart, Trash2 } from 'lucide-react'

import { useData } from '../lib/store'
import { useWishlist } from '../lib/wishlist'
import PackageCard from '../components/PackageCard'
import { Reveal, SectionTitle, Skeleton, Stagger } from '../components/ui'

export default function Wishlist() {
  const d = useData()
  const wish = useWishlist()
  const byId = Object.fromEntries((d.packages || []).map((p) => [p.id, p]))
  const saved = wish.ids.map((id) => byId[id]).filter(Boolean)

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle
          eyebrow="Your wishlist"
          title="Trips you've saved."
          sub="Saved in this browser. Prices and itineraries always show the operator's current listing."
          right={saved.length > 0 && (
            <button onClick={wish.clear} className="btn-ghost !py-2.5 !text-[13px]">
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        />
      </Reveal>

      {!d.ready ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[440px] rounded-2xl" />)}
        </div>
      ) : saved.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="glass mx-auto max-w-lg rounded-2xl p-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-rose-400/10 text-rose-300">
            <Heart className="h-6 w-6" />
          </span>
          <div className="text-[15px] font-bold text-frost-50">Nothing saved yet</div>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-frost-400">
            Tap the heart on any package to keep it here while you compare.
          </p>
          <Link to="/explore" className="btn-primary mt-6 inline-flex"><Compass className="h-4 w-4" /> Browse packages</Link>
        </motion.div>
      ) : (
        <Stagger key={saved.length} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((p, i) => <PackageCard key={p.id} pkg={p} index={i} />)}
        </Stagger>
      )}
    </div>
  )
}
