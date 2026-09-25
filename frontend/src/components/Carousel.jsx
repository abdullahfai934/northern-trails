import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * An endless, smoothly drifting row of cards.
 *
 * The item list is rendered three times side by side and the track's x
 * offset wraps by one copy's width, so there is never a visible seam or a
 * jump back to the start. The drift pauses while the pointer is over the
 * row, while a card has keyboard focus, and while the row is being dragged
 * or swiped; a drag that moves more than a few pixels swallows the click
 * that ends it, so swiping never opens a card by accident. With reduced
 * motion requested it does not drift at all and stays swipeable.
 */
export default function Carousel({ items, renderItem, speed = 32, itemClassName = 'w-[300px] sm:w-[340px]', label = 'Carousel' }) {
  const reduce = useReducedMotion()
  const track = useRef(null)
  const x = useMotionValue(0)
  const [setWidth, setSetWidth] = useState(0)
  const paused = useRef(false)
  const dragging = useRef(false)
  const dragDistance = useRef(0)
  const nudge = useRef(0)
  const root = useRef(null)
  const onScreen = useRef(false)

  // Only drift while the row is on screen: an off-screen strip would keep
  // the main thread busy every frame for nothing.
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') { onScreen.current = true; return undefined }
    const io = new IntersectionObserver(([e]) => { onScreen.current = e.isIntersecting }, { rootMargin: '120px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // One copy's width, re-measured on resize and when images change layout.
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return undefined
    // The period is the distance from a card to its copy in the next set —
    // gaps included — which scrollWidth / 3 gets wrong by a fraction of one.
    const measure = () => {
      const a = el.children[0], b = el.children[items.length]
      setSetWidth(a && b ? b.offsetLeft - a.offsetLeft : el.scrollWidth / 3)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length])

  const wrap = (v) => {
    if (!setWidth) return v
    let n = v % setWidth
    if (n > 0) n -= setWidth
    return n
  }

  useAnimationFrame((_, delta) => {
    if (!setWidth || dragging.current || !onScreen.current) return
    const dt = Math.min(delta, 64) / 1000
    let v = x.get()
    if (nudge.current) {
      // Arrow buttons ease towards a target instead of jumping.
      const step = nudge.current * Math.min(1, dt * 7)
      nudge.current -= step
      if (Math.abs(nudge.current) < 0.5) nudge.current = 0
      v += step
    } else if (!paused.current && !reduce) {
      v -= speed * dt
    }
    x.set(wrap(v))
  })

  useEffect(() => { x.set(wrap(x.get())) }, [setWidth])

  const step = (dir) => {
    const card = track.current?.firstElementChild
    const w = card ? card.getBoundingClientRect().width + 20 : 320
    nudge.current += -dir * w
  }

  if (!items.length) return null
  const copies = [0, 1, 2]

  return (
    <div ref={root} className="relative" role="region" aria-roledescription="carousel" aria-label={label}
      onMouseEnter={() => { paused.current = true }}
      onMouseLeave={() => { paused.current = false }}
      onFocusCapture={() => { paused.current = true }}
      onBlurCapture={() => { paused.current = false }}>
      <div className="overflow-hidden py-4 [mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)]">
        <motion.div
          ref={track}
          style={{ x }}
          drag="x"
          dragMomentum={false}
          dragElastic={0}
          onDragStart={() => { dragging.current = true; dragDistance.current = 0 }}
          onDrag={(_, info) => { dragDistance.current = Math.abs(info.offset.x); x.set(wrap(x.get())) }}
          onDragEnd={() => { dragging.current = false }}
          onClickCapture={(e) => {
            if (dragDistance.current > 6) { e.preventDefault(); e.stopPropagation() }
            dragDistance.current = 0
          }}
          className="flex w-max cursor-grab gap-5 active:cursor-grabbing"
        >
          {copies.map((c) => items.map((it, i) => (
            <div key={`${c}-${it.id ?? i}`} className={`shrink-0 ${itemClassName}`}>
              {renderItem(it, i, c)}
            </div>
          )))}
        </motion.div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => step(-1)} aria-label="Previous"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[.04] text-frost-200 transition hover:bg-white/[.1]">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={() => step(1)} aria-label="Next"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[.04] text-frost-200 transition hover:bg-white/[.1]">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
