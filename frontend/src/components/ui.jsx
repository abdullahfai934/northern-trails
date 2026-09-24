import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { AlertCircle, RotateCcw, X } from 'lucide-react'
import { STATUS } from '../lib/api'
import { useTranslation } from 'react-i18next'

export const ease = [0.22, 1, 0.36, 1]

/* ---------------------------------------------------------------- reveal */
export function Reveal({ children, delay = 0, y = 26, className = '', once = true }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once, margin: '-12% 0px -8% 0px' })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y, filter: 'blur(6px)' }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{ duration: 0.75, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function Stagger({ children, className = '', gap = 0.07 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      variants={{ show: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </motion.div>
  )
}

export const item = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease } },
}

/**
 * Renders its children only once they come within a screen or so of the
 * viewport. Below-the-fold sections then cost nothing on load, which is most
 * of the work a mid-range phone does on the home page. The placeholder keeps
 * roughly the section's height so the scrollbar does not jump.
 */
export function WhenNear({ children, minHeight = 480, margin = '400px 0px' }) {
  const ref = useRef(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near) return undefined
    const el = ref.current
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect() } }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  if (near) return children
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />
}

/* ------------------------------------------------------------- headings */
export function SectionTitle({ eyebrow, title, sub, right }) {
  const { t } = useTranslation()
  const tr = (x) => (typeof x === 'string' ? t(x) : x)
  eyebrow = tr(eyebrow); title = tr(title); sub = tr(sub)
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className="mb-3 flex items-center gap-2.5">
            <span className="h-px w-8 bg-gradient-to-r from-glacier-400 to-transparent" />
            <span className="text-[11px] font-bold uppercase tracking-[.22em] text-glacier-300">{eyebrow}</span>
          </div>
        )}
        <h2 className="max-w-2xl text-3xl font-extrabold leading-[1.1] tracking-tight text-frost-50 sm:text-[2.6rem]">
          {title}
        </h2>
        {sub && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-frost-300">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

/* ---------------------------------------------------------- status pill */
export function StatusPill({ status, size = 'sm' }) {
  const s = STATUS[status] || STATUS.open
  return (
    <span className={`inline-flex items-center gap-2 rounded-full ${s.bg} ${s.tone} ring-1 ${s.ring}
      ${size === 'lg' ? 'px-3.5 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]'} font-semibold tracking-wide`}>
      <span className="relative flex h-1.5 w-1.5">
        <span className={`absolute inline-flex h-full w-full rounded-full ${s.dot} animate-ping2`} />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </span>
  )
}

export function Stars({ value = 5, className = '' }) {
  // A listing nobody has reviewed yet is new, not zero stars.
  if (!value) {
    return <span className={`rounded-full bg-glacier-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-glacier-300 ${className}`}>New</span>
  }
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-amberz-400"><path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9 4.8 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" /></svg>
      <span className="text-xs font-bold text-frost-100">{value}</span>
    </span>
  )
}

/* -------------------------------------------------------------- count up */
export function CountUp({ to, duration = 1.6, suffix = '', prefix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 })
  const text = useTransform(spring, (v) => prefix + Math.round(v).toLocaleString('en-PK') + suffix)
  useEffect(() => { if (inView) mv.set(to) }, [inView, to, mv])
  return <motion.span ref={ref}>{text}</motion.span>
}

/* ------------------------------------------------- sliding bottom sheet */
export function Sheet({ open, onClose, title, children, side = 'right' }) {
  useScrollLock(open)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const variants = side === 'right'
    ? { hidden: { x: '100%' }, show: { x: 0 } }
    : { hidden: { y: '100%' }, show: { y: 0 } }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[88]">
          <motion.div
            className="absolute inset-0 bg-abyss/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            variants={variants} initial="hidden" animate="show" exit="hidden"
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            drag={side === 'bottom' ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, i) => i.offset.y > 120 && onClose?.()}
            className={
              side === 'right'
                ? 'glass-strong absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto no-scrollbar'
                : 'glass-strong absolute bottom-0 left-0 right-0 max-h-[88vh] overflow-y-auto rounded-t-3xl no-scrollbar'
            }
          >
            {side === 'bottom' && <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/20" />}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[.07] bg-ink-900/80 px-5 py-4 backdrop-blur-xl">
              <h3 className="text-sm font-bold tracking-wide text-frost-50">{title}</h3>
              <button onClick={onClose} className="rounded-lg p-2 text-frost-300 transition hover:bg-white/10 hover:text-frost-50" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------- marquee */
export function Marquee({ items }) {
  return (
    <div className="relative overflow-hidden py-3 mask-fade-r">
      <div className="flex w-max animate-marquee gap-10">
        {[...items, ...items].map((t, i) => (
          <span key={i} className="flex shrink-0 items-center gap-3 text-[13px] text-frost-300">
            <span className="h-1 w-1 rounded-full bg-glacier-400" />
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- toasts */
const ToastCtx = React.createContext(() => {})
export const useToast = () => React.useContext(ToastCtx)

export function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])
  // Stable identity: pages list `toast` in effect dependencies.
  const push = React.useCallback((msg, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-3), { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-8">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 18, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.35, ease }}
              role="status"
              className={`glass-strong pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm shadow-lift
                ${t.tone === 'warn' ? 'text-amberz-300' : t.tone === 'bad' ? 'text-rose-300' : 'text-frost-100'}`}
            >
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

/* ------------------------------------------------------------ skeleton */
export function Skeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-white/[.04] ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[.07] to-transparent" />
    </div>
  )
}

/* ------------------------------------------------------ body scroll lock */
/* Counted, so a modal opened over a sheet does not unlock the page when the
   modal closes while the sheet is still open. */
let locks = 0
function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    locks += 1
    document.body.style.overflow = 'hidden'
    return () => {
      locks -= 1
      if (locks <= 0) { locks = 0; document.body.style.overflow = '' }
    }
  }, [active])
}

/* ---------------------------------------------------------------- modal */
export function Modal({ open, onClose, title, children, wide = false, labelledBy }) {
  const panel = useRef(null)
  useScrollLock(open)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => panel.current?.focus(), 50)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-abyss/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}
            tabIndex={-1}
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
            className={`glass-strong relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl outline-none sm:rounded-3xl
              ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
              <h3 className="truncate text-sm font-bold tracking-wide text-frost-50">{title}</h3>
              <button onClick={onClose} className="rounded-lg p-2 text-frost-300 transition hover:bg-white/10 hover:text-frost-50" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain no-scrollbar">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ---------------------------------------------------------- error state */
export function ErrorState({ title = 'Something went wrong', message, onRetry, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}
      className={`glass flex flex-col items-center rounded-2xl px-6 py-10 text-center ${className}`}
      role="alert"
    >
      <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-rose-400/10 text-rose-300">
        <AlertCircle className="h-5 w-5" />
      </span>
      <div className="text-[15px] font-bold text-frost-50">{title}</div>
      {message && <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-frost-400">{message}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-5 !py-2 !text-[13px]">
          <RotateCcw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </motion.div>
  )
}

/* ---------------------------------------------------------- form fields */
export function Field({ label, error, hint, children, htmlFor, required }) {
  return (
    <div>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}{required && <span className="text-rose-400"> *</span>}
        </label>
      )}
      {children}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p key="e" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 text-[11.5px] font-medium text-rose-300" role="alert">{error}</motion.p>
        ) : hint ? (
          <p className="mt-1.5 text-[11px] text-frost-400">{hint}</p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export const fieldClass = (error) => `field ${error ? '!border-rose-400/60 focus:!ring-rose-400/10' : ''}`
