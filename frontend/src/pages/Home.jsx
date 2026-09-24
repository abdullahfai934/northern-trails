import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowRight, Zap, Compass, ShieldCheck, Radio, Sparkles, AlertTriangle,
  CloudSun, Route as RouteIcon, MessageSquareText, BadgeCheck, Gauge,
} from 'lucide-react'

import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import { getPhotos } from '../lib/photos'
import { STATUS, api, relTime } from '../lib/api'
import { SafetyGauge } from '../components/charts'
import PackageCard from '../components/PackageCard'
import PlacePhoto from '../components/PlacePhoto'
import Carousel from '../components/Carousel'
import { CountUp, ErrorState, Marquee, Reveal, SectionTitle, Skeleton, Stagger, StatusPill, ease, item } from '../components/ui'

const SLIDES = [
  { scene: 'hunza',   title: 'Hunza',         query: 'Hunza Valley',               sub: 'Karimabad · Attabad · Passu Cones' },
  { scene: 'k2',      title: 'Skardu',        query: 'Concordia K2 Karakoram',     sub: 'Baltoro · Concordia · K2 Base Camp' },
  { scene: 'deosai',  title: 'Deosai',        query: 'Deosai plains',              sub: 'Sheosar Lake · the land of giants' },
  { scene: 'kalash',  title: 'Chitral',       query: 'Bumburet Kalash valley',     sub: 'Kalash valleys · Shandur · Garam Chashma' },
  { scene: 'fairy',   title: 'Fairy Meadows', query: 'Fairy Meadows',              sub: 'Nanga Parbat · Raikot · Beyal' },
]

