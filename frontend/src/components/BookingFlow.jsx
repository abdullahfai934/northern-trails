import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { api, pkr, postToGateway } from '../lib/api'
import { Field, fieldClass, useToast } from './ui'

const PHONE_RE = /^\+?[0-9][0-9\s-]{8,17}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

const today = () => new Date().toISOString().slice(0, 10)

/** Client-side checks, in step with BookingIn in backend/app/main.py. */
export function validateBooking(f) {
  const e = {}
  if (f.traveler_name.trim().length < 2) e.traveler_name = "Enter the lead traveler's full name"
  if (!f.phone.trim()) e.phone = 'A phone number lets the operator confirm with you'
  else if (!PHONE_RE.test(f.phone.trim())) e.phone = 'Enter a phone number like +92 300 1234567'
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address'
  if (!f.start_date) e.start_date = 'Pick a start date'
  else if (f.start_date < today()) e.start_date = 'Start date is in the past'
  const n = Number(f.travelers)
  if (!Number.isInteger(n) || n < 1 || n > 20) e.travelers = 'Between 1 and 20 travelers'
  return e
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-frost-400">{k}</span>
      <span className="font-semibold text-frost-100">{v}</span>
    </div>
  )
}

/**
 * Reserve → held booking (stored by the API) → pay.
 *
 * The booking is created in `pending_payment`; the gateway's signed callback
 * is what confirms it. Field errors from the server are shown against the
 * field they belong to, the same way as the client's own checks.
 */
