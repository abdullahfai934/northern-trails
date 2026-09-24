import React, { useEffect, useMemo, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { Cloud, CloudRain, CloudSun, Sun } from 'lucide-react'
import { useLanguage } from '../lib/i18n'
import { ease } from './ui'

/*
 * Shared motion pieces. Rules they all follow:
 *  - only transform and opacity animate (plus stroke-dashoffset on a few
 *    small SVG strokes, which is how a line "draws itself");
 *  - slow ease-out (400–900 ms), never springy;
 *  - with prefers-reduced-motion the big motion is skipped outright;
 *  - horizontal slides flip direction in right-to-left (Urdu).
 */

/** 1 in left-to-right, -1 in right-to-left: multiply any x offset by it. */
export function useDir() {
  return useLanguage().isUrdu ? -1 : 1
}

const finePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

/* The first-visit intro loader lives in index.html (plain HTML + CSS). */

/* ---------------------------------------------------- magnetic buttons */
/**
 * Buttons lean a few pixels towards the cursor on desktop. One document
 * listener serves every .btn-primary / .btn-ghost; it moves them with the
 * CSS `translate` property, which stacks with the hover lift and the
 * press-down `transform` instead of fighting them.
 */
export function MagneticButtons() {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce || !finePointer()) return undefined
    let el = null
    let rect = null
    const release = () => { if (el) el.style.translate = ''; el = null; rect = null }
    const move = (e) => {
      const t = e.target instanceof Element ? e.target.closest('.btn-primary, .btn-ghost') : null
      if (t !== el) { release(); el = t; rect = t && !t.disabled ? t.getBoundingClientRect() : null }
      if (!el || !rect) return
      const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)
      const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)
      el.style.translate = `${(dx * 5).toFixed(1)}px ${(dy * 3).toFixed(1)}px`
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', release)
    window.addEventListener('scroll', release, { passive: true })
    return () => {
      release()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', release)
      window.removeEventListener('scroll', release)
    }
  }, [reduce])
  return null
}

/* ---------------------------------------------------------- 3D tilt */
/**
 * A card that tilts a few degrees towards the cursor, with a soft light
 * following it. Desktop only; returns plain props on touch and with reduced
 * motion. Spread `bind` on the card and render `spotlight` inside it.
 */
export function useTilt({ max = 5 } = {}) {
  const reduce = useReducedMotion()
  const rx = useSpring(0, { stiffness: 120, damping: 20 })
  const ry = useSpring(0, { stiffness: 120, damping: 20 })
  const lx = useMotionValue(0)
  const ly = useMotionValue(0)
  const [on, setOn] = useState(false)
  const enabled = !reduce && finePointer()

  if (!enabled) return { bind: {}, style: {}, spotlight: null }

  const bind = {
    onPointerMove: (e) => {
      if (e.pointerType !== 'mouse') return
      const r = e.currentTarget.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      ry.set((px - 0.5) * 2 * max)
      rx.set(-(py - 0.5) * 2 * max)
      lx.set(e.clientX - r.left)
      ly.set(e.clientY - r.top)
      if (!on) setOn(true)
    },
    onPointerLeave: () => { rx.set(0); ry.set(0); setOn(false) },
  }
  const spotlight = (
    <motion.span aria-hidden="true"
      className="pointer-events-none absolute -left-40 -top-40 z-20 h-80 w-80 rounded-full transition-opacity duration-500"
      style={{
        x: lx, y: ly, opacity: on ? 1 : 0,
        background: 'radial-gradient(closest-side, rgba(108,196,192,.16), rgba(217,180,95,.06) 55%, transparent)',
      }} />
  )
  return { bind, style: { rotateX: rx, rotateY: ry, transformPerspective: 900 }, spotlight }
}

/* ------------------------------------------------ success check + burst */
const BURST = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 + 0.3
  const r = 40 + (i % 3) * 8
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: i % 2 ? 5 : 3.5 }
})

/**
 * The booking-confirmed mark: the circle settles in, the check draws itself,
 * and a small ring of gold particles bursts out once (about a second).
 */
export function SuccessCheck({ size = 64, className = 'bg-emerald-400/15 text-emerald-300' }) {
  const reduce = useReducedMotion()
  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: size, height: size }}>
      {!reduce && BURST.map((p, i) => (
        <motion.span key={i} aria-hidden="true" className="absolute rounded-full bg-amberz-300"
          style={{ width: p.s, height: p.s }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
          transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }} />
      ))}
      <motion.div className={`grid h-full w-full place-items-center rounded-full ${className}`}
        initial={reduce ? false : { scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
             style={{ width: size / 2, height: size / 2 }} role="img" aria-label="Confirmed">
          <motion.path d="M20 6 9 17l-5-5"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease }} />
        </svg>
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------ live weather */
export function weatherKind(condition = '') {
  const c = String(condition).toLowerCase()
  if (/snow|sleet|blizzard|ice/.test(c)) return 'snow'
  if (/rain|drizzle|shower|thunder|storm/.test(c)) return 'rain'
  if (/overcast|fog|mist|haze|cloud/.test(c) && !/partly|mainly clear/.test(c)) return 'cloud'
  if (/partly|mainly clear/.test(c)) return 'partly'
  return 'sun'
}

