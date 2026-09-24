import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, CalendarDays, Coins, Compass, Info, MapPin, Mountain,
  Check, X as XIcon, Users, Wand2, AlertTriangle, ChevronDown, Sparkles,
} from 'lucide-react'
import { useT } from '../lib/i18n'
import AiPlanner from '../components/AiPlanner'

import { api, pkr, relTime } from '../lib/api'
import { useData } from '../lib/store'
import PackageCard from '../components/PackageCard'
import { ErrorState, Reveal, SectionTitle, Skeleton, ease } from '../components/ui'

const INTERESTS = [
  'Mountains', 'Culture', 'Trekking', 'Photography', 'Lakes', 'Wildlife',
  'Camping', 'Heritage', 'Festival', 'Short break', 'Road trip', 'Glacier', 'Expedition',
]

const START_CITIES = ['Islamabad', 'Gilgit', 'Chilas', 'Skardu']

/** Concern bands, darkest at the top. Colour is a cue, never the only one —
 *  the band is always spelled out next to it. */
const BAND = {
  'LOW CONCERN':      { tone: 'text-emerald-300', ring: 'ring-emerald-400/30', bg: 'bg-emerald-400/10', bar: 'from-emerald-400 to-emerald-300' },
  'MODERATE CONCERN': { tone: 'text-amberz-300',  ring: 'ring-amberz-400/30',  bg: 'bg-amberz-400/10',  bar: 'from-amberz-400 to-amberz-300' },
  'HIGH CONCERN':     { tone: 'text-orange-300',  ring: 'ring-orange-400/30',  bg: 'bg-orange-400/10',  bar: 'from-orange-400 to-orange-300' },
  'SEVERE CONCERN':   { tone: 'text-rose-300',    ring: 'ring-rose-400/30',    bg: 'bg-rose-400/10',    bar: 'from-rose-400 to-rose-300' },
}

const COMPONENT_LABEL = {
  weather: 'Weather conditions',
  road_status: 'Road status',
  incidents: 'Recent incidents',
  accessibility: 'Route accessibility',
}

