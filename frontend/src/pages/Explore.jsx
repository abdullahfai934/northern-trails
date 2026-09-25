import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal, Search, X } from 'lucide-react'

import { useData } from '../lib/store'
import { api, pkr } from '../lib/api'
import PackageCard from '../components/PackageCard'
import { Reveal, SectionTitle, Skeleton, Stagger, ease } from '../components/ui'

const SORTS = [
  ['recommended', 'Recommended'],
  ['price_asc', 'Price ↑'],
  ['price_desc', 'Price ↓'],
  ['duration', 'Duration'],
  ['rating', 'Rating'],
]

export default function Explore() {
  const d = useData()
  const [q, setQ] = useState('')
  const [params] = useSearchParams()
  const [destination, setDestination] = useState(() => params.get('destination') || '')
  const [pickup, setPickup] = useState('')
  const [maxPrice, setMaxPrice] = useState(320000)
  const [maxDays, setMaxDays] = useState(14)
  const [sort, setSort] = useState('recommended')
  const [items, setItems] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const destinations = useMemo(
    () => [...new Set((d.packages || []).map((p) => p.destination))].sort(), [d.packages])
  const pickups = useMemo(
    () => [...new Set((d.packages || []).map((p) => p.pickup))].sort(), [d.packages])

  useEffect(() => {
    const filters = {
      q, destination, pickup, sort,
      max_price: maxPrice >= 320000 ? 0 : maxPrice,
      max_days: maxDays >= 14 ? 0 : maxDays,
    }
    const t = setTimeout(() => {
      api.packages(filters)
        .then((r) => setItems(r.items))
        // The API is unreachable — most often because the SPA is hosted
        // statically with no backend. Filtering the snapshot the store
        // already loaded keeps this page browsable; reporting zero results
        // made every package look like it had stopped existing.
        .catch(() => setItems(filterLocally(d.packages || [], filters)))
    }, 220)
    return () => clearTimeout(t)
  }, [q, destination, pickup, maxPrice, maxDays, sort, d.packages])

  const activeCount = [destination, pickup].filter(Boolean).length
    + (maxPrice < 320000 ? 1 : 0) + (maxDays < 14 ? 1 : 0)

  const reset = () => {
    setQ(''); setDestination(''); setPickup(''); setMaxPrice(320000); setMaxDays(14); setSort('recommended')
  }

  const Filters = (
    <div className="space-y-6">
      <div>
        <label className="label">Destination</label>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!destination} onClick={() => setDestination('')}>All</Chip>
          {destinations.map((v) => (
            <Chip key={v} active={destination === v} onClick={() => setDestination(destination === v ? '' : v)}>{v}</Chip>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Pickup from</label>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!pickup} onClick={() => setPickup('')}>Any</Chip>
          {pickups.map((v) => (
            <Chip key={v} active={pickup === v} onClick={() => setPickup(pickup === v ? '' : v)}>{v}</Chip>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Budget ceiling · {maxPrice >= 320000 ? 'any' : pkr(maxPrice)}</label>
        <input type="range" min="30000" max="320000" step="5000" value={maxPrice}
               onChange={(e) => setMaxPrice(+e.target.value)} className="nt-range" />
      </div>
      <div>
        <label className="label">Max duration · {maxDays >= 14 ? 'any' : `${maxDays} days`}</label>
        <input type="range" min="2" max="14" step="1" value={maxDays}
               onChange={(e) => setMaxDays(+e.target.value)} className="nt-range" />
      </div>
      {activeCount > 0 && (
        <button onClick={reset} className="btn-ghost w-full !py-2.5 !text-[13px]">
          <X className="h-3.5 w-3.5" /> Clear {activeCount} filter{activeCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle
          eyebrow="Planned trips"
          title="Compare multi-day packages."
          sub="Filter by price, duration, pickup point and destination, the way an actual traveler shops, not the way a Facebook post reads."
        />
      </Reveal>

      {/* search + sort bar */}
      <Reveal delay={0.05}>
        <div className="glass sticky top-[4.5rem] z-40 mb-6 flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-frost-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search Hunza, Deosai, K2, operator…"
                   className="field !py-2.5 !pl-10" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {SORTS.map(([v, label]) => (
              <Chip key={v} active={sort === v} onClick={() => setSort(v)}>{label}</Chip>
            ))}
          </div>
          <button onClick={() => setFiltersOpen((o) => !o)}
                  className="btn-ghost !py-2.5 !text-[13px] lg:hidden">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters{activeCount ? ` (${activeCount})` : ''}
          </button>
        </div>
      </Reveal>

      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease }} className="overflow-hidden lg:hidden">
            <div className="glass mb-6 rounded-2xl p-5">{Filters}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="glass sticky top-[9.5rem] rounded-2xl p-5">{Filters}</div>
        </aside>

        <div>
          <div className="mb-4 text-[12px] text-frost-400">
            {items === null ? 'Searching…' : `${items.length} trip${items.length === 1 ? '' : 's'} match`}
          </div>

          {items === null ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[440px] rounded-2xl" />)}
            </div>
          ) : items.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                        className="glass rounded-2xl p-12 text-center">
              <div className="text-[15px] font-bold text-frost-100">No trips match those filters</div>
              <p className="mx-auto mt-2 max-w-sm text-[13px] text-frost-400">
                Widen the budget or duration, or post it as an on-demand request and let operators bid.
              </p>
              <button onClick={reset} className="btn-ghost mt-5 !py-2.5 !text-[13px]">Clear filters</button>
            </motion.div>
          ) : (
            <Stagger key={items.map((i) => i.id).join()} className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p, i) => <PackageCard key={p.id} pkg={p} index={i} />)}
            </Stagger>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The same filter and sort the API applies, run in the browser.
 *
 * Kept deliberately in step with `list_packages` in backend/app/main.py so an
 * offline result set is the one the server would have returned.
 */
function filterLocally(packages, { q, destination, pickup, sort, max_price, max_days }) {
  let items = [...packages]
  if (q) {
    const ql = q.toLowerCase()
    items = items.filter((p) =>
      p.title.toLowerCase().includes(ql) ||
      p.destination.toLowerCase().includes(ql) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(ql)) ||
      (p.operator?.name || '').toLowerCase().includes(ql))
  }
  if (destination) items = items.filter((p) => p.destination.toLowerCase() === destination.toLowerCase())
  if (pickup) items = items.filter((p) => p.pickup.toLowerCase() === pickup.toLowerCase())
  if (max_price) items = items.filter((p) => p.price_pkr <= max_price)
  if (max_days) items = items.filter((p) => p.days <= max_days)

  const keys = {
    price_asc: (p) => p.price_pkr,
    price_desc: (p) => -p.price_pkr,
    duration: (p) => p.days,
    rating: (p) => -p.rating,
  }
  const key = keys[sort]
  items.sort(key
    ? (a, b) => key(a) - key(b)
    : (a, b) => (b.rating - a.rating) || (a.price_pkr - b.price_pkr))
  return items
}

function Chip({ active, children, ...rest }) {
  return (
    <button
      {...rest}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all duration-300
        ${active
          ? 'bg-gradient-to-r from-glacier-400/25 to-glacier-400/10 text-glacier-200 ring-1 ring-glacier-400/40'
          : 'border border-white/10 bg-white/[.03] text-frost-300 hover:bg-white/[.07] hover:text-frost-100'}`}
    >
      {children}
    </button>
  )
}