export default function BookingFlow({ pkg, onDone }) {
  const toast = useToast()
  const [form, setForm] = useState({ traveler_name: '', phone: '', email: '', start_date: '', travelers: 2, notes: '' })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [confirmed, setConfirmed] = useState(null)

  const set = (k) => (e) => {
    const next = { ...form, [k]: e.target.value }
    setForm(next)
    if (touched[k]) setErrors(validateBooking(next))
  }
  const blur = (k) => () => { setTouched((t) => ({ ...t, [k]: true })); setErrors(validateBooking(form)) }

  const submit = async (e) => {
    e.preventDefault()
    const found = validateBooking(form)
    setErrors(found)
    setTouched({ traveler_name: true, phone: true, email: true, start_date: true, travelers: true })
    if (Object.keys(found).length) return
    setSubmitting(true)
    try {
      const res = await api.book({ ...form, package_id: pkg.id, travelers: Number(form.travelers) })
      setConfirmed(res)
      toast('Booking held — ' + res.booking_id)
    } catch (err) {
      if (err.fields && Object.keys(err.fields).length) setErrors(err.fields)
      toast(err.message || 'Booking failed', 'bad')
    } finally { setSubmitting(false) }
  }

  const pay = async (provider) => {
    setPaying(true)
    try {
      const checkout = await api.startPayment({ booking_id: confirmed.booking_id, provider, phone: form.phone })
      postToGateway(checkout)
    } catch (err) {
      setPaying(false)
      toast('Could not start payment: ' + err.message, 'bad')
    }
  }

  if (confirmed) {
    return (
      <div className="space-y-5">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                    className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Check className="h-8 w-8" strokeWidth={3} />
        </motion.div>
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amberz-300">Held — payment required</div>
          <div className="mt-1 font-mono text-lg font-bold text-frost-50">{confirmed.booking_id}</div>
          <div className="mt-1 text-[13px] text-frost-300">{confirmed.package}</div>
          <div className="mt-0.5 text-[12px] text-frost-400">with {confirmed.operator}</div>
        </div>
        <div className="glass rounded-xl p-4 text-[13px]">
          <Row k="Travelers" v={confirmed.travelers} />
          <Row k="Start date" v={form.start_date} />
          <Row k="Total" v={pkr(confirmed.total_pkr)} />
        </div>
        {confirmed.condition_warnings?.length > 0 && (
          <div className="glass rounded-xl border-amberz-400/20 bg-amberz-400/[.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-amberz-300">
              <AlertTriangle className="h-3.5 w-3.5" /> Condition alerts on your route
            </div>
            <ul className="space-y-1.5 text-[12px] leading-relaxed text-frost-300">
              {confirmed.condition_warnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-frost-200">Pay to confirm</div>
          {(confirmed.payment?.providers || []).filter((p) => p.configured).map((prov) => (
            <button key={prov.id} disabled={paying} onClick={() => pay(prov.id)}
              className="flex w-full items-center justify-between rounded-xl border border-glacier-500/40 bg-glacier-500/10 px-4 py-3 text-[13px] text-frost-50 transition hover:border-glacier-400 disabled:opacity-50">
              <span className="flex items-center gap-2 font-semibold">
                {paying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {prov.id === 'mock' ? 'Sandbox gateway (test payment)' : prov.name}
              </span>
              <span className="text-[11px]">{pkr(confirmed.total_pkr)}</span>
            </button>
          ))}
          <p className="text-[11px] leading-relaxed text-frost-400">
            Your booking is saved. The operator confirms availability before departure; the
            sandbox gateway runs the same signed callback a live JazzCash or Easypaisa payment does.
          </p>
          {onDone && <button onClick={onDone} className="btn-ghost w-full !py-2.5 !text-[13px]">Done</button>}
        </div>
      </div>
    )
  }

  const total = pkg.price_pkr * (Number(form.travelers) || 0)
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="glass flex items-center justify-between rounded-xl px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-frost-50">{pkg.title}</div>
          <div className="text-[11.5px] text-frost-400">{pkg.days} days · {pkg.operator?.name}</div>
        </div>
        <div className="shrink-0 font-mono text-[13px] font-bold text-frost-50">{pkr(pkg.price_pkr)}</div>
      </div>
      <Field label="Full name" htmlFor="bk-name" required error={touched.traveler_name && errors.traveler_name}>
        <input id="bk-name" value={form.traveler_name} onChange={set('traveler_name')} onBlur={blur('traveler_name')}
               autoComplete="name" className={fieldClass(touched.traveler_name && errors.traveler_name)} placeholder="As on your CNIC / passport" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="bk-phone" required error={touched.phone && errors.phone}>
          <input id="bk-phone" type="tel" value={form.phone} onChange={set('phone')} onBlur={blur('phone')}
                 autoComplete="tel" inputMode="tel" className={fieldClass(touched.phone && errors.phone)} placeholder="+92 3xx xxxxxxx" />
        </Field>
        <Field label="Email" htmlFor="bk-email" error={touched.email && errors.email} hint="Optional — for the receipt">
          <input id="bk-email" type="email" value={form.email} onChange={set('email')} onBlur={blur('email')}
                 autoComplete="email" className={fieldClass(touched.email && errors.email)} placeholder="you@example.com" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" htmlFor="bk-date" required error={touched.start_date && errors.start_date}>
          <input id="bk-date" type="date" min={today()} value={form.start_date} onChange={set('start_date')} onBlur={blur('start_date')}
                 className={fieldClass(touched.start_date && errors.start_date)} />
        </Field>
        <Field label="Travelers" htmlFor="bk-n" required error={touched.travelers && errors.travelers}>
          <input id="bk-n" type="number" min="1" max="20" value={form.travelers} onChange={set('travelers')} onBlur={blur('travelers')}
                 className={fieldClass(touched.travelers && errors.travelers)} />
        </Field>
      </div>
      <Field label="Notes for the operator" htmlFor="bk-notes" hint="Optional — dietary needs, pickup hotel, anything else">
        <textarea id="bk-notes" rows={2} maxLength={500} value={form.notes} onChange={set('notes')} className="field resize-none" />
      </Field>
      <div className="glass rounded-xl p-4 text-[13px]">
        <Row k={`${pkr(pkg.price_pkr)} × ${Number(form.travelers) || 0}`} v={pkr(total)} />
      </div>
      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving your booking…</> : 'Confirm reservation'}
      </button>
      <p className="text-center text-[11px] text-frost-400">No charge yet — you pay after the booking is held.</p>
    </form>
  )
}
