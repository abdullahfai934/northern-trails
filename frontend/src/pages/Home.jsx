import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import {
  ArrowRight, Check, Compass, ShieldCheck, AlertTriangle,
  Route as RouteIcon, MessageSquareText, Gauge,
} from 'lucide-react'

import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import { getPhotos } from '../lib/photos'
import { STATUS, api, relTime } from '../lib/api'
import { SafetyGauge } from '../components/charts'
import PackageCard from '../components/PackageCard'
import PlacePhoto from '../components/PlacePhoto'
import Carousel from '../components/Carousel'
import { Tilt, WeatherIcon, useDir } from '../components/motion'
import { CountUp, ErrorState, Marquee, Reveal, SectionTitle, Skeleton, Stagger, StatusPill, WhenNear, ease, item } from '../components/ui'

const SLIDES = [
  { scene: 'hunza',   title: 'Hunza',         query: 'Hunza Valley',               sub: 'Karimabad · Attabad · Passu Cones' },
  { scene: 'k2',      title: 'Skardu',        query: 'Concordia K2 Karakoram',     sub: 'Baltoro · Concordia · K2 Base Camp' },
  { scene: 'deosai',  title: 'Deosai',        query: 'Deosai plains',              sub: 'Sheosar Lake · the land of giants' },
  { scene: 'kalash',  title: 'Chitral',       query: 'Bumburet Kalash valley',     sub: 'Kalash valleys · Shandur · Garam Chashma' },
  { scene: 'fairy',   title: 'Fairy Meadows', query: 'Fairy Meadows',              sub: 'Nanga Parbat · Raikot · Beyal' },
]

/* ------------------------------------------------------------------ hero */
/** Reveals a line word by word from below — once, on load. */
function WordReveal({ text, delay = 0, className = '', children }) {
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
      {children}
    </span>
  )
}

/**
 * One pass of gold light over a line of the headline, after it has landed.
 * A band-shaped window slides across while the gold copy inside slides the
 * other way by the same amount, so the text stays put and only the light
 * moves: both are plain transforms.
 */
