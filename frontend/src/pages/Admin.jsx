import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3, Building2, CalendarCheck, Check, Loader2, MessageSquare, Package as PackageIcon, Pencil,
  Plus, Route as RouteIcon, Star, Trash2, Users, X,
} from 'lucide-react'

import { STATUS, api, pkr, relTime } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import Guard from '../components/Guard'
import PlacePhoto from '../components/PlacePhoto'
import { PackageForm } from '../components/PackageForm'
import { BarChart, RankBars } from '../components/charts'
import { CountUp, ErrorState, Reveal, SectionTitle, Skeleton, ease, useToast } from '../components/ui'

/*
 * Admin dashboard. Admins see everything; an operator account sees the
 * packages and bookings of its own operator, and can update road status.
 * Every action here is enforced again by the API.
 */
const TABS = [
  { id: 'overview', label: 'Overview', Icon: BarChart3, admin: true },
  { id: 'packages', label: 'Packages', Icon: PackageIcon },
  { id: 'bookings', label: 'Bookings', Icon: CalendarCheck },
  { id: 'reviews', label: 'Reviews', Icon: MessageSquare, admin: true },
  { id: 'roads', label: 'Road status', Icon: RouteIcon },
  { id: 'users', label: 'Users', Icon: Users, admin: true },
  { id: 'operators', label: 'Operators & guides', Icon: Building2, admin: true },
]

function useLoad(fetcher) {
  const [state, setState] = useState({ status: 'loading' })
  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    fetcher().then((data) => setState({ status: 'ok', data })).catch((e) => setState({ status: 'error', error: e.message }))
  }, [fetcher])
  useEffect(() => { load() }, [load])
  return [state, load]
}

function Loading() { return <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div> }

/* --------------------------------------------------------------- overview */
function Overview() {
  const t = useT()
  const [state, load] = useLoad(api.adminStats)
  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') return <ErrorState title="Couldn't load statistics" message={state.error} onRetry={load} />
  const s = state.data
  const months = s.per_month.map((m) => ({ label: m.month, short: new Date(m.month + '-01').toLocaleString(undefined, { month: 'short' }), value: m.bookings, revenue: m.revenue_pkr }))
  const tiles = [
    [t('Bookings'), s.totals.bookings, ''],
    [t('Revenue (confirmed)'), s.totals.revenue_pkr, 'PKR'],
    [t('Active users'), s.totals.active_users, ''],
    [t('Pending reviews'), s.totals.pending_reviews, ''],
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, unit]) => (
          <div key={label} className="glass rounded-2xl p-5">
            <div className="text-[11px] uppercase tracking-[.14em] text-frost-400">{label}</div>
            <div className="mt-2 font-mono text-2xl font-semibold text-frost-50">{unit && <span className="me-1 text-[13px] text-frost-400">{unit}</span>}<CountUp to={value} /></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-4 text-[13px] font-semibold text-frost-50">{t('Bookings per month')}</h3>
          <BarChart data={months} format={(v) => `${v} ${t('bookings')}`} />
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-4 text-[13px] font-semibold text-frost-50">{t('Revenue per month')}</h3>
          <BarChart data={months.map((m) => ({ ...m, value: m.revenue }))} format={pkr} color="var(--series-4)" emptyText={t('No confirmed bookings yet')} />
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-4 text-[13px] font-semibold text-frost-50">{t('Popular destinations')}</h3>
          <RankBars data={s.popular_destinations.map((d) => ({ label: d.destination, value: d.bookings }))} format={(v) => `${v}`} />
        </div>
        <div className="glass rounded-2xl p-5">
          <h3 className="mb-4 text-[13px] font-semibold text-frost-50">{t('Approved review ratings')}</h3>
          <BarChart data={s.ratings.map((r) => ({ label: `${r.stars} ★`, value: r.count }))} format={(v) => `${v} ${t('reviews')}`} height={160} emptyText={t('No approved reviews yet')} />
        </div>
      </div>
      <p className="text-[11.5px] text-frost-400">{t('Users by role')}: {Object.entries(s.roles).map(([k, v]) => `${t(k)} ${v}`).join(' · ') || '—'}</p>
    </div>
  )
}

