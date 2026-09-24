import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell, BellRing, CalendarCheck, Download, FileText, Heart, ImagePlus, Loader2, MailCheck, MessageSquare,
  Save, Star, Trash2, User, X,
} from 'lucide-react'

import { api, assetUrl, pkr, relTime } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import { useWishlist } from '../lib/wishlist'
import { downloadPlanPdf } from '../lib/pdf'
import Guard from '../components/Guard'
import PlacePhoto from '../components/PlacePhoto'
import PackageCard from '../components/PackageCard'
import { Avatar } from '../components/SignIn'
import { ErrorState, Field, Modal, Reveal, Skeleton, Stagger, ease, fieldClass, useToast } from '../components/ui'

const TABS = [
  ['bookings', CalendarCheck, 'My bookings'],
  ['wishlist', Heart, 'Wishlist'],
  ['plans', FileText, 'Trip plans'],
  ['reviews', MessageSquare, 'Reviews'],
  ['alerts', Bell, 'Alerts'],
  ['settings', User, 'Profile & safety'],
]

const STATUS_TONE = {
  pending_payment: 'text-amberz-300 bg-amberz-400/10',
  confirmed: 'text-emerald-300 bg-emerald-400/10',
  completed: 'text-glacier-300 bg-glacier-400/10',
  cancelled: 'text-rose-300 bg-rose-400/10',
  payment_failed: 'text-rose-300 bg-rose-400/10',
  pending: 'text-amberz-300 bg-amberz-400/10',
  approved: 'text-emerald-300 bg-emerald-400/10',
  rejected: 'text-rose-300 bg-rose-400/10',
}