function GoldShimmer({ text }) {
  const reduce = useReducedMotion()
  if (reduce) return null
  // CSS keyframes (index.css, .nt-shimmer): runs on the compositor, mirrored
  // in right-to-left.
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="nt-shimmer-window absolute inset-0 block">
        <span className="nt-shimmer-copy absolute inset-0 block">
          <span className="nt-gold-text">
            {text.split(' ').map((w, k) => (
              <span key={k} className="-my-[0.1em] inline-block overflow-hidden pb-[0.22em] pt-[0.1em] align-bottom">
                <span className="inline-block">{w}{'\u00A0'}</span>
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  )
}

/**
 * Two slow banks of mist drifting across the lower hero, nearer than the
 * photo. Decorative, so it starts only once the page has loaded and settled
 * (fading in over two seconds), and pauses while the hero is off screen.
 */
function Mist({ y, x }) {
  const ref = useRef(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    let timer = 0
    const start = () => { timer = setTimeout(() => setOn(true), 3500) }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => { clearTimeout(timer); window.removeEventListener('load', start) }
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!on || !el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => el.classList.toggle('nt-mist-paused', !e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [on])
  if (!on) return null
  return (
    <motion.div ref={ref} style={{ y, x }} className="nt-mist-in pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="nt-mist" style={{ background: 'radial-gradient(38% 42% at 30% 55%, rgba(237,232,224,.11), transparent 70%), radial-gradient(30% 34% at 74% 40%, rgba(237,232,224,.08), transparent 70%)' }} />
      <div className="nt-mist nt-mist-b" style={{ background: 'radial-gradient(42% 40% at 60% 70%, rgba(237,232,224,.10), transparent 70%), radial-gradient(26% 30% at 16% 30%, rgba(237,232,224,.06), transparent 70%)' }} />
    </motion.div>
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
  const mistY = useTransform(scrollY, [0, 700], [0, 260])     // nearer layer: moves faster
  const copyY = useTransform(scrollY, [0, 700], [0, -60])
  const fade = useTransform(scrollY, [0, 460], [1, 0])

  // Mouse parallax (desktop): the photo, the mist and the copy shift by
  // different amounts, so the scene reads as layers of depth.
  const mx = useSpring(0, { stiffness: 50, damping: 18 })
  const my = useSpring(0, { stiffness: 50, damping: 18 })
  const photoX = useTransform(mx, (v) => v * -16)
  const photoY = useTransform(my, (v) => v * -10)
  const mistX = useTransform(mx, (v) => v * -34)
  const copyX = useTransform(mx, (v) => v * 8)
  const fine = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  const onMove = (e) => {
    if (reduce || !fine) return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }

  useEffect(() => {
    if (paused || reduce) return undefined
    const timer = setTimeout(() => setI((v) => (v + 1) % SLIDES.length), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [i, paused, reduce])

  // Fetch the later slides' photos once the page is idle, so each is
  // decoded before it fades in without competing with the first paint.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500))
    const id = idle(() => SLIDES.slice(2).forEach((s) => getPhotos(s.query, 1).then((items) => {
      if (items[0]) { const img = new Image(); img.src = items[0].url }
    })), { timeout: 5000 })
    return () => (window.cancelIdleCallback || clearTimeout)(id)
  }, [])

  // Only slides already shown, and the next one, are mounted: the other
  // full-screen photos are not downloaded and decoded during page load.
  const [seen, setSeen] = useState(() => new Set([0, 1]))
  useEffect(() => {
    setSeen((prev) => (prev.has(i) && prev.has((i + 1) % SLIDES.length) ? prev
      : new Set([...prev, i, (i + 1) % SLIDES.length])))
  }, [i])

  const slide = SLIDES[i]
  const urgent = alerts.find((a) => a.severity === 'high')

  return (
    <section className="on-photo relative -mt-16 min-h-[100svh] overflow-hidden bg-abyss pt-16"
             onMouseEnter={() => setPaused(true)} onPointerMove={onMove}
             onMouseLeave={() => { setPaused(false); mx.set(0); my.set(0) }}>
      {/* Photo slideshow: every slide is mounted; the active one fades in and
          zooms slowly (Ken Burns), the others rest at opacity 0. */}
      <motion.div style={{ y }} className="absolute inset-0" aria-hidden="true">
        <motion.div style={{ x: photoX, y: photoY, scale: 1.05 }} className="absolute inset-0">
        {SLIDES.map((s, idx) => (
          <motion.div key={s.scene} className="absolute inset-0"
            initial={false} animate={{ opacity: idx === i ? 1 : 0 }} transition={{ duration: 1.8, ease }}>
            <div className="absolute inset-0 bg-gradient-to-br from-ink-800 via-abyss to-abyss" />
            {seen.has(idx) && <PlacePhoto query={s.query} name={s.title} count={1} large eager={idx < 2} credit={idx === i}
                        className="absolute inset-0 h-full w-full"
                        imgClassName={idx === i && !reduce ? 'nt-kenburns' : ''} key={idx === i ? `on-${i}` : `off-${idx}`} />}
          </motion.div>
        ))}
        </motion.div>
        {/* Dark gradient so the headline always reads */}
        <div className="absolute inset-0 bg-gradient-to-b from-abyss/75 via-abyss/45 to-abyss/95" />
        <div className="absolute inset-0 bg-gradient-to-r from-abyss/70 via-abyss/20 to-transparent rtl:bg-gradient-to-l" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950" />
      </motion.div>

      {!reduce && <Mist y={mistY} x={mistX} />}

      <motion.div style={{ opacity: fade, x: copyX, y: copyY }} className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl flex-col justify-center px-5 py-24 sm:px-8">
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease }}
          className="flex items-center gap-3 text-[12px] font-medium uppercase tracking-[.24em] text-frost-300">
          <span className="h-px w-8 bg-amberz-300/70" aria-hidden="true" />
          {t('Hunza, Skardu and Chitral')}
        </motion.p>

        <h1 className="font-serif-display mt-6 max-w-4xl text-[2.75rem] font-semibold leading-[1.02] text-frost-50 drop-shadow-[0_4px_30px_rgba(0,0,0,.45)] sm:text-[4rem] lg:text-[5rem]">
          <WordReveal text={t('Book the North with')} delay={0.25} />
          <br />
          <WordReveal text={t('facts, not Facebook groups.')} delay={0.55} className="relative inline-block italic text-amberz-300">
            <GoldShimmer text={t('facts, not Facebook groups.')} />
          </WordReveal>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.05, ease }}
          className="measure mt-8 text-[16px] leading-[1.7] text-frost-200 sm:text-[18px]"
        >
          {t('Compare multi-day tours from tourism-department-verified operators, or request a jeep, guide or transfer and get matched in real time. Every answer is grounded in live road status, weather and permit data.')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2, ease }}
          className="mt-10 flex flex-wrap items-center gap-4"
        >
          <Link to="/explore" className="btn-primary btn-hero !px-6 !py-3.5 !text-[15px]">{t('Browse packages')}</Link>
          <Link to="/instant" className="btn-ghost !px-6 !py-3.5 !text-[15px]">{t('Request a ride now')}</Link>
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
                  // scaleX, not width: the bar fills on the compositor, with
                  // no layout work every frame. Mirrored in right-to-left.
                  <motion.span key={`${i}-${paused}`} className="absolute inset-0 origin-left rounded-full bg-glacier-300 rtl:origin-right"
                    initial={{ scaleX: paused || reduce ? 1 : 0 }} animate={{ scaleX: 1 }}
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
            className="mt-12 flex max-w-2xl items-start gap-3 border-s-2 border-rose-300/70 ps-4"
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

/* ------------------------------------------------------- two ways to go */
/**
 * A photo that drifts a little slower than the page as it scrolls past,
 * and settles in from a slight zoom the first time it is seen.
 */
function ParallaxPhoto({ query, name, className = '', strength = 36 }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [-strength, strength])
  return (
    <motion.div ref={ref} className={`relative overflow-hidden ${className}`}
      initial={reduce ? false : { opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.9, ease }}>
      <motion.div className="absolute -inset-y-12 inset-x-0" style={reduce ? undefined : { y }}>
        <PlacePhoto query={query} name={name} count={1} large className="h-full w-full" sizes="(max-width: 1024px) 100vw, 55vw" />
      </motion.div>
    </motion.div>
  )
}