/* --------------------------------------------------------------- packages */
function Packages() {
  const t = useT()
  const d = useData()
  const auth = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [deleting, setDeleting] = useState('')
  const mine = auth.role === 'operator' ? auth.profile?.operator_id : null
  const packages = useMemo(() => [...(d.packages || [])]
    .filter((p) => !mine || p.operator_id === mine)
    .sort((a, b) => (a.source === 'admin' ? 0 : 1) - (b.source === 'admin' ? 0 : 1) || a.title.localeCompare(b.title)), [d.packages, mine])

  const saved = () => { setEditing(null); setFormKey((k) => k + 1); d.refresh?.(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const remove = async (p) => {
    if (!window.confirm(`Delete “${p.title}”? This cannot be undone.`)) return
    setDeleting(p.id)
    try { await api.deletePackage(p.id); toast('Package deleted'); if (editing?.id === p.id) setEditing(null); d.refresh?.() }
    catch (e) { toast(e.message, 'bad') } finally { setDeleting('') }
  }

  if (auth.role === 'operator' && !mine) {
    return <ErrorState title={t('Your account is not linked to an operator yet')} message={t('Ask an admin to link it, then you can add packages.')} />
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <PackageForm key={editing ? editing.id : `new-${formKey}`} editing={editing} lockOperator={mine}
                   onSaved={saved} onCancel={() => setEditing(null)} />
      <div className="glass h-fit rounded-2xl p-4 lg:sticky lg:top-24">
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">{packages.length} {t('packages')}</h3>
          {editing && <button onClick={() => setEditing(null)} className="flex items-center gap-1 text-[12px] font-semibold text-glacier-300"><Plus className="h-3.5 w-3.5" /> {t('New')}</button>}
        </div>
        <ul className="max-h-[70vh] space-y-2 overflow-y-auto no-scrollbar">
          <AnimatePresence initial={false}>
            {packages.map((p) => (
              <motion.li key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease }}
                className={`flex items-center gap-3 rounded-xl p-2 transition ${editing?.id === p.id ? 'bg-glacier-400/10 ring-1 ring-glacier-400/30' : 'hover:bg-white/[.04]'}`}>
                <PlacePhoto query={p.photo_query || p.destination} name={p.destination} images={p.images} count={1} className="h-12 w-16 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-frost-50">{p.title}</div>
                  <div className="text-[11px] text-frost-400">{p.destination} · {p.days}d · {pkr(p.price_pkr)}</div>
                </div>
                <button onClick={() => { setEditing(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} aria-label={`Edit ${p.title}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-frost-300 hover:bg-white/10 hover:text-frost-50"><Pencil className="h-3.5 w-3.5" /></button>
                {p.source === 'admin' && (
                  <button onClick={() => remove(p)} disabled={deleting === p.id} aria-label={`Delete ${p.title}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-frost-300 hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-40">
                    {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- bookings */
const BOOKING_STATES = ['pending_payment', 'confirmed', 'completed', 'cancelled']

function Bookings() {
  const t = useT()
  const toast = useToast()
  const [state, load] = useLoad(api.adminBookings)
  const [busy, setBusy] = useState('')
  const change = async (b, status) => {
    setBusy(b.id)
    try { await api.setBookingStatus(b.id, status); toast(`${b.id}: ${t(status.replace('_', ' '))}`); load() }
    catch (e) { toast(e.message, 'bad') } finally { setBusy('') }
  }
  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') return <ErrorState title="Couldn't load bookings" message={state.error} onRetry={load} />
  const items = state.data.items
  if (!items.length) return <div className="glass rounded-2xl p-10 text-center text-[13.5px] text-frost-400">{t('No bookings yet.')}</div>
  return (
    <div className="glass overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-white/[.06] text-start text-[10.5px] uppercase tracking-[.14em] text-frost-400">
            {['Booking', 'Package', 'Traveler', 'Start', 'Total', 'Status'].map((h) => <th key={h} className="px-4 py-3 text-start font-semibold">{t(h)}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.id} className="border-b border-white/[.04] last:border-0">
              <td className="px-4 py-3 font-mono text-[12px] text-frost-200">{b.id}<div className="text-[10.5px] text-frost-400">{relTime(b.created_at)}</div></td>
              <td className="px-4 py-3 text-frost-100">{b.package_title}</td>
              <td className="px-4 py-3 text-frost-200">{b.traveler_name}<div className="text-[11px] text-frost-400">{b.phone || b.email} · {b.travelers} pax</div></td>
              <td className="px-4 py-3 text-frost-300">{b.start_date || '—'}</td>
              <td className="px-4 py-3 font-mono text-frost-50">{pkr(b.total_pkr)}</td>
              <td className="px-4 py-3">
                <select value={b.status} disabled={busy === b.id} onChange={(e) => change(b, e.target.value)} aria-label={`Status of ${b.id}`}
                  className="field !w-auto !py-1.5 !text-[12px]">
                  {[...new Set([b.status, ...BOOKING_STATES])].map((s) => <option key={s} value={s}>{t(s.replace('_', ' '))}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------------------------------------------------------- reviews */
function Reviews() {
  const t = useT()
  const toast = useToast()
  const [filter, setFilter] = useState('pending')
  const fetcher = useCallback(() => api.adminReviews(filter), [filter])
  const [state, load] = useLoad(fetcher)
  const moderate = async (r, status) => {
    try { await api.moderateReview(r.id, status); toast(status === 'approved' ? 'Review approved and published' : 'Review rejected'); load() }
    catch (e) { toast(e.message, 'bad') }
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {['pending', 'approved', 'rejected'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip ${filter === f ? '!border-glacier-400/40 !bg-glacier-400/15 !text-glacier-200' : ''}`}>{t(f)}</button>
        ))}
      </div>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorState title="Couldn't load reviews" message={state.error} onRetry={load} />}
      {state.status === 'ok' && (state.data.items.length === 0
        ? <div className="glass rounded-2xl p-10 text-center text-[13.5px] text-frost-400">{t('Nothing here.')}</div>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.data.items.map((r) => (
              <div key={r.id} className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-frost-50">{r.author}</span>
                  <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-3.5 w-3.5 ${n <= r.rating ? 'fill-amberz-400 text-amberz-400' : 'text-frost-400'}`} />)}</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-frost-400">{r.package_id}{r.guide_rating ? ` · guide ${r.guide_rating}★` : ''} · {relTime(r.created_at)}</div>
                {r.text && <p className="mt-2 text-[13px] text-frost-200">{r.text}</p>}
                {r.photos?.length > 0 && <div className="mt-2 flex gap-2">{r.photos.map((u) => <img key={u} src={u.startsWith('/api/') ? (import.meta.env.VITE_API_BASE || '') + u : u} alt="" className="h-14 w-20 rounded-lg object-cover" />)}</div>}
                {r.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => moderate(r, 'approved')} className="btn-primary !px-3 !py-1.5 !text-[12px]"><Check className="h-3.5 w-3.5" /> {t('Approve')}</button>
                    <button onClick={() => moderate(r, 'rejected')} className="btn-ghost !px-3 !py-1.5 !text-[12px]"><X className="h-3.5 w-3.5" /> {t('Reject')}</button>
                  </div>
                )}
                {r.status !== 'pending' && (
                  <button onClick={() => moderate(r, r.status === 'approved' ? 'rejected' : 'approved')} className="mt-3 text-[12px] text-glacier-300 underline-offset-4 hover:underline">
                    {r.status === 'approved' ? t('Unpublish') : t('Approve instead')}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

/* ------------------------------------------------------------------ roads */
function Roads() {
  const t = useT()
  const d = useData()
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <ul className="divide-y divide-white/[.05]">
        {(d.routes || []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS[r.status]?.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-frost-50">{r.name}</div>
              <div className="text-[11.5px] text-frost-400">{STATUS[r.status]?.label} · {t('updated')} {relTime(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/[.06] p-4">
        <Link to="/conditions" className="btn-primary !py-2 !text-[13px]">{t('Update statuses on the Conditions page')}</Link>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ users */
function UsersTab() {
  const t = useT()
  const d = useData()
  const auth = useAuth()
  const toast = useToast()
  const [state, load] = useLoad(api.adminUsers)
  const [busy, setBusy] = useState('')
  const change = async (u, role, operatorId = u.operator_id) => {
    if (role === 'operator' && !operatorId) operatorId = d.operators?.[0]?.id || ''
    setBusy(u.uid)
    try { await api.setRole(u.uid, role, operatorId); toast(`${u.name || u.email || u.phone}: ${t(role)}`); load() }
    catch (e) { toast(e.message, 'bad') } finally { setBusy('') }
  }
  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') return <ErrorState title="Couldn't load users" message={state.error} onRetry={load} />
  const items = state.data.items
  if (!items.length) return <div className="glass rounded-2xl p-10 text-center text-[13.5px] text-frost-400">{t('No users yet.')}</div>
  return (
    <div className="glass overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead><tr className="border-b border-white/[.06] text-[10.5px] uppercase tracking-[.14em] text-frost-400">
          {['User', 'Joined', 'Role', 'Operator'].map((h) => <th key={h} className="px-4 py-3 text-start font-semibold">{t(h)}</th>)}
        </tr></thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.uid} className="border-b border-white/[.04] last:border-0">
              <td className="px-4 py-3"><div className="font-semibold text-frost-50">{u.name || '—'}</div><div className="text-[11.5px] text-frost-400">{u.email || u.phone}</div></td>
              <td className="px-4 py-3 text-frost-300">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-3">
                <select value={u.role} disabled={busy === u.uid || u.uid === auth.uid} onChange={(e) => change(u, e.target.value)} aria-label="Role" className="field !w-auto !py-1.5 !text-[12px]">
                  {['tourist', 'operator', 'admin'].map((r) => <option key={r} value={r}>{t(r)}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">
                {u.role === 'operator' ? (
                  <select value={u.operator_id} disabled={busy === u.uid} onChange={(e) => change(u, 'operator', e.target.value)} aria-label="Operator" className="field !w-auto !py-1.5 !text-[12px]">
                    {(d.operators || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : <span className="text-frost-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------- operators */
function Operators() {
  const t = useT()
  const d = useData()
  const toast = useToast()
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.editOperator(edit.id, { name: edit.name, base: edit.base, verified: edit.verified,
        languages: edit.languages.split(',').map((x) => x.trim()).filter(Boolean),
        vehicles: edit.vehicles.split(',').map((x) => x.trim()).filter(Boolean) })
      toast('Operator saved'); setEdit(null); d.refresh?.()
    } catch (err) { toast(err.message, 'bad') } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(d.operators || []).map((o) => (
        <div key={o.id} className="glass rounded-2xl p-4">
          {edit?.id === o.id ? (
            <form onSubmit={save} className="space-y-2.5">
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="field !py-2" aria-label="Name" />
              <input value={edit.base} onChange={(e) => setEdit({ ...edit, base: e.target.value })} className="field !py-2" aria-label="Base" />
              <input value={edit.languages} onChange={(e) => setEdit({ ...edit, languages: e.target.value })} className="field !py-2" aria-label="Languages" placeholder="Languages, comma separated" />
              <input value={edit.vehicles} onChange={(e) => setEdit({ ...edit, vehicles: e.target.value })} className="field !py-2" aria-label="Vehicles" placeholder="Vehicles, comma separated" />
              <label className="flex items-center gap-2 text-[13px] text-frost-200"><input type="checkbox" checked={edit.verified} onChange={(e) => setEdit({ ...edit, verified: e.target.checked })} className="accent-[#6CC4C0]" /> {t('Verified')}</label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="btn-primary !px-3 !py-1.5 !text-[12px]">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('Save')}</button>
                <button type="button" onClick={() => setEdit(null)} className="btn-ghost !px-3 !py-1.5 !text-[12px]">{t('Cancel')}</button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold text-frost-50">{o.name}</div>
                <button onClick={() => setEdit({ ...o, languages: o.languages.join(', '), vehicles: o.vehicles.join(', ') })} aria-label={`Edit ${o.name}`}
                  className="grid h-8 w-8 place-items-center rounded-lg text-frost-300 hover:bg-white/10"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
              <div className="mt-1 text-[12px] text-frost-400">{o.base} · ★ {o.rating} · {o.trips} {t('trips')} · {o.verified ? t('verified') : t('not verified')}</div>
              <div className="mt-1 text-[11.5px] text-frost-400">{o.languages.join(' · ')}</div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Admin() {
  const t = useT()
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const tabs = TABS.filter((x) => !x.admin || auth.isAdmin)
  const tab = tabs.some((x) => x.id === params.get('tab')) ? params.get('tab') : tabs[0]?.id
  const Body = { overview: Overview, packages: Packages, bookings: Bookings, reviews: Reviews, roads: Roads, users: UsersTab, operators: Operators }[tab]

  return (
    <Guard role="operator" reason="Sign in with an operator or admin account">
      <div className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8">
        <Reveal>
          <SectionTitle eyebrow={auth.isAdmin ? 'Admin dashboard' : 'Operator dashboard'}
            title={auth.isAdmin ? t('Run Northern Trails.') : t('Manage your trips.')}
            sub={auth.isAdmin ? t('Bookings, revenue and ratings at a glance; packages, reviews, road status, users and operators in one place.')
                              : t('Your packages and bookings, and the road status you report from the ground.')} />
        </Reveal>
        <div className="mb-6 flex gap-1 overflow-x-auto no-scrollbar" role="tablist">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition ${tab === id ? 'text-frost-50' : 'text-frost-400 hover:text-frost-200'}`}>
              {tab === id && <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-lg bg-white/[.06]" transition={{ duration: 0.4, ease }} />}
              <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {t(label)}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease }}>
            {Body && <Body />}
          </motion.div>
        </AnimatePresence>
      </div>
    </Guard>
  )
}