function Pill({ value }) {
  const t = useT()
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[value] || 'bg-white/[.05] text-frost-300'}`}>{t(value.replace(/_/g, ' '))}</span>
}

/** Loads a list with loading / error / ready states and a retry. */
function useList(fetcher) {
  const [state, setState] = useState({ status: 'loading', items: [] })
  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    fetcher().then((r) => setState({ status: 'ok', items: r.items || [], extra: r }))
      .catch((e) => setState({ status: 'error', items: [], error: e.message }))
  }, [fetcher])
  useEffect(() => { load() }, [load])
  return [state, load]
}

function ListState({ state, retry, empty, children }) {
  if (state.status === 'loading') return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  if (state.status === 'error') return <ErrorState title="Couldn't load this" message={state.error} onRetry={retry} />
  if (!state.items.length) return <div className="glass rounded-2xl p-10 text-center text-[13.5px] text-frost-400">{empty}</div>
  return children
}

/* ---------------------------------------------------------- review form */
function StarInput({ value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)} className="p-0.5 transition hover:scale-110">
          <Star className={`h-6 w-6 ${n <= value ? 'fill-amberz-400 text-amberz-400' : 'text-frost-400'}`} />
        </button>
      ))}
    </div>
  )
}

function ReviewModal({ booking, onClose, onDone }) {
  const t = useT()
  const toast = useToast()
  const [rating, setRating] = useState(0)
  const [guide, setGuide] = useState(0)
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const add = async (files) => {
    const list = [...files].slice(0, 4 - photos.length)
    setUploading((n) => n + list.length)
    for (const f of list) {
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error(`${f.name}: use JPEG, PNG or WebP`)
        if (f.size > 3 * 1024 * 1024) throw new Error(`${f.name} is over 3 MB`)
        const r = await api.uploadPhoto(f)
        setPhotos((p) => [...p, r.url].slice(0, 4))
      } catch (e) { toast(e.message, 'bad') } finally { setUploading((n) => n - 1) }
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!rating) { setError(t('Choose a star rating for the trip')); return }
    setBusy(true); setError('')
    try {
      const r = await api.addReview({ booking_id: booking.id, rating, guide_rating: guide || null, text, photos })
      toast(r.note || 'Review submitted')
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={`${t('Review')}: ${booking.package?.title || booking.package_id}`}>
      <form onSubmit={submit} className="space-y-5 p-5">
        <div><div className="label">{t('The trip')}</div><StarInput value={rating} onChange={setRating} label="Trip rating" /></div>
        <div><div className="label">{t('Your guide / operator')}</div><StarInput value={guide} onChange={setGuide} label="Guide rating" /></div>
        <Field label={t('What was it like?')} htmlFor="rv-text" hint={`${text.length}/1500`}>
          <textarea id="rv-text" rows={4} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} className="field resize-none" />
        </Field>
        <div>
          <div className="label">{t('Photos (up to 4)')}</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((u) => (
              <div key={u} className="relative h-16 w-20 overflow-hidden rounded-lg">
                <img src={assetUrl(u)} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((x) => x !== u))} aria-label="Remove photo"
                  className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-abyss/70 text-snow"><X className="h-3 w-3" /></button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => <Skeleton key={i} className="h-16 w-20" />)}
            {photos.length + uploading < 4 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="grid h-16 w-20 place-items-center rounded-lg border border-dashed border-white/15 text-frost-400 hover:text-glacier-300">
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                 onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        </div>
        {error && <p role="alert" className="text-[12.5px] text-rose-300">{error}</p>}
        <button type="submit" disabled={busy || uploading > 0} className="btn-primary w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Submit review')}
        </button>
        <p className="text-center text-[11px] text-frost-400">{t('Reviews appear on the package once an admin approves them.')}</p>
      </form>
    </Modal>
  )
}

/* --------------------------------------------------------------- tabs */
function Bookings() {
  const t = useT()
  const [state, load] = useList(api.myBookings)
  const [reviewing, setReviewing] = useState(null)
  return (
    <ListState state={state} retry={load} empty={<>{t('No bookings yet.')} <Link to="/explore" className="text-glacier-300">{t('Browse packages')}</Link></>}>
      <div className="space-y-3">
        {state.items.map((b) => (
          <div key={b.id} className="glass flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center">
            {b.package && <PlacePhoto query={b.package.photo_query || b.package.destination} name={b.package.destination} images={b.package.images} count={1} className="h-20 w-full shrink-0 rounded-xl sm:w-28" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/explore/${b.package_id}`} className="truncate text-[14.5px] font-semibold text-frost-50 hover:text-glacier-300">{b.package?.title || b.package_id}</Link>
                <Pill value={b.status} />
              </div>
              <div className="mt-1 text-[12px] text-frost-400">
                <span className="font-mono">{b.id}</span> · {b.start_date || t('date to confirm')} · {b.travelers} {t('travelers')} · {pkr(b.total_pkr)}
              </div>
              {b.condition_warnings?.length > 0 && <div className="mt-1.5 text-[11.5px] text-amberz-300">⚠ {b.condition_warnings[0]}</div>}
            </div>
            <div className="flex shrink-0 gap-2">
              {b.can_review && <button onClick={() => setReviewing(b)} className="btn-primary !px-3 !py-2 !text-[12px]"><Star className="h-3.5 w-3.5" /> {t('Write a review')}</button>}
              {b.review && <Pill value={b.review.status} />}
            </div>
          </div>
        ))}
      </div>
      {reviewing && <ReviewModal booking={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load() }} />}
    </ListState>
  )
}

function Wishlist() {
  const t = useT()
  const d = useData()
  const wish = useWishlist()
  const byId = Object.fromEntries((d.packages || []).map((p) => [p.id, p]))
  const saved = wish.ids.map((id) => byId[id]).filter(Boolean)
  if (!d.ready) return <Skeleton className="h-64 rounded-2xl" />
  if (!saved.length) return <div className="glass rounded-2xl p-10 text-center text-[13.5px] text-frost-400">{t('Nothing saved yet. Tap the heart on any package.')}</div>
  return (
    <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {saved.map((p, i) => <PackageCard key={p.id} pkg={p} index={i} />)}
    </Stagger>
  )
}