const WAYS = [
  {
    kicker: 'Plan ahead',
    title: 'Compare tours before you commit.',
    body: 'Five days around Hunza and Skardu, a night at Deosai, or the long walk to K2. See the price in rupees, what is included, the route each day and any road warning, side by side.',
    points: ['Prices in PKR with inclusions spelled out', 'The day-by-day route, with the roads it uses', 'Road and weather warnings before you pay'],
    cta: ['Browse tours', '/explore'],
    photo: ['Passu Cones Hunza', 'Passu'],
  },
  {
    kicker: 'Leave today',
    title: 'Need a jeep this afternoon?',
    body: 'Post where you are and where you want to go. Operators nearby see the request at once, send a price and an arrival time, and you pick one. Then you can follow the trip as it happens.',
    points: ['Sent to the three closest operators', 'Offers with price and arrival time', 'Trip progress on your phone once you accept'],
    cta: ['Request a ride', '/instant'],
    photo: ['Fairy Meadows jeep road', 'Fairy Meadows'],
  },
]

function TwoWays() {
  const dir = useDir()
  return (
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionTitle
        eyebrow="Two ways to go"
        title="Plan months ahead, or find a driver in the next ten minutes."
      />
      <div className="space-y-20 sm:space-y-28">
        {WAYS.map((w, k) => (
          <div key={w.title} className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
            <ParallaxPhoto query={w.photo[0]} name={w.photo[1]}
              className={`aspect-[4/3] rounded-2xl lg:col-span-7 ${k % 2 ? 'lg:order-2' : ''}`} />
            <motion.div className="lg:col-span-5"
              initial={{ opacity: 0, x: (k % 2 ? -24 : 24) * dir }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.8, ease }}>
              <div className="text-[12px] font-semibold uppercase tracking-[.2em] text-amberz-300">{w.kicker}</div>
              <h3 className="font-serif-display mt-4 text-[1.75rem] font-semibold leading-[1.15] text-frost-50 sm:text-[2.25rem]">{w.title}</h3>
              <p className="mt-4 text-[16px] leading-[1.7] text-frost-300">{w.body}</p>
              <ul className="mt-6 divide-y divide-white/[.07] border-y border-white/[.07]">
                {w.points.map((pt) => (
                  <li key={pt} className="flex items-center gap-3 py-3 text-[15px] text-frost-100">
                    <Check className="h-4 w-4 shrink-0 text-glacier-300" aria-hidden="true" /> {pt}
                  </li>
                ))}
              </ul>
              <Link to={w.cta[1]} className="group mt-8 inline-flex items-center gap-2 text-[15px] font-semibold text-glacier-300 hover:text-glacier-200">
                {w.cta[0]} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" aria-hidden="true" />
              </Link>
            </motion.div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------- live conditions */
/** An editorial list of the roads, not a grid of identical cards. */
function ConditionsList({ routes = [], weather = [] }) {
  return (
    <section className="border-y border-white/[.06] bg-ink-900/30">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionTitle eyebrow="Roads today"
            title="Which roads are open, and since when."
            sub="Every road shows its status, what is happening on it and when it was last checked. Weather comes from Open-Meteo, earthquakes from USGS." />
          <Link to="/conditions" className="btn-ghost">All roads and weather</Link>
          {weather.length > 0 && (
            <ul className="mt-10 space-y-3">
              {weather.slice(0, 4).map((w) => (
                <li key={w.city} className="flex items-center gap-3 text-[14px]">
                  <WeatherIcon condition={w.condition} />
                  <span className="text-frost-100">{w.city}</span>
                  <span className="ms-auto font-mono tabular-nums text-frost-300">{w.temp_c}°</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Stagger className="divide-y divide-white/[.07] border-y border-white/[.07] lg:col-span-8" gap={0.06}>
          {routes.slice(0, 5).map((r) => (
            <motion.div key={r.id} variants={item}>
              <Link to="/conditions" className="group grid gap-2 py-6 sm:grid-cols-[1fr_auto] sm:gap-6">
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold text-frost-50 transition-colors group-hover:text-glacier-200">{r.name}</div>
                  <p className="measure mt-1.5 text-[15px] leading-[1.6] text-frost-300">{r.status_note}</p>
                  <div className="mt-2 text-[13px] text-frost-400">{r.distance_km} km, about {r.drive_hours} h · checked {relTime(r.updated_at)}</div>
                </div>
                <div className="sm:pt-1"><StatusPill status={r.status} /></div>
              </Link>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

/* -------------------------------------------------- full-width photo band */
function PhotoBand() {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['-12%', '12%'])
  return (
    <section ref={ref} className="on-photo relative isolate overflow-hidden">
      <motion.div className="absolute -inset-y-[15%] inset-x-0 -z-10" style={reduce ? undefined : { y }} aria-hidden="true">
        <PlacePhoto query="Attabad Lake Hunza" name="Attabad Lake" count={1} large className="h-full w-full" />
        <div className="absolute inset-0 bg-abyss/55" />
      </motion.div>
      <div className="mx-auto max-w-7xl px-5 py-32 sm:px-8 sm:py-44">
        <Reveal>
          <p className="font-serif-display max-w-3xl text-[2rem] font-semibold leading-[1.15] text-frost-50 sm:text-[3rem]">
            Up here a road can close by lunchtime. We check before you set off, not after.
          </p>
          <Link to="/conditions" className="mt-10 inline-flex items-center gap-2 text-[15px] font-semibold text-frost-50 underline decoration-amberz-300/70 underline-offset-8 hover:decoration-amberz-300">
            See today's roads
          </Link>
        </Reveal>
      </div>
    </section>
  )
}

/* ------------------------------------------------ best places this week */
/** Cards turn down into place from the top edge, one after another. */
const flipIn = {
  hidden: { opacity: 0, rotateX: -62, y: 24 },
  show: { opacity: 1, rotateX: 0, y: 0, transition: { duration: 0.9, ease } },
}

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
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionTitle eyebrow={t('This week')} title={t('Best places to visit this week.')}
        sub={t('Ranked from the live forecast, road status, recent earthquakes and the season, refreshed as conditions change.')}
        right={<Link to="/map" className="btn-ghost">{t('Open the map')}</Link>} />
      {state.status === 'loading' && <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[360px] rounded-2xl" />)}</div>}
      {state.status === 'error' && <ErrorState title={t('Recommendations are loading')} message={state.error} onRetry={load} />}
      {state.status === 'ok' && (
        <Stagger className="grid gap-6 lg:grid-cols-2 lg:grid-rows-2" gap={0.16}>
          {state.items.map((r, k) => (
            <Tilt key={r.destination.id} variants={flipIn} max={3}
              style={{ transformPerspective: 1100, transformOrigin: '50% 0%' }}
              className={`glass group flex flex-col overflow-hidden rounded-2xl ${k === 0 ? 'lg:row-span-2' : ''}`}>
              <div className={`relative overflow-hidden ${k === 0 ? 'h-56 lg:h-auto lg:flex-1' : 'h-40'}`}>
                <PlacePhoto query={r.destination.photo_query || r.destination.name} name={r.destination.name} count={1}
                            className="h-full w-full" imgClassName="group-hover:!scale-110 !duration-[1.4s]" />
                <div className="absolute inset-0 bg-gradient-to-t from-abyss/80 to-transparent" />
                <div className="absolute bottom-4 start-5">
                  <div className="text-[12px] font-semibold uppercase tracking-[.2em] text-snow/80">No. {k + 1} this week</div>
                  <div className={`font-serif-display font-semibold text-snow ${k === 0 ? 'text-[2.25rem]' : 'text-[1.5rem]'}`}>{r.destination.name}</div>
                </div>
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
            </Tilt>
          ))}
        </Stagger>
      )}
    </section>
  )
}

/* ------------------------------------------------------------- packages */
function Featured({ packages = [] }) {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionTitle
          eyebrow="Tours"
          title="Trips run by local operators."
          sub="Hunza, Skardu, Deosai, Fairy Meadows and Chitral, with the operator named on every trip. Hover to pause, swipe to browse."
          right={<Link to="/explore" className="btn-ghost">See all {packages.length} trips</Link>}
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
    <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="relative">
        <div className="relative grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 bg-glacier-400/70" aria-hidden="true" />
              <span className="text-[12px] font-semibold uppercase tracking-[.2em] text-glacier-300">Ask before you go</span>
            </div>
            <h2 className="font-serif-display text-[2rem] font-semibold leading-[1.08] text-frost-50 sm:text-[2.75rem]">
              It answers from today's records, or tells you it doesn't know.
            </h2>
            <p className="measure mt-5 text-[16px] leading-[1.7] text-frost-300">
              Ask about the Skardu road, a cheap three-day Hunza trip or where to eat in Karimabad.
              The assistant only sees the current road, weather, hazard and tour records, and every
              reply lists the records it used.
            </p>
            <ul className="mt-6 grid gap-x-8 gap-y-2 text-[15px] text-frost-200 sm:grid-cols-2">
              {['No made-up road closures', 'Sources listed on every reply', 'Every record timestamped', 'Says so when it has no data'].map((t) => (
                <li key={t} className="flex items-center gap-2.5"><Check className="h-4 w-4 shrink-0 text-glacier-300" aria-hidden="true" /> {t}</li>
              ))}
            </ul>
            <Link to="/assistant" className="btn-primary mt-10">Ask about a road or a trip</Link>
          </div>

          <TurnIn className="glass-strong rounded-2xl p-5">
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
                Single-lane diversion at Thowar, convoy released every 30 min from 06:00 to 19:00.
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {['skardu-road', 'alert-thowar', 'wx-skardu'].map((c) => (
                    <span key={c} className="rounded-md bg-ink-950/60 px-2 py-0.5 font-mono text-[10px] text-glacier-300">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </TurnIn>
        </div>
      </div>
    </section>
  )
}

/**
 * A panel that starts turned away (rotated in 3D) and swings round to face
 * the reader as it scrolls towards the middle of the screen.
 */
function TurnIn({ className, children }) {
  const ref = useRef(null)
  const dir = useDir()
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center 55%'] })
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 22, restDelta: 0.001 })
  const rotateY = useTransform(p, [0, 1], [-18 * dir, 0])
  const rotateX = useTransform(p, [0, 1], [8, 0])
  const z = useTransform(p, [0, 1], [-80, 0])
  return (
    <motion.div ref={ref} className={className}
      style={reduce ? undefined : { rotateY, rotateX, z, transformPerspective: 1200 }}>
      {children}
    </motion.div>
  )
}

/* ---------------------------------------------------------------- stats */
/*
 * Above the footer: a small 3D stage. Five mountain ridges sit at different
 * depths inside one perspective group; scrolling tips the whole range up
 * towards you and, on desktop, it turns a little with the mouse. The stats
 * float in front of it and flip up into place. Transforms only.
 */
function ridgePath(seed, peaks, top, jag) {
  // Sharp summits joined by soft, curved saddles, so it reads as a range
  // rather than a zigzag.
  let v = seed
  const rnd = () => { v = (v * 9301 + 49297) % 233280; return v / 233280 }
  const step = 1200 / peaks
  let d = `M0 300 L0 ${(top + jag).toFixed(0)}`
  for (let k = 0; k <= peaks; k++) {
    const px = k * step + (rnd() - 0.5) * step * 0.35
    const py = top + rnd() * jag * 0.45
    const sx = px + step * (0.4 + rnd() * 0.2)
    const sy = top + jag * (0.75 + rnd() * 0.25)
    d += ` L${px.toFixed(0)} ${py.toFixed(0)} Q${(px + (sx - px) * 0.55).toFixed(0)} ${(py + (sy - py) * 0.9).toFixed(0)} ${sx.toFixed(0)} ${sy.toFixed(0)}`
  }
  return d + ' L1200 300 Z'
}

const RIDGES = [
  { z: -460, y: -60, d: ridgePath(7, 3, 20, 150), fill: 'rgb(var(--glacier-300) / .10)' },
  { z: -330, y: -34, d: ridgePath(19, 4, 55, 140), fill: 'rgb(var(--glacier-400) / .15)' },
  { z: -210, y: -14, d: ridgePath(31, 5, 95, 120), fill: 'rgb(var(--ink-800) / .9)' },
  { z: -100, y: 0, d: ridgePath(43, 6, 140, 100), fill: 'rgb(var(--ink-850) / .96)' },
  { z: 0, y: 12, d: ridgePath(59, 7, 190, 80), fill: 'rgb(var(--ink-950))' },
]

const statIn = {
  hidden: { opacity: 0, rotateX: -70, y: 30 },
  show: { opacity: 1, rotateX: 0, y: 0, transition: { duration: 0.9, ease } },
}

function Stats({ operators = [], destinations = [], packages = [] }) {
  const t = useT()
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const trips = operators.reduce((sum, o) => sum + (o.trips || 0), 0)
  const cells = [
    { icon: Compass, value: packages.length, label: t('Tours listed'), suffix: '' },
    { icon: ShieldCheck, value: operators.length, label: t('Verified operators'), suffix: '' },
    { icon: RouteIcon, value: destinations.length, label: t('Destinations'), suffix: '' },
    { icon: Gauge, value: trips, label: t('Trips run by our operators'), suffix: '+' },
  ]
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const tip = useSpring(scrollYProgress, { stiffness: 60, damping: 20, restDelta: 0.001 })
  const rotateX = useTransform(tip, [0, 0.55, 1], [38, 8, -4])
  const rise = useTransform(tip, [0, 0.55], [90, 0])
  const turn = useSpring(0, { stiffness: 40, damping: 16 })
  const rotateY = useTransform(turn, (v) => v * 7)
  const onMove = (e) => {
    if (reduce || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    turn.set((e.clientX - r.left) / r.width - 0.5)
  }

  return (
    <section ref={ref} onPointerMove={onMove} onPointerLeave={() => turn.set(0)}
      className="relative overflow-hidden border-y border-white/[.06] bg-ink-900/30" style={{ perspective: 1000 }}>
      <motion.div aria-hidden="true" className="absolute inset-x-[-12%] bottom-0 h-[92%]"
        style={reduce ? undefined : { rotateX, rotateY, y: rise, transformStyle: 'preserve-3d', transformOrigin: '50% 100%' }}>
        {/* a low sun behind the farthest range */}
        <div className="absolute left-[62%] top-[6%] h-40 w-40 rounded-full sm:h-56 sm:w-56"
             style={{ transform: 'translateZ(-560px) scale(1.56)', background: 'radial-gradient(closest-side, rgb(var(--amberz-300) / .30), rgb(var(--amberz-400) / .10) 60%, transparent)' }} />
        {RIDGES.map((r, k) => (
          <svg key={k} viewBox="0 0 1200 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"
               style={{ transform: `translateZ(${r.z}px) translateY(${r.y}px) scale(${1 - r.z / 1000})` }}>
            <path d={r.d} style={{ fill: r.fill }} />
          </svg>
        ))}
      </motion.div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ink-950 to-transparent" aria-hidden="true" />

      <Stagger className="relative mx-auto grid max-w-7xl grid-cols-2 gap-3 px-5 pb-44 pt-16 sm:gap-4 sm:px-8 sm:pb-56 sm:pt-24 lg:grid-cols-4" gap={0.12}>
        {cells.map((c) => (
          <Tilt key={c.label} variants={statIn} max={6}
            style={{ transformPerspective: 900, transformOrigin: '50% 100%' }}
            className="glass overflow-hidden rounded-2xl px-2 py-8 text-center">
            <c.icon className="mx-auto mb-3 h-5 w-5 text-glacier-300" strokeWidth={1.8} />
            <div className="font-mono text-3xl font-bold text-frost-50 sm:text-4xl">
              <CountUp to={c.value} suffix={c.suffix} />
            </div>
            <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-frost-400">{c.label}</div>
          </Tilt>
        ))}
      </Stagger>
    </section>
  )
}

/* ----------------------------------------------------------------- page */
export default function Home() {
  const d = useData()

  // The hero needs no server data, so it paints at once; only the sections
  // below it wait for the API (which may be waking from a cold start).
  if (!d.ready) {
    return (
      <>
        <Hero alerts={[]} />
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="mt-4 h-5 w-1/3" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}
          </div>
        </div>
      </>
    )
  }

  const ticker = [
    ...d.routes.map((r) => `${r.name}, ${STATUS[r.status]?.label}`),
    ...d.weather.map((w) => `${w.city} ${w.temp_c}°C ${w.condition}`),
  ]

  return (
    <>
      <Hero alerts={d.alerts} />
      <WhenNear minHeight={50} margin="0px">
        <div className="border-y border-white/[.06] bg-ink-900/40">
          <div className="mx-auto max-w-7xl px-5 sm:px-8"><Marquee items={ticker} /></div>
        </div>
      </WhenNear>
      {/* Below the fold: each section mounts as the visitor scrolls near it. */}
      <WhenNear minHeight={1400} margin="0px 0px 60px 0px"><TwoWays /></WhenNear>
      <WhenNear minHeight={900}><ConditionsList routes={d.routes} weather={d.weather} /></WhenNear>
      <WhenNear minHeight={560}><PhotoBand /></WhenNear>
      <WhenNear minHeight={760}><BestThisWeek /></WhenNear>
      <WhenNear minHeight={700}><Featured packages={d.packages} /></WhenNear>
      <WhenNear minHeight={720}><AssistantTeaser suggestions={d.suggestions} /></WhenNear>
      <WhenNear minHeight={420}><Stats operators={d.operators} destinations={d.destinations} packages={d.packages} /></WhenNear>
    </>
  )
}