/**
 * A small weather icon that moves the way the live weather does: falling
 * snow, rain drops, drifting cloud or a gently glowing sun. Light enough to
 * sit on every card; with reduced motion it is the still icon.
 */
export function WeatherIcon({ condition, className = '' }) {
  const kind = weatherKind(condition)
  return (
    <span className={`nt-wx relative inline-grid h-7 w-7 shrink-0 place-items-center ${className}`} aria-label={condition} role="img">
      {kind === 'sun' && (
        <>
          <span className="nt-wx-glow absolute inset-[-6px] rounded-full" aria-hidden="true" />
          <Sun className="nt-wx-spin relative h-6 w-6 text-amberz-300" strokeWidth={1.6} />
        </>
      )}
      {kind === 'partly' && (
        <>
          <span className="nt-wx-glow absolute -right-1 -top-1 h-5 w-5 rounded-full" aria-hidden="true" />
          <CloudSun className="nt-wx-drift relative h-6 w-6 text-glacier-300" strokeWidth={1.6} />
        </>
      )}
      {kind === 'cloud' && (
        <>
          <Cloud className="nt-wx-drift-back absolute -right-1.5 -top-1 h-4 w-4 text-glacier-300/50" strokeWidth={1.6} aria-hidden="true" />
          <Cloud className="nt-wx-drift relative h-6 w-6 text-glacier-300" strokeWidth={1.6} />
        </>
      )}
      {kind === 'rain' && (
        <>
          <CloudRain className="relative h-6 w-6 text-glacier-300" strokeWidth={1.6} />
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden="true" className="nt-wx-drop absolute top-[19px] h-[5px] w-px rounded-full bg-glacier-300"
                  style={{ left: 8 + i * 5, animationDelay: `${i * 0.28}s` }} />
          ))}
        </>
      )}
      {kind === 'snow' && (
        <>
          <Cloud className="relative h-6 w-6 text-glacier-300" strokeWidth={1.6} />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} aria-hidden="true" className="nt-wx-flake absolute top-[18px] h-[3px] w-[3px] rounded-full bg-frost-50"
                  style={{ left: 6 + i * 4.5, animationDelay: `${i * 0.55}s` }} />
          ))}
        </>
      )}
    </span>
  )
}

/* -------------------------------------------------- streamed answers */
/**
 * Reveals a finished answer word by word, as if it were arriving, in at
 * most ~1.6 s however long it is. `on` false (old messages, reduced motion)
 * returns the whole text at once.
 */
export function useStreamedText(text, on) {
  const words = useMemo(() => String(text || '').split(/(\s+)/), [text])
  const [n, setN] = useState(() => (on ? 0 : Infinity))
  useEffect(() => {
    if (!on) { setN(Infinity); return undefined }
    const total = words.length
    const per = Math.max(2, Math.ceil(total / 60))      // ~60 frames of 26 ms
    let shown = 0
    const id = setInterval(() => {
      shown += per
      setN(shown)
      if (shown >= total) clearInterval(id)
    }, 26)
    return () => clearInterval(id)
  }, [words, on])
  if (n >= words.length) return { text, done: true }
  let partial = words.slice(0, n).join('')
  // Close a **bold** that is still open, so no stray asterisks flash by.
  if ((partial.match(/\*\*/g) || []).length % 2) partial += '**'
  return { text: partial, done: false }
}

/* ------------------------------------------------------ arrival glow */
/**
 * Drop inside a card that just arrived (a new bid, a new job): a soft teal
 * glow that fades out over a couple of seconds. Opacity only; no sound.
 * The card needs `relative overflow-hidden`.
 */
export function ArrivalGlow({ delay = 0.4 }) {
  return (
    <motion.span aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-glacier-400/60"
      style={{ boxShadow: 'inset 0 0 36px rgb(var(--glacier-400) / .20)' }}
      initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 2, delay, ease: 'easeOut' }} />
  )
}

/** The slide-in every new card uses: from the reading side, mirrored in RTL. */
export const slideIn = (dir, i = 0) => ({
  initial: { opacity: 0, x: 36 * dir },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -36 * dir },
  transition: { duration: 0.6, delay: i * 0.06, ease },
})

/** A motion.div that tilts towards the cursor with a soft spotlight (desktop). */
export function Tilt({ className = '', style, children, max = 5, ...rest }) {
  const t = useTilt({ max })
  return (
    <motion.div {...rest} {...t.bind} style={{ ...style, ...t.style }} className={`relative ${className}`}>
      {t.spotlight}
      {children}
    </motion.div>
  )
}