/* ------------------------------------------------------------------ hero */
/** Reveals a line word by word from below — once, on load. */
function WordReveal({ text, delay = 0, className = '' }) {
  const reduce = useReducedMotion()
  return (
    <span className={className}>
      {text.split(' ').map((w, k) => (
        <span key={k} className="-my-[0.1em] inline-block overflow-hidden pb-[0.22em] pt-[0.1em] align-bottom">
          <motion.span className="inline-block"
            initial={reduce ? false : { y: '110%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: delay + k * 0.07, ease }}>
            {w}{'\u00A0'}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

const SLIDE_MS = 7000

function Hero({ alerts = [] }) {
  const t = useT()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 700], [0, 160])
  const fade = useTransform(scrollY, [0, 460], [1, 0])

  useEffect(() => {
    if (paused || reduce) return undefined
    const timer = setTimeout(() => setI((v) => (v + 1) % SLIDES.length), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [i, paused, reduce])

  // Fetch every slide's photo up front so each is decoded before it fades in.
  useEffect(() => {
    SLIDES.forEach((s) => getPhotos(s.query, 1).then((items) => {
      if (items[0]) { const img = new Image(); img.src = items[0].url }
    }))
  }, [])

  const slide = SLIDES[i]
  const urgent = alerts.find((a) => a.severity === 'high')

  return (
    <section className="on-photo relative -mt-16 min-h-[100svh] overflow-hidden bg-abyss pt-16"
             onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Photo slideshow: every slide is mounted; the active one fades in and
          zooms slowly (Ken Burns), the others rest at opacity 0. */}
      <motion.div style={{ y }} className="absolute inset-0" aria-hidden="true">
        {SLIDES.map((s, idx) => (
          <motion.div key={s.scene} className="absolute inset-0"
            initial={false} animate={{ opacity: idx === i ? 1 : 0 }} transition={{ duration: 1.8, ease }}>
            <div className="absolute inset-0 bg-gradient-to-br from-ink-800 via-abyss to-abyss" />
            <PlacePhoto query={s.query} name={s.title} count={1} large eager={idx < 2} credit={idx === i}
                        className="absolute inset-0 h-full w-full"
                        imgClassName={idx === i && !reduce ? 'nt-kenburns' : ''} key={idx === i ? `on-${i}` : `off-${idx}`} />
          </motion.div>
        ))}
        {/* Dark gradient so the headline always reads */}
        <div className="absolute inset-0 bg-gradient-to-b from-abyss/75 via-abyss/45 to-abyss/95" />
        <div className="absolute inset-0 bg-gradient-to-r from-abyss/70 via-abyss/20 to-transparent rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950" />
      </motion.div>

      <motion.div style={{ opacity: fade }} className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl flex-col justify-center px-5 py-24 sm:px-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease }}>
          <span className="chip !border-glacier-400/25 !bg-glacier-400/10 !text-glacier-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-glacier-300" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-glacier-300" />
            </span>
            {t('Live conditions layer · updated continuously')}
          </span>
        </motion.div>

        <h1 className="font-serif-display mt-6 max-w-4xl text-[2.7rem] font-semibold leading-[1.06] text-frost-50 drop-shadow-[0_4px_30px_rgba(0,0,0,.45)] sm:text-6xl lg:text-[4.7rem]">
          <WordReveal text={t('Book the North with')} delay={0.25} />
          <br />
          <WordReveal text={t('facts, not Facebook groups.')} delay={0.55} className="text-gradient italic" />
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.05, ease }}
          className="mt-6 max-w-xl text-[16px] leading-relaxed text-frost-300 sm:text-[17px]"
        >
          {t('Compare multi-day tours from tourism-department-verified operators, or request a jeep, guide or transfer and get matched in real time — every answer grounded in live road status, weather and permit data.')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2, ease }}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <Link to="/explore" className="btn-primary"><Compass className="h-4 w-4" /> {t('Browse packages')}</Link>
          <Link to="/instant" className="btn-ghost"><Zap className="h-4 w-4 text-amberz-300" /> {t('Request a ride now')}</Link>
        </motion.div>

        {/* Slide indicator, synced with the photo on screen */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.6 }}
          className="mt-14 flex items-center gap-5"
        >
          <div className="flex gap-1.5" role="tablist" aria-label={t('Destinations')}>
            {SLIDES.map((s, idx) => (
              <button key={s.scene} onClick={() => setI(idx)} role="tab" aria-selected={idx === i} aria-label={s.title}
                className={`relative h-1 overflow-hidden rounded-full transition-all duration-700 ${idx === i ? 'w-10 bg-white/20' : 'w-3 bg-white/20 hover:bg-white/40'}`}>
                {idx === i && (
                  <motion.span key={`${i}-${paused}`} className="absolute inset-y-0 start-0 rounded-full bg-glacier-300"
                    initial={{ width: paused || reduce ? '100%' : '0%' }} animate={{ width: '100%' }}
                    transition={{ duration: paused || reduce ? 0 : SLIDE_MS / 1000, ease: 'linear' }} />
                )}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={slide.title}
              initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.5, ease }}>
              <div className="text-sm font-semibold text-frost-50">{slide.title}</div>
              <div className="text-[11px] tracking-wide text-frost-400">{slide.sub}</div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {urgent && (
          <motion.div
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6, duration: 0.7, ease }}
            className="glass mt-10 flex max-w-2xl items-start gap-3 rounded-2xl border-rose-400/20 bg-rose-400/[.06] p-4"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div>
              <div className="text-[13px] font-bold text-rose-200">{urgent.title}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-frost-300">{urgent.body}</p>
              <div className="mt-2 text-[11px] text-frost-400">{urgent.source} · {relTime(urgent.issued_at)}</div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------- two flows */
const FLOWS = [
  {
    icon: Compass, tone: 'glacier',
    kicker: 'Flow one · planned',
    title: 'Browse & compare packages',
    body: 'Filter 5-day Hunza–Skardu circuits, Deosai camping or a K2 trek by price, duration, pickup point and destination. Every listing carries a verified operator behind it.',
    points: ['Transparent PKR pricing, inclusions and exclusions', 'Day-by-day itinerary with the routes it touches', 'Condition warnings surfaced before you pay'],
    cta: ['Explore packages', '/explore'],
  },
  {
    icon: Zap, tone: 'amberz',
    kicker: 'Flow two · on demand',
    title: 'Request & match in real time',
    body: 'Need a jeep to Fairy Meadows this afternoon, or a same-day guide in Karimabad? Post the request; nearby operators get it over WebSocket and bid within seconds.',
    points: ['Nearest-operator dispatch with a response window', 'Competing offers with ETA and price', 'Live trip tracking once you accept'],
    cta: ['Try instant match', '/instant'],
  },
]

function Flows() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <SectionTitle
        eyebrow="Two booking models, one app"
        title="Plan a trip months out, or find a driver in the next ten minutes."
        sub="No existing Pakistani platform offers both. Northern Trails runs them over the same operator network and the same live data."
      />
      <Stagger className="grid gap-5 lg:grid-cols-2">
        {FLOWS.map((f) => (
          <motion.div key={f.title} variants={item}
            className="glass group relative overflow-hidden rounded-3xl p-7 transition-colors hover:border-white/15">
            <div className={`absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl transition-opacity duration-700
              ${f.tone === 'glacier' ? 'bg-glacier-400/10' : 'bg-amberz-400/10'} group-hover:opacity-160`} />
            <div className={`mb-5 grid h-11 w-11 place-items-center rounded-xl
              ${f.tone === 'glacier' ? 'bg-glacier-400/15 text-glacier-300' : 'bg-amberz-400/15 text-amberz-300'}`}>
              <f.icon className="h-5 w-5" />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">{f.kicker}</div>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-frost-50">{f.title}</h3>
            <p className="mt-3 text-[14px] leading-relaxed text-frost-300">{f.body}</p>
            <ul className="mt-5 space-y-2.5">
              {f.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[13px] text-frost-200">
                  <BadgeCheck className={`mt-0.5 h-4 w-4 shrink-0 ${f.tone === 'glacier' ? 'text-glacier-300' : 'text-amberz-300'}`} />
                  {p}
                </li>
              ))}
            </ul>
            <Link to={f.cta[1]} className="mt-7 inline-flex items-center gap-2 text-[13px] font-bold text-frost-50 transition-colors hover:text-glacier-300">
              {f.cta[0]} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        ))}
      </Stagger>
    </section>
  )
}

