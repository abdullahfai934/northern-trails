import React, { useRef, useState } from 'react'
import { ImagePlus, Link2, Loader2, Save, X } from 'lucide-react'

import { api, assetUrl, pkr } from '../lib/api'
import { useData } from '../lib/store'
import { Field, Skeleton, fieldClass, useToast } from './ui'

const DIFFICULTY = ['Easy', 'Moderate', 'Challenging', 'Expedition']
const PICKUPS = ['Islamabad', 'Lahore', 'Peshawar', 'Gilgit', 'Skardu', 'Chilas', 'Chitral']
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i
const MAX_IMAGES = 8

const blankDay = () => ({ title: '', body: '' })
const EMPTY = {
  title: '', destination: '', operator_id: '', pickup: 'Islamabad', price_pkr: '', days: 3,
  highlight: '', difficulty: 'Moderate', group_size: '2-12', tags: '', includes: '', excludes: '',
  itinerary: [blankDay(), blankDay(), blankDay()], operator_url: '', whatsapp: '', images: [],
}

const lines = (text) => text.split('\n').map((x) => x.trim()).filter(Boolean)

function fromPackage(p) {
  return {
    title: p.title, destination: p.destination, operator_id: p.operator_id, pickup: p.pickup,
    price_pkr: String(p.price_pkr), days: p.days, highlight: p.highlight || '',
    difficulty: p.difficulty, group_size: p.group_size, tags: (p.tags || []).join(', '),
    includes: (p.includes || []).join('\n'), excludes: (p.excludes || []).join('\n'),
    itinerary: (p.itinerary || []).map(([, title, body]) => ({ title, body: body || '' })),
    operator_url: p.operator_url || '', whatsapp: p.whatsapp ? `+${p.whatsapp}` : '', images: p.images || [],
  }
}

/** Client-side checks, in step with PackageIn in backend/app/admin.py. */
function validate(f) {
  const e = {}
  if (f.title.trim().length < 4) e.title = 'At least 4 characters'
  if (!f.destination) e.destination = 'Pick a destination'
  if (!f.operator_id) e.operator_id = 'Pick the operator running this trip'
  const price = Number(f.price_pkr)
  if (!Number.isInteger(price) || price < 1000 || price > 5000000) e.price_pkr = 'Between PKR 1,000 and 5,000,000'
  const days = Number(f.days)
  if (!Number.isInteger(days) || days < 1 || days > 30) e.days = 'Between 1 and 30 days'
  f.itinerary.forEach((d, i) => { if (d.title.trim().length < 2) e[`itinerary.${i}.title`] = `Give day ${i + 1} a title` })
  if (f.operator_url.trim() && !URL_RE.test(f.operator_url.trim())) e.operator_url = 'A full address starting with https://'
  const digits = f.whatsapp.replace(/\D/g, '')
  if (digits && (digits.length < 10 || digits.length > 15)) e.whatsapp = 'Number with country code, e.g. +92 300 1234567'
  if (f.highlight.length > 160) e.highlight = 'Keep it under 160 characters'
  return e
}

function toBody(f) {
  return {
    title: f.title.trim(), destination: f.destination, operator_id: f.operator_id, pickup: f.pickup,
    price_pkr: Number(f.price_pkr), days: Number(f.days), highlight: f.highlight.trim(),
    difficulty: f.difficulty, group_size: f.group_size.trim() || '2-12',
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
    includes: lines(f.includes), excludes: lines(f.excludes),
    itinerary: f.itinerary.map((d) => ({ title: d.title.trim(), body: d.body.trim() })),
    operator_url: f.operator_url.trim(), whatsapp: f.whatsapp.trim(), images: f.images,
  }
}

