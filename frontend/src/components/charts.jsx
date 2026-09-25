import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react'
import { ease } from './ui'

/*
 * Charts, built as plain SVG so they follow the site's theme tokens.
 *
 * Colour rules (validated with the dataviz palette checker, both themes):
 *  - Categorical series (the budget donut) use the fixed slot order in
 *    --series-1…6; never cycled, never by rank.
 *  - A single series (bars) uses the brand teal; text never wears a series
 *    colour, it stays in the frost ink tokens.
 *  - Status (the safety gauge) uses the reserved good / warning / critical
 *    steps, always paired with an icon and a label.
 */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)']

const STATUS = {
  green:  { color: 'var(--status-good)', Icon: CheckCircle2 },
  yellow: { color: 'var(--status-warning)', Icon: AlertTriangle },
  red:    { color: 'var(--status-critical)', Icon: OctagonAlert },
}

function useAppear() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const reduce = useReducedMotion()
  return [ref, inView || reduce, reduce]
}

/* --------------------------------------------------------- safety gauge */
export function SafetyGauge({ score = 0, color = 'yellow', label = '', size = 132, stroke = 11 }) {
  const [ref, show, reduce] = useAppear()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = 0.75                       // a 270° gauge, open at the bottom
  const s = STATUS[color] || STATUS.yellow
  const [shown, setShown] = useState(0)
  // While the arc sweeps up, its colour follows the number through the same
  // bands the server uses (red < 50, yellow < 75, green), so it lands on the
  // score's real status colour.
  const live = shown >= score ? s.color
    : shown >= 75 ? STATUS.green.color : shown >= 50 ? STATUS.yellow.color : STATUS.red.color

  useEffect(() => {
    if (!show) return undefined
    if (reduce) { setShown(score); return undefined }
    let raf, t0
    const tick = (t) => {
      t0 = t0 ?? t
      const p = Math.min(1, (t - t0) / 1100)
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [show, score, reduce])

  return (
    <div ref={ref} className="relative inline-grid place-items-center" style={{ width: size, height: size }}
         role="img" aria-label={`Safety score ${score} out of 100: ${label}`}>
      <svg width={size} height={size} className="-rotate-[225deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--overlay) / .08)"
                strokeWidth={stroke} strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={live} strokeWidth={stroke}
          style={{ transition: 'stroke .35s ease-out' }}
          strokeLinecap="round" strokeDasharray={`${c * arc} ${c}`}
          initial={{ strokeDashoffset: c * arc }}
          animate={{ strokeDashoffset: show ? c * arc * (1 - score / 100) : c * arc }}
          transition={{ duration: reduce ? 0 : 1.1, ease }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-mono text-[28px] font-semibold leading-none text-frost-50">{shown}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[.14em] text-frost-400">/ 100</div>
        </div>
      </div>
      <div className="absolute -bottom-1 flex items-center gap-1 rounded-full bg-ink-900/90 px-2.5 py-1 text-[11px] font-semibold text-frost-100 ring-1 ring-white/[.06]">
        <s.Icon className="h-3.5 w-3.5" style={{ color: s.color }} /> {label}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ donut */
export function DonutChart({ data, total, size = 220, format = (v) => v, centerLabel = 'Total' }) {
  const [ref, show, reduce] = useAppear()
  const [hover, setHover] = useState(null)
  const sum = total ?? data.reduce((a, d) => a + d.value, 0)
  const r = size / 2 - 14
  const stroke = 26
  const c = 2 * Math.PI * r
  const gap = sum > 0 && data.filter((d) => d.value > 0).length > 1 ? 2 : 0   // 2px surface gap between fills
  let acc = 0
  const arcs = data.map((d, i) => {
    const len = sum ? (d.value / sum) * c : 0
    const a = { ...d, i, len: Math.max(0, len - gap), offset: -acc }
    acc += len
    return a
  })
  const active = hover != null ? data[hover] : null
  return (
    <div ref={ref} className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Cost breakdown chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--overlay) / .05)" strokeWidth={stroke} />
        {arcs.map((a) => a.len > 0 && (
          <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={SERIES[a.i % SERIES.length]} strokeWidth={hover === a.i ? stroke + 6 : stroke}
            strokeDasharray={`${a.len} ${c}`}
            onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)}
            style={{
              cursor: 'pointer',
              strokeDashoffset: show ? a.offset : a.offset + a.len,
              opacity: show ? 1 : 0,
              // CSS transitions, so arcs also glide when the numbers change.
              transition: reduce ? 'none'
                : `stroke-dashoffset .8s cubic-bezier(.22,1,.36,1) ${a.i * 0.08}s, stroke-dasharray .6s cubic-bezier(.22,1,.36,1), opacity .5s ${a.i * 0.08}s, stroke-width .25s`,
            }}>
            <title>{`${a.label}: ${format(a.value)} (${sum ? Math.round((a.value / sum) * 100) : 0}%)`}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] text-frost-400">{active ? active.label : centerLabel}</div>
          <div className="mt-1 font-mono text-lg font-semibold text-frost-50">{format(active ? active.value : sum)}</div>
          {active && <div className="text-[11px] text-frost-300">{sum ? Math.round((active.value / sum) * 100) : 0}%</div>}
        </div>
      </div>
    </div>
  )
}

/** Legend + table for the donut: identity never rests on colour alone. */
export function DonutLegend({ data, format = (v) => v }) {
  const sum = data.reduce((a, d) => a + d.value, 0)
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {data.map((d, i) => (
          <tr key={d.label} className="border-b border-white/[.05] last:border-0">
            <td className="py-2 pe-2"><span className="inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: SERIES[i % SERIES.length] }} /></td>
            <td className="py-2 text-frost-200">{d.label}</td>
            <td className="py-2 text-end font-mono tabular-nums text-frost-50">{format(d.value)}</td>
            <td className="w-12 py-2 text-end font-mono text-[11.5px] tabular-nums text-frost-400">{sum ? Math.round((d.value / sum) * 100) : 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ---------------------------------------------------------- bar chart */
/**
 * Vertical bars for one series over categories (months, stars…). Thin bars
 * with rounded data-ends on a baseline, recessive gridlines, a tooltip on
 * hover, and values written only where there is room.
 */
export function BarChart({ data, height = 200, format = (v) => v, color = 'var(--series-brand)', emptyText = 'No data yet' }) {
  const [ref, show, reduce] = useAppear()
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const ticks = useMemo(() => {
    const step = niceStep(max / 4)
    return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  }, [max])
  const top = ticks[ticks.length - 1] || max
  if (!data.length || data.every((d) => !d.value)) {
    return <div className="grid place-items-center text-[13px] text-frost-400" style={{ height }}>{emptyText}</div>
  }
  return (
    <div ref={ref} className="relative" style={{ height }}>
      <div className="absolute inset-0 bottom-6 start-10">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-white/[.05]" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="absolute -start-10 -top-2 w-9 text-end font-mono text-[10px] tabular-nums text-frost-400">{compact(t)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-2 px-1">
          {data.map((d, i) => (
            <div key={d.label} className="relative flex h-full flex-1 items-end justify-center"
                 onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Grows with scaleY from the baseline: no layout work per frame. */}
              <motion.div className="w-full max-w-[34px] origin-bottom rounded-t-[4px]"
                style={{ background: color, opacity: hover == null || hover === i ? 1 : 0.55, height: `${(d.value / top) * 100}%` }}
                initial={{ scaleY: 0 }} animate={{ scaleY: show ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : i * 0.05, ease }} />
              {hover === i && (
                <div className="absolute z-10 -translate-y-2 whitespace-nowrap rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11.5px] text-frost-50 shadow-lift ring-1 ring-white/[.08]"
                     style={{ bottom: `${(d.value / top) * 100}%` }}>
                  <div className="text-frost-400">{d.label}</div>
                  <div className="font-mono font-semibold">{format(d.value)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 start-10 flex gap-2 px-1">
        {data.map((d) => <div key={d.label} className="flex-1 truncate text-center text-[10.5px] text-frost-400">{d.short || d.label}</div>)}
      </div>
    </div>
  )
}

/** Horizontal bars with labels and values — for ranked lists. */
export function RankBars({ data, format = (v) => v, color = 'var(--series-brand)' }) {
  const [ref, show, reduce] = useAppear()
  const max = Math.max(1, ...data.map((d) => d.value))
  if (!data.length) return <div className="py-8 text-center text-[13px] text-frost-400">No data yet</div>
  return (
    <div ref={ref} className="space-y-3">
      {data.map((d, i) => (
        <div key={d.label} title={`${d.label}: ${format(d.value)}`}>
          <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
            <span className="text-frost-200">{d.label}</span>
            <span className="font-mono tabular-nums text-frost-50">{format(d.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[.05]">
            <motion.div className="h-full origin-left rounded-full rtl:origin-right" style={{ background: color, width: `${(d.value / max) * 100}%` }}
              initial={{ scaleX: 0 }} animate={{ scaleX: show ? 1 : 0 }}
              transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : i * 0.06, ease }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function niceStep(raw) {
  if (raw <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

function compact(v) {
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${+(v / 1e3).toFixed(0)}k`
  return String(v)
}