export default function Plan() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'ai' ? 'ai' : 'compare'
  const d = useData() || {}

  const [startCity, setStartCity] = useState('Islamabad')
  const [destination, setDestination] = useState('')
  const [budget, setBudget] = useState(150000)
  const [days, setDays] = useState(5)
  const [people, setPeople] = useState(4)
  const [date, setDate] = useState('')
  const [interests, setInterests] = useState(['Mountains'])

  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(false)
  //: the planner call's error message, shown with a retry button
  const [unreachable, setUnreachable] = useState('')

  const destinations = useMemo(
    () => (d.destinations || []).map((x) => x.name), [d.destinations])

  const toggle = (v) =>
    setInterests((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])

  const run = async () => {
    setLoading(true)
    try {
      const res = await api.plan({
        destination, start_city: startCity, budget_pkr: budget,
        days, people, interests, travel_date: date,
      })
      setPlan(res)
      setUnreachable('')
    } catch (e) {
      // The score is computed server-side against live road, weather and
      // incident records. There is no honest way to produce one in the
      // browser from a saved snapshot, so say so instead of guessing.
      setUnreachable(e.message || 'The planning service did not respond.')
      setPlan(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle
          eyebrow="Trip planner"
          title={mode === 'ai' ? t('Your trip, planned day by day.') : t("Tell us the trip. We'll tell you where it works.")}
          sub="Every destination is compared against your budget, dates, group and interests, and against the road, weather and incident records as they stand right now. You get the reasons, not a verdict."
        />
      </Reveal>

      <div className="mb-6 inline-flex gap-1 rounded-xl border border-white/[.06] bg-white/[.02] p-1" role="tablist">
        {[['compare', Compass, t('Compare destinations')], ['ai', Sparkles, t('AI itinerary')]].map(([id, Icon, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} onClick={() => setParams(id === 'ai' ? { mode: 'ai' } : {}, { replace: true })}
            className={`relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition ${mode === id ? 'text-frost-50' : 'text-frost-400 hover:text-frost-200'}`}>
            {mode === id && <motion.span layoutId="plan-tab" className="absolute inset-0 rounded-lg bg-white/[.07]" transition={{ duration: 0.4, ease }} />}
            <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
          </button>
        ))}
      </div>

      {mode === 'ai' ? <AiPlanner /> : (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ------------------------------------------------ the brief */}
        <Reveal delay={0.05}>
          <div className="glass lg:sticky lg:top-24 rounded-2xl p-6 lg:h-fit">
            <div className="space-y-5">
              <div>
                <label className="label"><MapPin className="mr-1 inline h-3 w-3" /> Starting from</label>
                <div className="flex flex-wrap gap-1.5">
                  {START_CITIES.map((c) => (
                    <Chip key={c} active={startCity === c} onClick={() => setStartCity(c)}>{c}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className="label"><Compass className="mr-1 inline h-3 w-3" /> Destination</label>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={!destination} onClick={() => setDestination('')}>Compare all</Chip>
                  {destinations.map((c) => (
                    <Chip key={c} active={destination === c}
                          onClick={() => setDestination(destination === c ? '' : c)}>{c}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className="label"><Coins className="mr-1 inline h-3 w-3" /> Total budget · {pkr(budget)}</label>
                <input type="range" min="20000" max="600000" step="10000" value={budget}
                       onChange={(e) => setBudget(+e.target.value)} className="nt-range" />
                <div className="mt-1 text-[11px] text-frost-400">
                  For the whole group, not per person.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label"><CalendarDays className="mr-1 inline h-3 w-3" /> Days</label>
                  <input type="number" min="1" max="30" value={days}
                         onChange={(e) => setDays(+e.target.value)} className="field !py-2.5" />
                </div>
                <div>
                  <label className="label"><Users className="mr-1 inline h-3 w-3" /> People</label>
                  <input type="number" min="1" max="30" value={people}
                         onChange={(e) => setPeople(+e.target.value)} className="field !py-2.5" />
                </div>
              </div>

              <div>
                <label className="label">Travel date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                       className="field !py-2.5" />
                <div className="mt-1 text-[11px] text-frost-400">
                  Used for the season check, not to hold availability.
                </div>
              </div>

              <div>
                <label className="label">Interests</label>
                <div className="flex flex-wrap gap-1.5">
                  {INTERESTS.map((v) => (
                    <Chip key={v} active={interests.includes(v)} onClick={() => toggle(v)}>{v}</Chip>
                  ))}
                </div>
              </div>

              <button onClick={run} disabled={loading} className="btn-primary w-full disabled:opacity-60">
                <Wand2 className="h-4 w-4" />
                {loading ? 'Comparing destinations…' : 'Compare destinations'}
              </button>
            </div>
          </div>
        </Reveal>

        {/* ------------------------------------------------ the answer */}
        <div>
          {loading && (
            <div className="space-y-5">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
            </div>
          )}

          {!loading && unreachable && (
            <ErrorState title="Couldn't compare destinations" message={unreachable} onRetry={run} />
          )}

          {!loading && !plan && !unreachable && (
            <Reveal delay={0.1}>
              <div className="glass rounded-2xl p-10 text-center">
                <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-glacier-400/10">
                  <Mountain className="h-6 w-6 text-glacier-300" />
                </div>
                <div className="text-[15px] font-bold text-frost-50">
                  Set the trip on the left, then compare.
                </div>
                <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-frost-400">
                  Each destination comes back with a Travel Condition Score built from four
                  weighted components, the reasons it does or doesn't fit your brief, and the
                  road, weather and incident records behind every one of them, with timestamps.
                </p>
              </div>
            </Reveal>
          )}

          {!loading && plan && (
            <div className="space-y-5">
              <Methodology m={plan.methodology} />
              {plan.results.map((r, i) => (
                <DestinationResult key={r.destination.id} r={r} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------- one destination */
function DestinationResult({ r, index }) {
  const [open, setOpen] = useState(index === 0)
  const c = r.travel_condition
  const band = BAND[c.band] || BAND['MODERATE CONCERN']

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.07, ease }}
      className="glass overflow-hidden rounded-2xl"
    >
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-xl font-extrabold tracking-tight text-frost-50">
              {r.destination.name}
            </h3>
            <div className="mt-1 text-[12px] text-frost-400">
              {r.destination.valley} · {r.destination.elevation_m.toLocaleString()} m
            </div>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-frost-300">
              {r.destination.blurb}
            </p>
          </div>

          <ScoreDial score={c.score} band={c.band} tone={band} />
        </div>

        {c.blocked && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-400/25 bg-rose-400/[.08] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="text-[12.5px] leading-relaxed text-rose-200">
              A road segment on the way in is reported <strong>closed</strong>. This destination is
              held at high concern regardless of the weighted total.
            </div>
          </div>
        )}

        {/* why it fits, why it doesn't */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ReasonList title="Fits your brief" tone="good" items={r.fit.fits} />
          <ReasonList title="Counts against it" tone="bad" items={r.fit.against} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <span className="text-frost-400">
            Estimated for your group:{' '}
            <span className={`font-mono font-bold ${r.fit.within_budget ? 'text-emerald-300' : 'text-amberz-300'}`}>
              {pkr(r.fit.estimated_total_pkr)}
            </span>
            <span className="text-frost-500"> · {r.fit.estimated_basis}</span>
          </span>
          <button onClick={() => setOpen((o) => !o)}
                  className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-bold text-glacier-300 hover:text-glacier-200">
            {open ? 'Hide' : 'Show'} how this score was calculated
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* the working */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[.07] bg-ink-950/40 p-6">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">
                <Info className="h-3.5 w-3.5" /> Travel Condition Score · {c.score} / 100
              </div>

              <div className="space-y-4">
                {Object.entries(c.components).map(([key, comp]) => (
                  <Component key={key} name={COMPONENT_LABEL[key] || key} comp={comp} />
                ))}
              </div>

              <div className="mt-5 text-[11px] leading-relaxed text-frost-500">
                Weighted total ={' '}
                {Object.entries(c.components)
                  .map(([k, v]) => `${v.score} × ${v.weight}`)
                  .join('  +  ')}{' '}
                = <span className="font-mono font-bold text-frost-300">{c.score}</span>. Computed {relTime(c.computed_at)}.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* packages for this destination */}
      {r.packages.length > 0 && (
        <div className="border-t border-white/[.07] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">
              Packages to {r.destination.name}
            </h4>
            <Link to="/explore" className="inline-flex items-center gap-1 text-[12px] font-bold text-glacier-300 hover:text-glacier-200">
              Compare all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {r.packages.map((p, i) => <PackageCard key={p.id} pkg={p} index={i} />)}
          </div>
        </div>
      )}
    </motion.section>
  )
}

/* ------------------------------------------------------------- score dial */
function ScoreDial({ score, band, tone }) {
  const R = 34
  const C = 2 * Math.PI * R
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor"
                  strokeWidth="6" className="text-white/[.07]" />
          <motion.circle
            cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="6"
            strokeLinecap="round" className={tone.tone}
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C - (C * Math.min(100, score)) / 100 }}
            transition={{ duration: 1.1, ease }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={`font-mono text-lg font-bold ${tone.tone}`}>{Math.round(score)}</span>
        </div>
      </div>
      <div className="max-w-[9rem]">
        <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ${tone.bg} ${tone.tone} ${tone.ring}`}>
          {band}
        </div>
        <div className="mt-1.5 text-[10px] leading-snug text-frost-500">
          0 = no concern, 100 = maximum
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- score component */
function Component({ name, comp }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-bold text-frost-100">
          {name}
          <span className="ml-2 text-[11px] font-medium text-frost-500">
            weight {Math.round(comp.weight * 100)}%
          </span>
          {comp.unknown && (
            <span className="ml-2 rounded bg-amberz-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amberz-300">
              no data
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-frost-300">
          {comp.score} <span className="text-frost-500">→ {comp.contribution}</span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
        <motion.div
          className="h-full origin-left rounded-full bg-gradient-to-r from-glacier-400 to-glacier-300 rtl:origin-right"
          style={{ width: `${Math.min(100, comp.score)}%` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, ease }}
        />
      </div>

      <ul className="mt-2 space-y-1">
        {comp.notes.map((n, i) => (
          <li key={i} className="text-[12px] leading-relaxed text-frost-400">· {n}</li>
        ))}
      </ul>

      {comp.sources?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {comp.sources.map((s, i) => (
            <span key={i} className="text-[10.5px] text-frost-500">
              {s.source || s.label}
              {s.updated_at && <> · {relTime(s.updated_at)}</>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ReasonList({ title, tone, items }) {
  const good = tone === 'good'
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">{title}</div>
      {items.length === 0 ? (
        <div className="text-[12.5px] text-frost-500">Nothing on this side.</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((x, i) => (
            <motion.li key={i}
              initial={{ opacity: 0, x: good ? -8 : 8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease }}
              className="flex items-start gap-2 text-[12.5px] leading-relaxed text-frost-300">
              {good
                ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                : <XIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amberz-400/90" />}
              {x}
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------------------------------- how it is built */
function Methodology({ m }) {
  const [open, setOpen] = useState(false)
  if (!m) return null
  return (
    <div className="glass rounded-2xl">
      <button onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center gap-3 p-5 text-left">
        <Info className="h-4 w-4 shrink-0 text-glacier-300" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-frost-50">How the {m.name} is calculated</div>
          <div className="mt-0.5 truncate text-[11.5px] text-frost-400">
            {Object.entries(m.weights).map(([k, v]) => `${COMPONENT_LABEL[k] || k} ${Math.round(v * 100)}%`).join(' · ')}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-frost-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease }}
                      className="overflow-hidden">
            <div className="space-y-4 border-t border-white/[.07] px-5 py-5 text-[12.5px] leading-relaxed text-frost-300">
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">Range</div>
                {m.range}
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">Components</div>
                <ul className="space-y-2">
                  {Object.entries(m.components).map(([k, v]) => (
                    <li key={k}>
                      <span className="font-bold text-frost-100">
                        {COMPONENT_LABEL[k] || k} ({Math.round(m.weights[k] * 100)}%)
                      </span>
                      <br />{v}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">Bands</div>
                <div className="flex flex-wrap gap-1.5">
                  {m.bands.map((b) => (
                    <span key={b.label} className={`chip !text-[10px] ${(BAND[b.label] || {}).tone || ''}`}>
                      &lt; {b.upto} · {b.label}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">Overrides</div>
                <ul className="space-y-1.5">
                  {m.overrides.map((o, i) => <li key={i}>· {o}</li>)}
                </ul>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-frost-400">Limits</div>
                {m.limits}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
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