/** Downscale to at most 1600 px on the long side and re-encode as JPEG. */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error(`${file.name}: use JPEG, PNG or WebP`)); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error(`${file.name}: could not read the image`)); return }
        resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: not a readable image`)) }
    img.src = url
  })
}

/* ================================================================ form */
function PackageForm({ editing, onSaved, onCancel, lockOperator }) {
  const d = useData()
  const toast = useToast()
  const [f, setF] = useState(() => (editing ? fromPackage(editing) : { ...EMPTY, operator_id: lockOperator || '', itinerary: EMPTY.itinerary.map(blankDay) }))
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [imgUrl, setImgUrl] = useState('')
  const fileRef = useRef(null)

  const update = (patch) => {
    const next = { ...f, ...patch }
    setF(next)
    if (submitted) setErrors(validate(next))
  }
  const set = (k) => (e) => update({ [k]: e.target.value })

  // The itinerary always has one row per day.
  const setDays = (e) => {
    const raw = e.target.value
    const n = Math.max(0, Math.min(30, parseInt(raw, 10) || 0))
    const itinerary = n ? [...f.itinerary.slice(0, n), ...Array.from({ length: Math.max(0, n - f.itinerary.length) }, blankDay)] : f.itinerary
    update({ days: raw === '' ? '' : n, itinerary })
  }
  const setDay = (i, k) => (e) => update({ itinerary: f.itinerary.map((d0, j) => (j === i ? { ...d0, [k]: e.target.value } : d0)) })

  const addFiles = async (files) => {
    const room = MAX_IMAGES - f.images.length
    const list = [...files].slice(0, room)
    if (!list.length) { toast(`Up to ${MAX_IMAGES} images per package`, 'warn'); return }
    setUploading((n) => n + list.length)
    const urls = []
    for (const file of list) {
      try {
        const small = await resizeImage(file)
        const res = await api.uploadPhoto(small)
        urls.push(res.url)
      } catch (e) {
        toast(e.message, 'bad')
      } finally { setUploading((n) => n - 1) }
    }
    if (urls.length) setF((cur) => ({ ...cur, images: [...cur.images, ...urls].slice(0, MAX_IMAGES) }))
  }

  const addUrl = () => {
    const u = imgUrl.trim()
    if (!URL_RE.test(u)) { toast('Paste a full image address starting with https://', 'warn'); return }
    if (f.images.length >= MAX_IMAGES) { toast(`Up to ${MAX_IMAGES} images per package`, 'warn'); return }
    update({ images: [...f.images, u] })
    setImgUrl('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setSubmitted(true)
    const found = validate(f)
    setErrors(found)
    if (Object.keys(found).length) {
      toast('Some fields need attention', 'warn')
      document.querySelector('[data-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSaving(true)
    try {
      const body = toBody(f)
      const res = await api.savePackage(editing?.id, body)
      toast(res.persisted ? `Saved “${res.package.title}”` : 'Saved, but the server has no database, so it lasts until the next restart', res.persisted ? 'ok' : 'warn')
      onSaved(res.package)
    } catch (ex) {
      toast(ex.message, 'bad')
      if (ex.fields) setErrors(ex.fields)
    } finally { setSaving(false) }
  }

  const err = (k) => errors[k]
  const destinations = d.destinations || []
  const operators = d.operators || []

  return (
    <form onSubmit={submit} noValidate className="glass space-y-6 rounded-2xl p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-frost-50">{editing ? `Edit “${editing.title}”` : 'Add a package'}</h2>
        {editing && <button type="button" onClick={onCancel} className="btn-ghost !px-3 !py-2 !text-[12px]"><X className="h-3.5 w-3.5" /> Cancel</button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2" data-invalid={Boolean(err('title'))}>
          <Field label="Package name" htmlFor="pk-title" required error={err('title')}>
            <input id="pk-title" value={f.title} onChange={set('title')} maxLength={120} className={fieldClass(err('title'))} placeholder="Hunza Autumn Colours" />
          </Field>
        </div>
        <div data-invalid={Boolean(err('destination'))}>
          <Field label="Destination" htmlFor="pk-dest" required error={err('destination')}>
            <select id="pk-dest" value={f.destination} onChange={set('destination')} className={fieldClass(err('destination'))}>
              <option value="">Choose…</option>
              {destinations.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select>
          </Field>
        </div>
        <div data-invalid={Boolean(err('operator_id'))}>
          <Field label="Operator" htmlFor="pk-op" required error={err('operator_id')}>
            <select id="pk-op" value={f.operator_id} onChange={set('operator_id')} disabled={Boolean(lockOperator)} className={fieldClass(err('operator_id'))}>
              <option value="">Choose…</option>
              {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </div>
        <div data-invalid={Boolean(err('price_pkr'))}>
          <Field label="Price per person (PKR)" htmlFor="pk-price" required error={err('price_pkr')}
                 hint={f.price_pkr && !err('price_pkr') ? pkr(f.price_pkr) : undefined}>
            <input id="pk-price" type="number" inputMode="numeric" min="1000" step="500" value={f.price_pkr} onChange={set('price_pkr')}
                   className={fieldClass(err('price_pkr'))} placeholder="45000" />
          </Field>
        </div>
        <div data-invalid={Boolean(err('days'))}>
          <Field label="Duration (days)" htmlFor="pk-days" required error={err('days')}>
            <input id="pk-days" type="number" min="1" max="30" value={f.days} onChange={setDays} className={fieldClass(err('days'))} />
          </Field>
        </div>
        <Field label="Pickup" htmlFor="pk-pickup">
          <select id="pk-pickup" value={f.pickup} onChange={set('pickup')} className="field">
            {PICKUPS.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Difficulty" htmlFor="pk-diff">
          <select id="pk-diff" value={f.difficulty} onChange={set('difficulty')} className="field">
            {DIFFICULTY.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2" data-invalid={Boolean(err('highlight'))}>
          <Field label="Highlight line" htmlFor="pk-hl" error={err('highlight')} hint={`${f.highlight.length}/160, shown under the title on the card`}>
            <input id="pk-hl" value={f.highlight} onChange={set('highlight')} maxLength={160} className={fieldClass(err('highlight'))}
                   placeholder="Poplars turning gold along the Karakoram Highway" />
          </Field>
        </div>
        <Field label="Group size" htmlFor="pk-group">
          <input id="pk-group" value={f.group_size} onChange={set('group_size')} maxLength={16} className="field" />
        </Field>
        <Field label="Tags" htmlFor="pk-tags" hint="Comma-separated, up to 6">
          <input id="pk-tags" value={f.tags} onChange={set('tags')} className="field" placeholder="Culture, Photography" />
        </Field>
      </div>

      {/* itinerary */}
      <div>
        <div className="label">Itinerary <span className="text-rose-400">*</span></div>
        <ol className="space-y-3">
          {f.itinerary.map((day, i) => (
            <li key={i} className="rounded-xl border border-white/[.07] bg-white/[.02] p-3" data-invalid={Boolean(err(`itinerary.${i}.title`))}>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-glacier-300">Day {i + 1}</div>
              <Field error={err(`itinerary.${i}.title`)}>
                <input aria-label={`Day ${i + 1} title`} value={day.title} onChange={setDay(i, 'title')} maxLength={120}
                       className={fieldClass(err(`itinerary.${i}.title`))} placeholder="Gilgit → Karimabad" />
              </Field>
              <textarea aria-label={`Day ${i + 1} details`} value={day.body} onChange={setDay(i, 'body')} rows={2} maxLength={600}
                        className="field mt-2 resize-none" placeholder="What happens this day (optional)" />
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Included" htmlFor="pk-inc" hint="One per line">
          <textarea id="pk-inc" rows={4} value={f.includes} onChange={set('includes')} className="field resize-none" placeholder={'4x4 transport\nHotels\nBreakfast'} />
        </Field>
        <Field label="Not included" htmlFor="pk-exc" hint="One per line">
          <textarea id="pk-exc" rows={4} value={f.excludes} onChange={set('excludes')} className="field resize-none" placeholder={'Airfare\nLunches'} />
        </Field>
        <div data-invalid={Boolean(err('operator_url'))}>
          <Field label="Operator's package page" htmlFor="pk-url" error={err('operator_url')} hint="Opens from “Visit operator website”">
            <input id="pk-url" type="url" value={f.operator_url} onChange={set('operator_url')} className={fieldClass(err('operator_url'))}
                   placeholder="https://operator.example/hunza-tour" />
          </Field>
        </div>
        <div data-invalid={Boolean(err('whatsapp'))}>
          <Field label="WhatsApp number" htmlFor="pk-wa" error={err('whatsapp')} hint="With country code; used for “Contact on WhatsApp”">
            <input id="pk-wa" type="tel" inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} className={fieldClass(err('whatsapp'))}
                   placeholder="+92 300 1234567" />
          </Field>
        </div>
      </div>

      {/* images */}
      <div>
        <div className="label">Images <span className="normal-case tracking-normal text-frost-400">(optional, destination photos are used when none are added)</span></div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {f.images.map((u, i) => (
            <div key={u} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-ink-800">
              <img src={assetUrl(u)} alt={`Image ${i + 1}`} className="h-full w-full object-cover"
                   onError={(e) => { e.currentTarget.style.opacity = '0.2' }} />
              <button type="button" onClick={() => update({ images: f.images.filter((x) => x !== u) })} aria-label={`Remove image ${i + 1}`}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-abyss/70 text-snow opacity-90 transition hover:bg-rose-500">
                <X className="h-3.5 w-3.5" />
              </button>
              {i === 0 && <span className="absolute bottom-1.5 left-1.5 rounded bg-abyss/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-snow">Cover</span>}
            </div>
          ))}
          {Array.from({ length: uploading }).map((_, i) => <Skeleton key={`up-${i}`} className="aspect-[4/3]" />)}
          {f.images.length + uploading < MAX_IMAGES && (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="grid aspect-[4/3] place-items-center rounded-xl border border-dashed border-white/15 text-frost-400 transition hover:border-glacier-400/50 hover:text-glacier-300">
              <span className="flex flex-col items-center gap-1 text-[11px]"><ImagePlus className="h-5 w-5" /> Upload</span>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
               onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-frost-400" />
            <input value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} aria-label="Image address"
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl() } }}
                   className="field !py-2.5 !pl-9 !text-[13px]" placeholder="…or paste an image address" />
          </div>
          <button type="button" onClick={addUrl} className="btn-ghost !px-4 !py-2.5 !text-[12.5px]">Add</button>
        </div>
      </div>

      <button type="submit" disabled={saving || uploading > 0} className="btn-primary w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {editing ? 'Save changes' : 'Publish package'}
      </button>
    </form>
  )
}

/* ================================================================ page */
export { PackageForm }
