import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Ambulance, Hospital, Loader2, LocateFixed, MapPin, MessageCircle, Navigation, Phone, Shield, Siren } from 'lucide-react'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { ErrorState, Field, Reveal, SectionTitle, Skeleton, ease, useToast } from '../components/ui'

/*
 * Emergency page. Built to work with a weak or no signal: the numbers are
 * static, the emergency contact is kept on the device, and the last list of
 * nearby hospitals and police stations is cached for offline use. Only the
 * nationwide numbers whose operation in Gilgit-Baltistan and Chitral is
 * well established are listed; nearby stations come from OpenStreetMap.
 */
const HOTLINES = [
  { number: '1122', name: 'Rescue 1122', sub: 'Ambulance, fire and rescue', Icon: Siren, tone: 'bg-rose-500/15 text-rose-300 ring-rose-400/30' },
  { number: '15', name: 'Police', sub: 'Police emergency', Icon: Shield, tone: 'bg-sky-400/10 text-sky-300 ring-sky-400/25' },
  { number: '115', name: 'Edhi ambulance', sub: 'Edhi Foundation', Icon: Ambulance, tone: 'bg-amberz-400/10 text-amberz-300 ring-amberz-400/25' },
]
const CACHE = 'nt-sos-nearby'
const CONTACT = 'nt-emergency'

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}

function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && d.length === 11) d = '92' + d.slice(1)
  return d
}

