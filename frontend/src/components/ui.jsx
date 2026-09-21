import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { X } from 'lucide-react'
import { STATUS } from '../lib/api'

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

/* ------------------------------------------------------------- headings */
export function SectionTitle({ eyebrow, title, sub, right }) {
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
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  const variants = side === 'right'
    ? { hidden: { x: '100%' }, show: { x: 0 } }
    : { hidden: { y: '100%' }, show: { y: 0 } }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div
            className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm"
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
  const push = (msg, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }
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
