import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, KeyRound, Loader2, Play, Plus, Trash2 } from 'lucide-react'

import { api, apiBase, apiDocsUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { ErrorState, Reveal, SectionTitle, Skeleton, ease, useToast } from '../components/ui'

/*
 * The public developer API, documented from the endpoints themselves: every
 * example on this page is a real request the "Try it" button sends to the
 * live API, and the response shown is what came back.
 */
const ENDPOINTS = [
  {
    id: 'packages', method: 'GET', path: '/api/packages',
    title: 'List tour packages',
    about: 'Every published package with its operator. Filter and sort with query parameters.',
    params: [
      ['q', 'string', 'Search title, destination, tags and operator'],
      ['destination', 'string', 'Exact destination, e.g. Hunza'],
      ['max_price', 'integer', 'Highest price per person in PKR'],
      ['max_days', 'integer', 'Longest trip in days'],
      ['sort', 'string', 'recommended · price_asc · price_desc · duration · rating'],
    ],
    example: { q: '', destination: 'Hunza', max_price: '', max_days: '', sort: 'price_asc' },
  },
  {
    id: 'package', method: 'GET', path: '/api/packages/{id}',
    title: 'Get one package',
    about: 'A package with its day-by-day itinerary, the live status of every road it uses, and active alerts.',
    params: [['id', 'path', 'Package id from the list']],
    example: { id: 'pkg-hunza-short-3' },
  },
  {
    id: 'destinations', method: 'GET', path: '/api/destinations',
    title: 'List destinations',
    about: 'Destinations with coordinates, elevation, season, attractions and a live Safety Score out of 100.',
    params: [],
    example: {},
  },
  {
    id: 'conditions', method: 'GET', path: '/api/conditions/{destination}',
    title: 'Live conditions for a destination',
    about: 'Weather, earthquakes within 100 km this week, road status and the Safety Score in one response. Accepts a destination id or name.',
    params: [['destination', 'path', 'e.g. dest-skardu, Chitral, Fairy Meadows']],
    example: { destination: 'dest-skardu' },
  },
  {
    id: 'restaurants', method: 'GET', path: '/api/restaurants',
    title: 'Restaurants near a point',
    about: 'Named restaurants, cafés and fast food nearest first, from OpenStreetMap (or Google Places when configured), each with a directions link.',
    params: [['lat', 'number', 'Latitude'], ['lng', 'number', 'Longitude']],
    example: { lat: '36.3167', lng: '74.6589' },
  },
]

function buildUrl(ep, values) {
  let path = ep.path
  const query = new URLSearchParams()
  for (const [name, kind] of ep.params) {
    const v = String(values[name] ?? '').trim()
    if (kind === 'path') path = path.replace(`{${name}}`, encodeURIComponent(v || name))
    else if (v) query.set(name, v)
  }
  const q = query.toString()
  return path + (q ? `?${q}` : '')
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400) })}
      aria-label="Copy" className="grid h-7 w-7 place-items-center rounded-md text-frost-400 transition hover:bg-white/[.06] hover:text-frost-50">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function Endpoint({ ep, apiKey }) {
  const t = useT()
  const [values, setValues] = useState(ep.example)
  const [state, setState] = useState({ status: 'idle' })
  const path = buildUrl(ep, values)
  const full = apiBase() + path
  const curl = `curl ${apiKey ? `-H "X-API-Key: ${apiKey.slice(0, 10)}…" ` : ''}"${full}"`

  const run = async () => {
    setState({ status: 'loading' })
    const t0 = performance.now()
    try {
      const res = await fetch(full, { headers: apiKey ? { 'X-API-Key': apiKey } : {} })
      const text = await res.text()
      let body
      try { body = JSON.stringify(JSON.parse(text), null, 2) } catch { body = text }
      setState({
        status: res.ok ? 'ok' : 'error', code: res.status, ms: Math.round(performance.now() - t0),
        body: body.length > 6000 ? body.slice(0, 6000) + '\n… (truncated)' : body,
        limit: res.headers.get('X-RateLimit-Limit'), remaining: res.headers.get('X-RateLimit-Remaining'),
      })
    } catch (e) {
      setState({ status: 'error', code: 0, body: 'Could not reach the API: ' + e.message })
    }
  }

  return (
    <Reveal>
      <section id={ep.id} className="glass scroll-mt-24 overflow-hidden rounded-2xl">
        <div className="border-b border-white/[.06] p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">{ep.method}</span>
            <code className="font-mono text-[13.5px] text-frost-50">{ep.path}</code>
          </div>
          <h3 className="mt-2 text-[15px] font-semibold text-frost-50">{t(ep.title)}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-frost-300">{t(ep.about)}</p>
        </div>
        <div className="grid gap-0 lg:grid-cols-2">
          <div className="space-y-4 border-white/[.06] p-5 lg:border-e">
            {ep.params.length > 0 ? (
              <div className="space-y-3">
                {ep.params.map(([name, kind, desc]) => (
                  <label key={name} className="block">
                    <span className="mb-1 flex items-baseline gap-2 text-[12px]">
                      <code className="font-mono text-glacier-300">{name}</code>
                      <span className="text-[10.5px] uppercase tracking-[.12em] text-frost-400">{kind}</span>
                    </span>
                    <input value={values[name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                      className="field !py-2 !text-[13px]" placeholder={desc} aria-label={`${name}: ${desc}`} />
                  </label>
                ))}
              </div>
            ) : <p className="text-[12.5px] text-frost-400">{t('No parameters.')}</p>}
            <div className="rounded-xl border border-white/[.06] bg-ink-950/60">
              <div className="flex items-center justify-between border-b border-white/[.05] px-3 py-1.5 text-[10.5px] uppercase tracking-[.14em] text-frost-400">
                {t('Request')} <CopyButton text={curl} />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed text-frost-200">{curl}</pre>
            </div>
            <button onClick={run} disabled={state.status === 'loading'} className="btn-primary !py-2.5 !text-[13px]">
              {state.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {t('Try it')}
            </button>
          </div>
          <div className="min-w-0 p-5">
            <div className="mb-2 flex items-center justify-between text-[10.5px] uppercase tracking-[.14em] text-frost-400">
              <span>{t('Response')}</span>
              {state.code != null && state.status !== 'loading' && (
                <span className="flex items-center gap-2 normal-case tracking-normal">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${state.status === 'ok' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{state.code || 'ERR'}</span>
                  {state.ms != null && <span className="font-mono text-[11px] text-frost-400">{state.ms} ms</span>}
                  {state.limit && <span className="font-mono text-[11px] text-frost-400">{state.remaining}/{state.limit} left this minute</span>}
                </span>
              )}
            </div>
            {state.status === 'idle' && (
              <div className="grid h-56 place-items-center rounded-xl border border-dashed border-white/[.08] text-[12.5px] text-frost-400">
                {t('Press Try it to call the live API.')}
              </div>
            )}
            {state.status === 'loading' && <Skeleton className="h-56" />}
            {(state.status === 'ok' || state.status === 'error') && (
              <pre className="max-h-80 overflow-auto rounded-xl bg-ink-950/60 p-3 font-mono text-[11px] leading-relaxed text-frost-200">{state.body}</pre>
            )}
          </div>
        </div>
      </section>
    </Reveal>
  )
}

function KeyManager({ onUse }) {
  const auth = useAuth()
  const t = useT()
  const toast = useToast()
  const [state, setState] = useState({ status: 'loading', items: [] })
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setState((s) => ({ ...s, status: 'loading' }))
    api.devKeys().then((r) => setState({ status: 'ok', items: r.items, limits: r.limits }))
      .catch((e) => setState({ status: 'error', items: [], error: e.message }))
  }
  useEffect(() => { if (auth.isOperator) load() }, [auth.isOperator])

  if (!auth.signedIn) {
    return (
      <div className="glass rounded-2xl p-6">
        <KeyRound className="h-5 w-5 text-glacier-300" />
        <h3 className="mt-3 text-[15px] font-semibold text-frost-50">{t('API keys')}</h3>
        <p className="mt-1 text-[13px] text-frost-300">{t('Operators can create a personal key for 10× the anonymous rate limit.')}</p>
        <button onClick={() => auth.openSignIn('Sign in with your operator account to create API keys')} className="btn-ghost mt-4 !py-2 !text-[13px]">{t('Sign in')}</button>
      </div>
    )
  }
  if (!auth.isOperator) {
    return (
      <div className="glass rounded-2xl p-6">
        <KeyRound className="h-5 w-5 text-glacier-300" />
        <h3 className="mt-3 text-[15px] font-semibold text-frost-50">{t('API keys')}</h3>
        <p className="mt-1 text-[13px] text-frost-300">{t('API keys are for operator accounts. The public API works without one at 60 requests a minute.')}</p>
      </div>
    )
  }

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const k = await api.createDevKey(label.trim() || 'My integration')
      setFresh(k)
      setLabel('')
      load()
    } catch (err) { toast(err.message, 'bad') } finally { setBusy(false) }
  }
  const revoke = async (k) => {
    if (!window.confirm(`Revoke "${k.label}"? Apps using it will stop working.`)) return
    try { await api.revokeDevKey(k.id); toast('Key revoked'); load() } catch (err) { toast(err.message, 'bad') }
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-glacier-300" />
        <h3 className="text-[15px] font-semibold text-frost-50">{t('Your API keys')}</h3></div>
      <p className="mt-1 text-[12.5px] text-frost-400">
        {t('Send as the X-API-Key header.')} {state.limits && `${state.limits.with_key} req/min with a key · ${state.limits.anonymous} without.`}
      </p>
      <AnimatePresence>
        {fresh && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 rounded-xl border border-amberz-400/25 bg-amberz-400/[.07] p-3">
            <div className="text-[12px] font-semibold text-amberz-200">{t('Copy this key now — it will not be shown again.')}</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-ink-950/70 px-2 py-1.5 font-mono text-[12px] text-frost-50">{fresh.key}</code>
              <CopyButton text={fresh.key} />
              <button onClick={() => onUse(fresh.key)} className="btn-ghost !px-2.5 !py-1.5 !text-[11.5px]">{t('Use in Try it')}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <form onSubmit={create} className="mt-4 flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} aria-label="Key label"
          className="field !py-2 !text-[13px]" placeholder={t('Label, e.g. Booking widget')} />
        <button type="submit" disabled={busy} className="btn-primary shrink-0 !px-4 !py-2 !text-[13px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('Create')}
        </button>
      </form>
      <div className="mt-4">
        {state.status === 'loading' && <Skeleton className="h-16" />}
        {state.status === 'error' && <ErrorState title="Couldn't load keys" message={state.error} onRetry={load} />}
        {state.status === 'ok' && (state.items.length === 0
          ? <p className="text-[12.5px] text-frost-400">{t('No keys yet.')}</p>
          : (
            <ul className="divide-y divide-white/[.05]">
              {state.items.map((k) => (
                <li key={k.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-frost-50">{k.label}</div>
                    <div className="font-mono text-[11px] text-frost-400">{k.prefix}… · {k.requests} requests{k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ''}</div>
                  </div>
                  {k.revoked ? <span className="text-[11px] text-rose-300">{t('revoked')}</span> : (
                    <button onClick={() => revoke(k)} aria-label={`Revoke ${k.label}`} className="grid h-8 w-8 place-items-center rounded-lg text-frost-400 hover:bg-rose-400/10 hover:text-rose-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

export default function Developers() {
  const t = useT()
  const [apiKey, setApiKey] = useState('')
  return (
    <div className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle eyebrow="Developer API" title={t('Build on live northern-Pakistan travel data.')}
          sub={t('A public REST API for tour packages, destinations, live conditions and restaurants. JSON over HTTPS, no sign-up needed to start.')} />
      </Reveal>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:h-fit">
          <div className="glass rounded-2xl p-4">
            <div className="label">{t('Base URL')}</div>
            <div className="flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-frost-50">{apiBase()}</code>
              <CopyButton text={apiBase()} />
            </div>
            <div className="hairline my-3" />
            <nav className="space-y-0.5 text-[13px]">
              {ENDPOINTS.map((e) => (
                <a key={e.id} href={`#${e.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-frost-300 transition hover:bg-white/[.04] hover:text-frost-50">
                  <span className="font-mono text-[10px] text-emerald-300">GET</span> {t(e.title)}
                </a>
              ))}
            </nav>
            <div className="hairline my-3" />
            <ul className="space-y-1.5 text-[12px] text-frost-400">
              <li>• {t('60 requests/min per IP without a key')}</li>
              <li>• {t('600 requests/min with an operator key')}</li>
              <li>• {t('429 with Retry-After when over the limit')}</li>
            </ul>
            {apiDocsUrl && <a href={apiDocsUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-4 w-full !py-2 !text-[12.5px]">{t('Full Swagger reference')}</a>}
          </div>
          <KeyManager onUse={setApiKey} />
          {apiKey && (
            <div className="rounded-xl border border-glacier-400/20 bg-glacier-400/[.06] px-3 py-2 text-[12px] text-glacier-200">
              {t('Try it now sends your key.')} <button onClick={() => setApiKey('')} className="underline">{t('Stop')}</button>
            </div>
          )}
        </aside>
        <div className="space-y-5">
          {ENDPOINTS.map((ep) => <Endpoint key={ep.id} ep={ep} apiKey={apiKey} />)}
        </div>
      </div>
    </div>
  )
}