export default function Sos() {
  const t = useT()
  const auth = useAuth()
  const toast = useToast()
  const [pos, setPos] = useState(null)
  const [locError, setLocError] = useState('')
  const [locating, setLocating] = useState(false)
  const [nearby, setNearby] = useState(() => readJSON(CACHE, null))
  const [nearState, setNearState] = useState('idle')
  const [contact, setContact] = useState(() => auth.profile?.emergency_contact?.phone
    ? auth.profile.emergency_contact : readJSON(CONTACT, { name: '', phone: '' }))

  useEffect(() => {
    if (auth.profile?.emergency_contact?.phone) setContact(auth.profile.emergency_contact)
  }, [auth.profile])

  const loadNearby = useCallback(async (p) => {
    setNearState('loading')
    try {
      const [h, pol] = await Promise.all([api.pois('hospital', p.lat, p.lon, 30000), api.pois('police', p.lat, p.lon, 30000)])
      const result = { at: Date.now(), lat: p.lat, lon: p.lon, hospitals: h.items.slice(0, 6), police: pol.items.slice(0, 4) }
      setNearby(result)
      try { localStorage.setItem(CACHE, JSON.stringify(result)) } catch { /* ignore */ }
      setNearState('ok')
    } catch {
      setNearState(nearby ? 'stale' : 'error')
    }
  }, [nearby])

  const locate = () => {
    if (!navigator.geolocation) { setLocError(t('This device cannot share its location.')); return }
    setLocating(true); setLocError('')
    navigator.geolocation.getCurrentPosition(
      (g) => {
        const p = { lat: g.coords.latitude, lon: g.coords.longitude, acc: Math.round(g.coords.accuracy) }
        setPos(p); setLocating(false); loadNearby(p)
      },
      (err) => {
        setLocating(false)
        setLocError(err.code === 1 ? t('Location permission was denied. Allow it in your browser to share where you are.')
          : t('Could not get a location fix. Move to open sky and try again.'))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }

  const saveContact = () => {
    try { localStorage.setItem(CONTACT, JSON.stringify(contact)) } catch { /* ignore */ }
    if (auth.signedIn) api.updateMe({ emergency_contact: contact }).then(auth.setProfile).catch(() => {})
    toast('Emergency contact saved on this device')
  }

  const share = () => {
    const num = waNumber(contact.phone)
    if (!num) { toast('Add an emergency contact number first', 'warn'); return }
    const where = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lon.toFixed(6)}` : ''
    const msg = `EMERGENCY — I need help. ${where ? `My location: ${where} (±${pos.acc} m).` : 'I could not get my GPS location.'} Sent from Northern Trails.`
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-20 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle eyebrow="Emergency" title={t('Help, one tap away.')}
          sub={t('Call for help, share where you are, and find the nearest hospital or police station. Works offline with the last saved list.')} />
      </Reveal>

      <div className="grid gap-3 sm:grid-cols-3">
        {HOTLINES.map(({ number, name, sub, Icon, tone }, i) => (
          <motion.a key={number} href={`tel:${number}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.07, ease }}
            className={`flex items-center gap-4 rounded-2xl p-5 ring-1 transition hover:-translate-y-0.5 ${tone}`}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-950/40"><Icon className="h-6 w-6" /></span>
            <span>
              <span className="block font-mono text-2xl font-bold text-frost-50">{number}</span>
              <span className="block text-[13px] font-semibold">{t(name)}</span>
              <span className="block text-[11.5px] text-frost-300">{t(sub)}</span>
            </span>
          </motion.a>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal>
          <div className="glass h-full rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-frost-50"><MessageCircle className="h-4 w-4 text-emerald-300" /> {t('Share my location')}</h2>
            <p className="mt-1 text-[12.5px] text-frost-400">{t('Sends your GPS position as a Google Maps link to your emergency contact on WhatsApp.')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t('Contact name')} htmlFor="sos-n"><input id="sos-n" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} className="field" /></Field>
              <Field label={t('WhatsApp number')} htmlFor="sos-p"><input id="sos-p" type="tel" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} className="field" placeholder="+92 300 1234567" /></Field>
            </div>
            <button onClick={saveContact} className="mt-2 text-[12px] text-glacier-300 underline-offset-4 hover:underline">{t('Save contact')}</button>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={locate} disabled={locating} className="btn-ghost !py-2.5 !text-[13px]">
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} {pos ? t('Update location') : t('Get my location')}
              </button>
              <button onClick={share} className="btn-primary !py-2.5 !text-[13px]"><MessageCircle className="h-4 w-4" /> {t('Send on WhatsApp')}</button>
            </div>
            {pos && <p className="mt-3 flex items-center gap-1.5 font-mono text-[12px] text-frost-300"><MapPin className="h-3.5 w-3.5 text-glacier-300" /> {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)} · ±{pos.acc} m</p>}
            {locError && <p role="alert" className="mt-3 text-[12.5px] text-rose-300">{locError}</p>}
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="glass h-full rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-frost-50"><Hospital className="h-4 w-4 text-rose-300" /> {t('Nearest help')}</h2>
            {!nearby && nearState === 'idle' && (
              <div className="mt-4 text-[13px] text-frost-400">
                {t('Share your location to list the closest hospitals and police stations.')}
                <button onClick={locate} className="btn-ghost mt-3 !py-2 !text-[12.5px]"><LocateFixed className="h-3.5 w-3.5" /> {t('Find nearby')}</button>
              </div>
            )}
            {nearState === 'loading' && <div className="mt-4 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
            {nearState === 'error' && <ErrorState title="Couldn't load nearby places" message="Check your signal and try again." onRetry={() => pos && loadNearby(pos)} className="mt-4" />}
            {nearby && nearState !== 'loading' && (
              <>
                {nearState === 'stale' || (!pos && nearby) ? (
                  <p className="mt-2 text-[11.5px] text-amberz-300">{t('Saved list from')} {new Date(nearby.at).toLocaleString()}</p>
                ) : null}
                <ul className="mt-3 divide-y divide-white/[.05]">
                  {[...nearby.hospitals.map((x) => ({ ...x, type: 'hospital' })), ...nearby.police.map((x) => ({ ...x, type: 'police' }))].map((x) => (
                    <li key={x.id} className="flex items-center gap-3 py-2.5">
                      {x.type === 'hospital' ? <Hospital className="h-4 w-4 shrink-0 text-rose-300" /> : <Shield className="h-4 w-4 shrink-0 text-sky-300" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-frost-50">{x.name}</div>
                        <div className="text-[11.5px] text-frost-400">{x.label} · {x.distance_km} km</div>
                      </div>
                      {x.phone && <a href={`tel:${x.phone.replace(/\s+/g, '')}`} aria-label={`Call ${x.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-frost-200 hover:text-frost-50"><Phone className="h-4 w-4" /></a>}
                      <a href={x.directions_url} target="_blank" rel="noreferrer noopener" aria-label={`Directions to ${x.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-glacier-300"><Navigation className="h-4 w-4" /></a>
                    </li>
                  ))}
                </ul>
                {!nearby.hospitals.length && !nearby.police.length && <p className="mt-3 text-[13px] text-frost-400">{t('None mapped within 30 km. Call 1122.')}</p>}
              </>
            )}
          </div>
        </Reveal>
      </div>
      <p className="mt-6 text-center text-[11.5px] text-frost-400">{t('Hospital and police locations come from OpenStreetMap and may be incomplete. In a life-threatening emergency, call 1122 first.')}</p>
    </div>
  )
}