function Plans() {
  const t = useT()
  const toast = useToast()
  const [state, load] = useList(api.myPlans)
  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.title}"?`)) return
    try { await api.deletePlan(p.id); toast('Plan deleted'); load() } catch (e) { toast(e.message, 'bad') }
  }
  return (
    <ListState state={state} retry={load} empty={<>{t('No saved plans.')} <Link to="/plan?mode=ai" className="text-glacier-300">{t('Plan a trip with AI')}</Link></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {state.items.map((p) => (
          <div key={p.id} className="glass rounded-2xl p-5">
            <div className="text-[14.5px] font-semibold text-frost-50">{p.title}</div>
            <div className="mt-1 text-[12px] text-frost-400">
              {p.plan?.days?.length} {t('days')} · {p.plan?.costs ? pkr(p.plan.costs.total_pkr) : ''} · {t('updated')} {relTime(p.updated_at)}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to={`/plan?mode=ai&plan=${p.id}`} className="btn-ghost !px-3 !py-2 !text-[12px]">{t('Open & edit')}</Link>
              <button onClick={() => downloadPlanPdf(p.plan).catch((e) => toast('PDF failed: ' + e.message, 'bad'))} className="btn-ghost !px-3 !py-2 !text-[12px]">
                <Download className="h-3.5 w-3.5" /> PDF
              </button>
              <button onClick={() => remove(p)} aria-label={`Delete ${p.title}`} className="btn-ghost !px-3 !py-2 !text-[12px] hover:!text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </ListState>
  )
}

function Reviews() {
  const t = useT()
  const [state, load] = useList(api.myReviews)
  return (
    <ListState state={state} retry={load} empty={t('You have not reviewed a trip yet. Completed trips appear under My bookings.')}>
      <div className="space-y-3">
        {state.items.map((r) => (
          <div key={r.id} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${n <= r.rating ? 'fill-amberz-400 text-amberz-400' : 'text-frost-400'}`} />)}</span>
              <Pill value={r.status} />
            </div>
            {r.text && <p className="mt-2 text-[13.5px] text-frost-200">{r.text}</p>}
            <div className="mt-1 text-[11.5px] text-frost-400">{r.package_id} · {relTime(r.created_at)}</div>
          </div>
        ))}
      </div>
    </ListState>
  )
}

function Alerts() {
  const t = useT()
  const [state, load] = useList(api.notifications)
  useEffect(() => { if (state.status === 'ok' && state.extra?.unread) api.readNotifications().catch(() => {}) }, [state])
  return (
    <ListState state={state} retry={load} empty={t('No alerts. If a road on a booked trip closes, heavy weather is forecast or an earthquake strikes nearby, it appears here.')}>
      <div className="space-y-2.5">
        {state.items.map((n) => (
          <div key={n.id} className={`glass flex items-start gap-3 rounded-2xl p-4 ${n.read ? '' : 'ring-1 ring-glacier-400/25'}`}>
            <BellRing className={`mt-0.5 h-4 w-4 shrink-0 ${n.kind === 'earthquake' || n.kind === 'road' ? 'text-rose-300' : 'text-amberz-300'}`} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-frost-50">{n.title}</div>
              <p className="mt-0.5 text-[12.5px] text-frost-300">{n.body}</p>
              <div className="mt-1 text-[11px] text-frost-400">{relTime(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </ListState>
  )
}

function Settings() {
  const auth = useAuth()
  const t = useT()
  const toast = useToast()
  const p = auth.profile || {}
  const [name, setName] = useState(p.name || '')
  const [ecName, setEcName] = useState(p.emergency_contact?.name || '')
  const [ecPhone, setEcPhone] = useState(p.emergency_contact?.phone || '')
  const [notifyEmail, setNotifyEmail] = useState(p.notify_email !== false)
  const [notifyPush, setNotifyPush] = useState(p.notify_push !== false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    const errs = {}
    if (ecPhone.trim() && !/^\+?[0-9][0-9\s-]{8,17}$/.test(ecPhone.trim())) errs['emergency_contact.phone'] = t('Enter a phone number like +92 300 1234567')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const updated = await api.updateMe({ name, emergency_contact: { name: ecName, phone: ecPhone }, notify_email: notifyEmail, notify_push: notifyPush })
      auth.setProfile(updated)
      // Keep a copy on this device so the SOS page works without signal.
      try { localStorage.setItem('nt-emergency', JSON.stringify(updated.emergency_contact)) } catch { /* ignore */ }
      toast('Saved')
    } catch (err) {
      if (err.fields) setErrors(err.fields)
      toast(err.message, 'bad')
    } finally { setBusy(false) }
  }

  const enablePush = async () => {
    setPushBusy(true)
    try {
      const ok = await auth.enablePush()
      toast(ok ? 'Alerts will pop up on this device' : 'Notifications are blocked in this browser — allow them in site settings', ok ? 'ok' : 'warn')
    } catch (e) { toast(e.message, 'bad') } finally { setPushBusy(false) }
  }

  return (
    <form onSubmit={save} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="glass space-y-4 rounded-2xl p-5">
        <h3 className="text-[14px] font-semibold text-frost-50">{t('Your details')}</h3>
        <Field label={t('Name')} htmlFor="pf-name">
          <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="field" />
        </Field>
        <div className="grid gap-1 text-[12.5px] text-frost-300">
          {p.email && <div>{t('Email')}: <span className="text-frost-100">{p.email}</span> {p.email_verified
            ? <span className="text-emerald-300">✓ {t('verified')}</span>
            : <button type="button" onClick={() => auth.resendVerification().then(() => toast('Verification email sent'))} className="text-glacier-300 underline">{t('verify')}</button>}</div>}
          {p.phone && <div>{t('Phone')}: <span className="text-frost-100">{p.phone}</span></div>}
          <div>{t('Account type')}: <span className="font-semibold text-glacier-300">{t(p.role || 'tourist')}</span></div>
        </div>
      </div>
      <div className="glass space-y-4 rounded-2xl p-5">
        <h3 className="text-[14px] font-semibold text-frost-50">{t('Emergency contact')}</h3>
        <p className="text-[12px] text-frost-400">{t('The SOS page shares your live location with this person on WhatsApp.')}</p>
        <Field label={t('Name')} htmlFor="pf-ecn"><input id="pf-ecn" value={ecName} onChange={(e) => setEcName(e.target.value)} maxLength={80} className="field" /></Field>
        <Field label={t('WhatsApp number')} htmlFor="pf-ecp" error={errors['emergency_contact.phone']}>
          <input id="pf-ecp" type="tel" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} className={fieldClass(errors['emergency_contact.phone'])} placeholder="+92 300 1234567" />
        </Field>
      </div>
      <div className="glass space-y-3 rounded-2xl p-5 lg:col-span-2">
        <h3 className="text-[14px] font-semibold text-frost-50">{t('Smart alerts')}</h3>
        <p className="text-[12.5px] text-frost-400">{t('For trips you have booked: road closures, heavy rain or snow in the forecast, and earthquakes above magnitude 4.5 nearby. Checked every few hours.')}</p>
        <label className="flex items-center gap-2.5 text-[13px] text-frost-200"><input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} className="h-4 w-4 accent-[#6CC4C0]" /> {t('Browser push notifications')}</label>
        <label className="flex items-center gap-2.5 text-[13px] text-frost-200"><input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4 accent-[#6CC4C0]" /> <MailCheck className="h-4 w-4 text-frost-400" /> {t('Email')}</label>
        <button type="button" onClick={enablePush} disabled={pushBusy} className="btn-ghost !py-2 !text-[12.5px]">
          {pushBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />} {t('Allow notifications on this device')}
        </button>
      </div>
      <div className="lg:col-span-2">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('Save changes')}</button>
      </div>
    </form>
  )
}

export default function Profile() {
  const t = useT()
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'bookings'
  const Body = { bookings: Bookings, wishlist: Wishlist, plans: Plans, reviews: Reviews, alerts: Alerts, settings: Settings }[tab]

  return (
    <Guard reason="Sign in to see your bookings, wishlist and trip plans">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-14 sm:px-8">
        <Reveal>
          <div className="mb-8 flex items-center gap-4">
            <Avatar name={auth.displayName} photo={auth.photoURL} size="h-14 w-14" />
            <div>
              <h1 className="text-2xl font-semibold text-frost-50 sm:text-3xl">{auth.displayName}</h1>
              <div className="text-[12px] uppercase tracking-[.16em] text-glacier-300">{t(auth.role)}</div>
            </div>
          </div>
        </Reveal>
        <div className="mb-6 flex gap-1 overflow-x-auto no-scrollbar" role="tablist">
          {TABS.map(([id, Icon, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition
                ${tab === id ? 'text-frost-50' : 'text-frost-400 hover:text-frost-200'}`}>
              {tab === id && <motion.span layoutId="profile-tab" className="absolute inset-0 rounded-lg bg-white/[.06]" transition={{ duration: 0.4, ease }} />}
              <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {t(label)}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease }}>
            <Body />
          </motion.div>
        </AnimatePresence>
      </div>
    </Guard>
  )
}