/* ------------------------------------------------------- live conditions */
function ConditionsStrip({ routes = [], weather = [] }) {
  return (
    <section className="relative border-y border-white/[.06] bg-ink-900/30 py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionTitle
          eyebrow="Live conditions layer"
          title="Roads, weather and permits — tracked per route."
          sub="Live weather, hazard and seismic feeds fused per route, then attached to every trip that touches it — each record tagged with where it came from and when."
          right={<Link to="/conditions" className="btn-ghost !py-2.5 !text-[13px]"><Radio className="h-3.5 w-3.5" /> All routes</Link>}
        />

        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {routes.slice(0, 3).map((r) => (
            <motion.div key={r.id} variants={item} className="glass rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] font-bold text-frost-50">
                  <RouteIcon className="h-4 w-4 text-frost-400" />
                  <span className="line-clamp-1">{r.name}</span>
                </div>
                <StatusPill status={r.status} />
              </div>
              <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-frost-300">{r.status_note}</p>
              <div className="mt-4 flex items-center justify-between text-[11px] text-frost-400">
                <span>{r.distance_km} km · ~{r.drive_hours} h</span>
                <span>{relTime(r.updated_at)}</span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.06]">
                <motion.div
                  initial={{ width: 0 }} whileInView={{ width: `${r.confidence * 100}%` }} viewport={{ once: true }}
                  transition={{ duration: 1.2, ease }}
                  className={`h-full rounded-full ${STATUS[r.status]?.dot || 'bg-glacier-400'}`}
                />
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-wider text-frost-400">
                confidence {Math.round(r.confidence * 100)}% · {r.traveler_reports} traveler reports
              </div>
            </motion.div>
          ))}
        </Stagger>

        {weather.length > 0 && (
          <Reveal delay={0.1}>
            <div className="glass mt-4 flex gap-3 overflow-x-auto rounded-2xl p-4 no-scrollbar">
              {weather.map((w) => (
                <div key={w.city} className="flex min-w-[168px] shrink-0 items-center gap-3 rounded-xl bg-white/[.03] px-4 py-3">
                  <CloudSun className="h-7 w-7 text-glacier-300" strokeWidth={1.6} />
                  <div>
                    <div className="text-[12px] font-bold text-frost-50">{w.city}</div>
                    <div className="text-[11px] text-frost-400">{w.temp_c}°C · {w.condition}</div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------ best places this week */
function BestThisWeek() {
  const t = useT()
  const [state, setState] = useState({ status: 'loading', items: [] })
  const load = () => {
    setState({ status: 'loading', items: [] })
    api.recommendations().then((r) => setState({ status: 'ok', items: r.items.slice(0, 3) }))
      .catch((e) => setState({ status: 'error', items: [], error: e.message }))
  }
  useEffect(load, [])
  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <SectionTitle eyebrow={t('This week')} title={t('Best places to visit this week.')}
        sub={t('Ranked from the live forecast, road status, recent earthquakes and the season — refreshed as conditions change.')}
        right={<Link to="/map" className="btn-ghost !py-2.5 !text-[13px]">{t('Open the map')} <ArrowRight className="h-3.5 w-3.5" /></Link>} />
      {state.status === 'loading' && <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[360px] rounded-2xl" />)}</div>}
      {state.status === 'error' && <ErrorState title={t('Recommendations are loading')} message={state.error} onRetry={load} />}
      {state.status === 'ok' && (
        <Stagger className="grid gap-5 md:grid-cols-3">
          {state.items.map((r, k) => (
            <motion.div key={r.destination.id} variants={item} whileHover={{ y: -6 }} transition={{ duration: 0.5, ease }}
              className="glass group overflow-hidden rounded-2xl transition-shadow duration-500 hover:shadow-glow">
              <div className="relative h-40 overflow-hidden">
                <PlacePhoto query={r.destination.photo_query || r.destination.name} name={r.destination.name} count={1}
                            className="h-full w-full" imgClassName="group-hover:!scale-110 !duration-[1.4s]" />
                <div className="absolute inset-0 bg-gradient-to-t from-abyss/80 to-transparent" />
                <span className="absolute start-3 top-3 rounded-full bg-abyss/60 px-2.5 py-1 font-mono text-[11px] font-bold text-snow backdrop-blur">#{k + 1}</span>
                <div className="absolute bottom-3 start-3 font-display text-xl font-semibold text-snow">{r.destination.name}</div>
              </div>
              <div className="flex items-center gap-4 p-5">
                <SafetyGauge score={r.safety.score} color={r.safety.color} label={t(r.safety.label)} size={104} stroke={9} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold capitalize text-frost-100">{r.reason}</div>
                  <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-frost-400">{r.safety.summary}</p>
                  <div className="mt-2 flex gap-1.5">
                    {r.forecast.slice(0, 3).map(([day, hi, lo, icon]) => (
                      <span key={day} className="rounded-md bg-white/[.04] px-1.5 py-0.5 text-[10.5px] text-frost-300" title={icon}>{day} {hi}°/{lo}°</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border-t border-white/[.05] px-5 py-3">
                <Link to={`/explore?destination=${encodeURIComponent(r.destination.name)}`} className="text-[12.5px] font-semibold text-glacier-300 hover:underline">
                  {r.packages.length} {t(r.packages.length === 1 ? 'package' : 'packages')} →
                </Link>
              </div>
            </motion.div>
          ))}
        </Stagger>
      )}
    </section>
  )
}

/* ------------------------------------------------------------- packages */
function Featured({ packages = [] }) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionTitle
          eyebrow="Verified operators"
          title="Hand-checked trips across the North."
          sub="Every operator is matched against a tourism-department registration before a listing goes live. Hover to pause, swipe to browse."
          right={<Link to="/explore" className="btn-ghost !py-2.5 !text-[13px]">See all {packages.length} trips <ArrowRight className="h-3.5 w-3.5" /></Link>}
        />
      </div>
      <Reveal className="mx-auto max-w-[1600px] px-1 sm:px-4">
        <Carousel
          label="Featured tour packages"
          items={packages}
          renderItem={(p, i, copy) => <PackageCard pkg={p} index={i} standalone eager={copy === 1 && i < 3} />}
        />
      </Reveal>
    </section>
  )
}

/* ------------------------------------------------------------ assistant */
function AssistantTeaser({ suggestions = [] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % Math.max(1, suggestions.length)), 3200)
    return () => clearInterval(t)
  }, [suggestions.length])

  return (
    <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <div className="glass relative overflow-hidden rounded-3xl p-7 sm:p-12">
        <div className="absolute -left-24 -top-24 h-72 w-72 animate-float rounded-full bg-glacier-400/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-24 h-72 w-72 animate-float rounded-full bg-amberz-400/10 blur-3xl" style={{ animationDelay: '2s' }} />
        <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-px w-8 bg-gradient-to-r from-glacier-400 to-transparent" />
              <span className="text-[11px] font-bold uppercase tracking-[.22em] text-glacier-300">Grounded AI assistant</span>
            </div>
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-frost-50 sm:text-[2.5rem]">
              It answers from live records — or admits it doesn't know.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-frost-300">
              A retrieval pipeline packs the current road status, weather, permits and verified
              operator rows into the prompt, and the model may only phrase what is in that pack.
              Every reply carries the record ids it used.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['No invented closures', 'Cited sources', 'Timestamped data', 'Refuses outside context'].map((t) => (
                <span key={t} className="chip"><ShieldCheck className="h-3 w-3 text-glacier-300" /> {t}</span>
              ))}
            </div>
            <Link to="/assistant" className="btn-primary mt-8"><Sparkles className="h-4 w-4" /> Ask the assistant</Link>
          </div>

          <div className="glass-strong rounded-2xl p-5">
            <div className="flex items-center gap-2 border-b border-white/[.07] pb-3">
              <MessageSquareText className="h-4 w-4 text-glacier-300" />
              <span className="text-[12px] font-bold text-frost-100">Live conditions assistant</span>
              <span className="ml-auto chip !py-0.5 !text-[10px]">grounded</span>
            </div>
            <div className="mt-4 space-y-3">
              <AnimatePresence mode="wait">
                <motion.div key={i}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.45, ease }}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-glacier-400/15 px-4 py-2.5 text-[13px] text-frost-50"
                >
                  {suggestions[i] || 'Is the road to Skardu open today?'}
                </motion.div>
              </AnimatePresence>
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-white/[.05] px-4 py-3 text-[13px] leading-relaxed text-frost-200">
                <span className="font-semibold text-frost-50">Gilgit → Skardu is open but needs care.</span>{' '}
                Single-lane diversion at Thowar, convoy released every 30 min from 06:00–19:00.
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {['skardu-road', 'alert-thowar', 'wx-skardu'].map((c) => (
                    <span key={c} className="rounded-md bg-ink-950/60 px-2 py-0.5 font-mono text-[10px] text-glacier-300">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- stats */
function Stats({ operators = [], destinations = [], packages = [] }) {
  const t = useT()
  const trips = operators.reduce((sum, o) => sum + (o.trips || 0), 0)
  const cells = [
    { icon: Compass, value: packages.length, label: t('Tours listed'), suffix: '' },
    { icon: ShieldCheck, value: operators.length, label: t('Verified operators'), suffix: '' },
    { icon: RouteIcon, value: destinations.length, label: t('Destinations'), suffix: '' },
    { icon: Gauge, value: trips, label: t('Trips run by our operators'), suffix: '+' },
  ]
  return (
    <section className="border-y border-white/[.06] bg-ink-900/30">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-5 sm:px-8 lg:grid-cols-4">
        {cells.map((c, i) => (
          <Reveal key={c.label} delay={i * 0.07} className="px-2 py-10 text-center">
            <c.icon className="mx-auto mb-3 h-5 w-5 text-glacier-300" strokeWidth={1.8} />
            <div className="font-mono text-3xl font-bold text-frost-50 sm:text-4xl">
              <CountUp to={c.value} suffix={c.suffix} />
            </div>
            <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-frost-400">{c.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- page */
export default function Home() {
  const d = useData()

  if (!d.ready) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-32 sm:px-8">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="mt-4 h-6 w-1/2" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    )
  }

  const ticker = [
    ...d.routes.map((r) => `${r.name} — ${STATUS[r.status]?.label}`),
    ...d.weather.map((w) => `${w.city} ${w.temp_c}°C ${w.condition}`),
  ]

  return (
    <>
      <Hero alerts={d.alerts} />
      <div className="border-y border-white/[.06] bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><Marquee items={ticker} /></div>
      </div>
      <Flows />
      <ConditionsStrip routes={d.routes} weather={d.weather} />
      <BestThisWeek />
      <Featured packages={d.packages} />
      <AssistantTeaser suggestions={d.suggestions} />
      <Stats operators={d.operators} destinations={d.destinations} packages={d.packages} />
    </>
  )
}
