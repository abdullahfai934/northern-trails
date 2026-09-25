import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Download, Loader2, MapPin, Pencil, Route, Save, Utensils, Wallet } from 'lucide-react'

import { api, pkr } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { downloadPlanPdf } from '../lib/pdf'
import { SafetyGauge } from './charts'
import { ErrorState, Field, Reveal, Skeleton, ease, fieldClass, useToast } from './ui'
import { useDir } from './motion'

const INTERESTS = ['Mountains', 'Lakes', 'Trekking', 'Culture', 'Photography', 'Camping', 'Wildlife', 'Heritage', 'Road trip', 'Short break']
const STARTS = ['Islamabad', 'Gilgit', 'Chilas', 'Skardu']

/**
 * The brief → a day-by-day plan from real packages, restaurants and
 * destinations. Signed-in users can edit each day, save the plan to their
 * profile, and download it as a PDF.
 */
export default function AiPlanner() {
  const t = useT()
  const auth = useAuth()
  const toast = useToast()
  const [params] = useSearchParams()
  const [brief, setBrief] = useState({ days: 5, budget_pkr: 150000, people: 2, start_city: 'Islamabad', interests: ['Mountains', 'Lakes'] })
  const [errors, setErrors] = useState({})
  const [state, setState] = useState({ status: 'idle' })
  const [plan, setPlan] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Opening a saved plan from the profile.
  useEffect(() => {
    const id = params.get('plan')
    if (!id || !auth.signedIn) return
    api.myPlans().then((r) => {
      const p = r.items.find((x) => x.id === id)
      if (p) { setPlan(p.plan); setBrief((b) => ({ ...b, ...p.brief })); setState({ status: 'ok' }) }
    }).catch(() => {})
  }, [params, auth.signedIn])

  // A freshly built plan is "written" onto the page day by day; once that has
  // played (or the user starts editing) days render still.
  const [writing, setWriting] = useState(false)
  const dir = useDir()
  useEffect(() => {
    if (!writing || !plan) return undefined
    const id = setTimeout(() => setWriting(false), plan.days.length * 450 + 1600)
    return () => clearTimeout(id)
  }, [writing, plan])
  useEffect(() => { if (editing) setWriting(false) }, [editing])
  const write = (i, k = 0) => (writing
    ? { initial: { opacity: 0, x: 10 * dir }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.5, delay: i * 0.45 + 0.2 + k * 0.12, ease } }
    : {})

  const set = (k, v) => setBrief((b) => ({ ...b, [k]: v }))
  const toggle = (i) => set('interests', brief.interests.includes(i) ? brief.interests.filter((x) => x !== i) : [...brief.interests, i])

  const generate = async (e) => {
    e?.preventDefault()
    const errs = {}
    if (!(brief.days >= 1 && brief.days <= 21)) errs.days = t('1 to 21 days')
    if (!(brief.people >= 1 && brief.people <= 40)) errs.people = t('1 to 40 people')
    if (brief.budget_pkr < 0) errs.budget_pkr = t('Budget cannot be negative')
    setErrors(errs)
    if (Object.keys(errs).length) return
    const run = async () => {
      setState({ status: 'loading' }); setEditing(false)
      try {
        const p = await api.aiPlan({ ...brief, days: Number(brief.days), people: Number(brief.people), budget_pkr: Number(brief.budget_pkr) || 0 })
        setPlan(p); setState({ status: 'ok' }); setWriting(true)
      } catch (err) { setState({ status: 'error', error: err.message }) }
    }
    auth.requireAuth(run, 'Sign in to build an AI trip plan')
  }

  const editDay = (i, patch) => setPlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }))

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.savePlan({ title: plan.title, brief, plan })
      setPlan(r.plan)
      toast('Plan saved to your profile')
    } catch (e) { toast(e.message, 'bad') } finally { setSaving(false) }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Reveal>
        <form onSubmit={generate} noValidate className="glass space-y-5 rounded-2xl p-6 lg:sticky lg:top-24">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Days')} htmlFor="ai-days" error={errors.days}>
              <input id="ai-days" type="number" min={1} max={21} value={brief.days} onChange={(e) => set('days', e.target.value)} className={fieldClass(errors.days)} />
            </Field>
            <Field label={t('Group size')} htmlFor="ai-people" error={errors.people}>
              <input id="ai-people" type="number" min={1} max={40} value={brief.people} onChange={(e) => set('people', e.target.value)} className={fieldClass(errors.people)} />
            </Field>
          </div>
          <Field label={t('Total budget (PKR)')} htmlFor="ai-budget" error={errors.budget_pkr} hint={t('For the whole group. 0 = no limit')}>
            <input id="ai-budget" type="number" min={0} step={5000} value={brief.budget_pkr} onChange={(e) => set('budget_pkr', e.target.value)} className={fieldClass(errors.budget_pkr)} />
          </Field>
          <Field label={t('Starting city')} htmlFor="ai-start">
            <select id="ai-start" value={brief.start_city} onChange={(e) => set('start_city', e.target.value)} className="field">
              {STARTS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div>
            <div className="label">{t('Interests')}</div>
            <div className="flex flex-wrap gap-1.5">
              {INTERESTS.map((i) => (
                <button key={i} type="button" onClick={() => toggle(i)} aria-pressed={brief.interests.includes(i)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition
                    ${brief.interests.includes(i) ? 'border-glacier-400/40 bg-glacier-400/15 text-glacier-200' : 'border-white/[.08] text-frost-300 hover:border-white/15'}`}>
                  {t(i)}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={state.status === 'loading'} className="btn-primary w-full">
            {state.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
            {state.status === 'loading' ? t('Planning your trip…') : t('Build my itinerary')}
          </button>
          <p className="text-[11px] leading-relaxed text-frost-400">
            {t('Uses only packages, restaurants and destinations on Northern Trails. Prices come from the catalogue, never from the AI.')}
          </p>
        </form>
      </Reveal>

      <div className="min-w-0">
        {state.status === 'idle' && (
          <div className="glass rounded-2xl p-10 text-center">
            <Route className="mx-auto h-7 w-7 text-glacier-300" />
            <div className="mt-4 text-[15px] font-semibold text-frost-50">{t('Tell us the trip, get a day-by-day plan.')}</div>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-frost-400">{t('Picks the destinations that fit, uses real packages where they match, suggests places to eat, and adds up the cost.')}</p>
          </div>
        )}
        {state.status === 'loading' && <div className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>}
        {state.status === 'error' && <ErrorState title="Couldn't build a plan" message={state.error} onRetry={generate} />}
        {state.status === 'ok' && plan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="space-y-5">
            <div className="glass rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input value={plan.title} onChange={(e) => setPlan((p) => ({ ...p, title: e.target.value }))} className="field !text-lg !font-semibold" aria-label="Plan title" />
                  ) : <h2 className="text-xl font-semibold text-frost-50 sm:text-2xl">{plan.title}</h2>}
                  {plan.summary && <p className="mt-2 text-[13.5px] leading-relaxed text-frost-300">{plan.summary}</p>}
                  <div className="mt-2 text-[11px] uppercase tracking-[.14em] text-frost-400">{plan.engine === 'gemini' ? t('AI planned · grounded in live data') : t('Planned from live data')}</div>
                </div>
                <div className="flex gap-3">
                  {plan.destinations?.map((d) => (
                    <div key={d.name} className="text-center">
                      <SafetyGauge score={d.safety.score} color={d.safety.color} label={d.name} size={96} stroke={8} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={() => setEditing((e) => !e)} className="btn-ghost !px-3 !py-2 !text-[12.5px]"><Pencil className="h-3.5 w-3.5" /> {editing ? t('Done editing') : t('Edit')}</button>
                <button onClick={save} disabled={saving} className="btn-ghost !px-3 !py-2 !text-[12.5px]">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t('Save')}</button>
                <button onClick={() => downloadPlanPdf(plan).catch((e) => toast('PDF failed: ' + e.message, 'bad'))} className="btn-ghost !px-3 !py-2 !text-[12.5px]"><Download className="h-3.5 w-3.5" /> {t('Download PDF')}</button>
              </div>
            </div>

            <ol className="space-y-3">
              <AnimatePresence initial={false}>
                {plan.days.map((d, i) => (
                  <motion.li key={d.day} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: writing ? i * 0.45 : i * 0.05, ease }}
                    className="glass rounded-2xl p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-[10px] font-bold uppercase tracking-[.16em] text-glacier-300">{t('Day')} {d.day} · <MapPin className="inline h-3 w-3" /> {d.location}</div>
                      {d.package_id ? <Link to={`/explore/${d.package_id}`} className="text-[11.5px] font-semibold text-amberz-300 hover:underline">{t('Part of a package')} →</Link>
                        : d.est_cost_pkr ? <span className="font-mono text-[11.5px] text-frost-400">~{pkr(d.est_cost_pkr)}</span> : null}
                    </div>
                    {editing ? (
                      <div className="mt-2 space-y-2">
                        <input value={d.title} onChange={(e) => editDay(i, { title: e.target.value })} className="field !py-2" aria-label={`Day ${d.day} title`} />
                        <textarea value={(d.activities || []).join('\n')} onChange={(e) => editDay(i, { activities: e.target.value.split('\n') })} rows={3} className="field resize-none !text-[13px]" aria-label={`Day ${d.day} activities`} />
                      </div>
                    ) : (
                      <>
                        <motion.div {...write(i)} className="mt-1 text-[15px] font-semibold text-frost-50">{d.title}</motion.div>
                        <ul className="mt-1.5 space-y-1 text-[13px] text-frost-300">{(d.activities || []).filter(Boolean).map((a, k) => <motion.li key={k} {...write(i, k + 1)}>• {a}</motion.li>)}</ul>
                      </>
                    )}
                    {d.restaurant && (
                      <a href={d.restaurant.directions_url} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-frost-300 hover:text-glacier-300">
                        <Utensils className="h-3.5 w-3.5 text-orange-300" /> {d.restaurant.name} · {d.restaurant.cuisine} · {d.restaurant.distance_km} km
                      </a>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>

            <div className="glass-strong grid gap-4 rounded-2xl p-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-frost-50"><Wallet className="h-4 w-4 text-glacier-300" /> {t('Estimated cost')}</div>
                <div className="mt-2 grid gap-1 text-[12.5px] text-frost-300">
                  <div>{t('Packages')}: <span className="font-mono text-frost-100">{pkr(plan.costs.packages_pkr)}</span></div>
                  <div>{t('Other days')}: <span className="font-mono text-frost-100">{pkr(plan.costs.ground_pkr)}</span></div>
                </div>
                <p className="mt-2 text-[11px] text-frost-400">{plan.costs.basis}</p>
              </div>
              <div className="text-end">
                <div className="font-mono text-2xl font-bold text-frost-50">{pkr(plan.costs.total_pkr)}</div>
                {plan.costs.within_budget != null && (
                  <div className={`text-[12px] font-semibold ${plan.costs.within_budget ? 'text-emerald-300' : 'text-amberz-300'}`}>
                    {plan.costs.within_budget ? t('Within your budget') : `${t('Over budget by')} ${pkr(plan.costs.total_pkr - plan.costs.budget_pkr)}`}
                  </div>
                )}
              </div>
            </div>
            {plan.tips?.length > 0 && (
              <div className="glass rounded-2xl p-5">
                <div className="label">{t('Before you go')}</div>
                <ul className="space-y-1.5 text-[13px] text-frost-300">{plan.tips.map((tip, i) => <li key={i}>• {tip}</li>)}</ul>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
