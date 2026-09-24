import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SuccessCheck } from '../components/motion'
import { AlertTriangle, Loader2, XCircle } from 'lucide-react'

import { api, pkr } from '../lib/api'
import { Reveal } from '../components/ui'

/**
 * Where the gateway drops the customer after checkout.
 *
 * The query string is only a hint — it comes back through the browser and
 * cannot be trusted. The booking is re-fetched from the API, and that
 * server-side status is what the page reports.
 */
export default function PayReturn() {
  const [params] = useSearchParams()
  const bookingId = params.get('booking') || ''
  const txn = params.get('txn') || ''
  const hint = params.get('paid') === 'true'

  const [booking, setBooking] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    if (!bookingId) { setState('unknown'); return }
    let alive = true
    api.booking(bookingId)
      .then((b) => { if (alive) { setBooking(b); setState('done') } })
      .catch(() => { if (alive) setState('unknown') })
    return () => { alive = false }
  }, [bookingId])

  const confirmed = booking?.status === 'confirmed'

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
      <Reveal>
        <div className="rounded-3xl border border-ink-700 bg-ink-900/70 p-7 shadow-lift sm:p-10">
          {state === 'loading' && (
            <div className="flex items-center gap-3 text-frost-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              Confirming your payment with the server…
            </div>
          )}

          {state === 'unknown' && (
            <Outcome
              icon={<AlertTriangle className="h-7 w-7 text-amberz-400" />}
              title="We could not confirm this booking"
              tone="amber"
            >
              <p>
                {txn
                  ? <>Transaction <span className="font-mono text-frost-200">{txn}</span> was started, but the booking could not be read back.</>
                  : 'This page was opened without a booking reference.'}
              </p>
              <p className="mt-2">
                If money left your account, keep the reference above — nothing is charged twice.
              </p>
            </Outcome>
          )}

          {state === 'done' && (
            <Outcome
              icon={confirmed
                ? <SuccessCheck size={28} className="text-glacier-300" />
                : <XCircle className="h-7 w-7 text-rose-400" />}
              title={confirmed ? 'Booking confirmed' : 'Payment did not go through'}
              tone={confirmed ? 'glacier' : 'rose'}
            >
              {!confirmed && !hint && (
                <p className="mb-3">The gateway declined or cancelled this transaction.</p>
              )}
              {!confirmed && hint && (
                <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs">
                  The return link claimed success, but the server could not verify that
                  callback — so the booking stays unpaid. This is the check that stops a
                  forged redirect confirming a booking.
                </p>
              )}
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Booking" value={<span className="font-mono">{booking.booking_id}</span>} />
                <Row label="Status" value={booking.status} />
                <Row label="Travelers" value={booking.travelers} />
                <Row label="Total" value={pkr(booking.total_pkr)} />
                {txn && <Row label="Transaction" value={<span className="font-mono text-xs">{txn}</span>} />}
              </dl>

              {!!booking.condition_warnings?.length && (
                <div className="mt-5 rounded-xl border border-amberz-400/25 bg-amberz-400/10 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amberz-300">
                    Live route conditions
                  </p>
                  <ul className="space-y-1 text-xs text-frost-300">
                    {booking.condition_warnings.map((w) => <li key={w}>· {w}</li>)}
                  </ul>
                </div>
              )}
            </Outcome>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/explore" className="rounded-xl bg-glacier-400 px-5 py-2.5 text-sm font-semibold text-abyss">
              Browse more tours
            </Link>
            <Link to="/conditions" className="rounded-xl border border-ink-700 px-5 py-2.5 text-sm text-frost-200">
              Check live conditions
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  )
}

function Outcome({ icon, title, tone, children }) {
  const ring = { glacier: 'bg-glacier-500/10', rose: 'bg-rose-500/10', amber: 'bg-amberz-400/10' }[tone]
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className={`mb-4 inline-flex rounded-2xl p-3 ${ring}`}>{icon}</div>
      <h1 className="font-display text-2xl text-frost-50">{title}</h1>
      <div className="mt-2 text-sm text-frost-300">{children}</div>
    </motion.div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-ink-800 pb-1.5">
      <dt className="text-frost-400">{label}</dt>
      <dd className="text-frost-100">{value}</dd>
    </div>
  )
}
