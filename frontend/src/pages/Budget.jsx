import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Car, Fuel, Hotel, Info, Loader2, Route as RouteIcon, Ticket, UserCheck, Utensils } from 'lucide-react'

import { pkr } from '../lib/api'
import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import { DonutChart, DonutLegend } from '../components/charts'
import { Field, Reveal, SectionTitle, ease } from '../components/ui'

/*
 * Trip budget calculator.
 *
 * Distance is the real road distance from OSRM between the start city and the
 * destination (straight line × 1.35 if OSRM is unreachable). Entry fees
 * default to the permit records on each route. Every other rate is an
 * editable starting point: vehicle hire, fuel price and hotel tiers vary by
 * season and operator, so the page says so rather than presenting one
 * number as fact.
 */
const STARTS = {
  Islamabad: [33.6844, 73.0479], Lahore: [31.5204, 74.3587], Peshawar: [34.0151, 71.5249],
  Gilgit: [35.9208, 74.3144], Skardu: [35.2971, 75.6333], Chitral: [35.8511, 71.7864],
}
const VEHICLES = {
  car:     { label: 'Car (sedan)',      seats: 4,  kmpl: 12, rent: 8000 },
  jeep:    { label: 'Jeep / 4x4',       seats: 6,  kmpl: 8,  rent: 14000 },
  coaster: { label: 'Coaster (minibus)', seats: 20, kmpl: 6,  rent: 22000 },
}
const HOTELS = { budget: ['Budget guest house', 5000], mid: ['Mid-range hotel', 10000], premium: ['Premium hotel', 22000] }
const ENTRY_FEES = { Hunza: 800, Deosai: 500, 'Fairy Meadows': 300, Skardu: 0, Chitral: 0 }
const ENTRY_NOTE = {
  Hunza: 'Khunjerab National Park, local rate',
  Deosai: 'Deosai National Park permit, local rate',
  'Fairy Meadows': 'Fairy Meadows community fee',
}

function km(a, b) {
  const r = 6371, rad = Math.PI / 180
  const dp = (b[0] - a[0]) * rad, dl = (b[1] - a[1]) * rad
  const x = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(x))
}

async function roadKm(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const j = await res.json()
    if (j.code !== 'Ok') throw new Error(j.code)
    return { km: Math.round(j.routes[0].distance / 1000), hours: j.routes[0].duration / 3600, method: 'road' }
  } finally { clearTimeout(t) }
}

function NumberField({ id, label, value, onChange, min = 0, max, step = 1, hint, suffix }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} step={step} value={value}
               onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(min, Number(e.target.value)))} className="field !pe-12" />
        {suffix && <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-frost-400">{suffix}</span>}
      </div>
    </Field>
  )
}

export default function Budget() {
  const t = useT()
  const d = useData()
  const destinations = (d.destinations || []).filter((x) => x.lat != null)
  const [start, setStart] = useState('Islamabad')
  const [destName, setDestName] = useState('Hunza')
  const [days, setDays] = useState(5)
  const [people, setPeople] = useState(4)
  const [vehicle, setVehicle] = useState('jeep')
  const [hotel, setHotel] = useState('mid')
  const [guide, setGuide] = useState(true)
  const [fuelPrice, setFuelPrice] = useState(275)
  const [rent, setRent] = useState(VEHICLES.jeep.rent)
  const [hotelRate, setHotelRate] = useState(HOTELS.mid[1])
  const [food, setFood] = useState(2500)
  const [guideRate, setGuideRate] = useState(6000)
  const [fee, setFee] = useState(ENTRY_FEES.Hunza)
  const [dist, setDist] = useState({ status: 'loading' })

  const dest = destinations.find((x) => x.name === destName)

  useEffect(() => setRent(VEHICLES[vehicle].rent), [vehicle])
  useEffect(() => setHotelRate(HOTELS[hotel][1]), [hotel])
  useEffect(() => setFee(ENTRY_FEES[destName] ?? 0), [destName])

  useEffect(() => {
    if (!dest) return undefined
    let alive = true
    const a = STARTS[start], b = [dest.lat, dest.lon]
    setDist({ status: 'loading' })
    roadKm(a, b).then((r) => { if (alive) setDist({ status: 'ok', ...r }) })
      .catch(() => { if (alive) setDist({ status: 'ok', km: Math.round(km(a, b) * 1.35), method: 'estimate' }) })
    return () => { alive = false }
  }, [start, dest?.lat, dest?.lon])

  const n = Math.max(1, Number(days) || 1)
  const p = Math.max(1, Number(people) || 1)
  const v = VEHICLES[vehicle]
  const vehicles = Math.ceil(p / v.seats)
  const tripKm = dist.status === 'ok' ? dist.km * 2 + 40 * n : 0          // there and back, plus local driving
  const breakdown = useMemo(() => {
    const litres = tripKm / v.kmpl
    return [
      { key: 'transport', label: t('Vehicle hire'), Icon: Car, value: Math.round(vehicles * (Number(rent) || 0) * n) },
      { key: 'fuel', label: t('Fuel'), Icon: Fuel, value: Math.round(vehicles * litres * (Number(fuelPrice) || 0)) },
      { key: 'hotel', label: t('Hotels'), Icon: Hotel, value: Math.round(Math.ceil(p / 2) * (Number(hotelRate) || 0) * Math.max(0, n - 1)) },
      { key: 'food', label: t('Food'), Icon: Utensils, value: Math.round(p * (Number(food) || 0) * n) },
      { key: 'fees', label: t('Entry fees'), Icon: Ticket, value: Math.round(p * (Number(fee) || 0)) },
      { key: 'guide', label: t('Guide'), Icon: UserCheck, value: guide ? Math.round((Number(guideRate) || 0) * n) : 0 },
    ]
  }, [tripKm, v, vehicles, rent, n, fuelPrice, p, hotelRate, food, fee, guide, guideRate, t])
  const total = breakdown.reduce((a, b) => a + b.value, 0)

  return (
    <div className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle eyebrow="Budget calculator" title={t('What will the trip really cost?')}
          sub={t('Real road distance, the permit fees on the route, and rates you can adjust to match the quotes you get.')} />
      </Reveal>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Reveal>
          <div className="glass space-y-6 rounded-2xl p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Starting from')} htmlFor="b-start">
                <select id="b-start" value={start} onChange={(e) => setStart(e.target.value)} className="field">
                  {Object.keys(STARTS).map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label={t('Destination')} htmlFor="b-dest">
                <select id="b-dest" value={destName} onChange={(e) => setDestName(e.target.value)} className="field">
                  {destinations.map((x) => <option key={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <NumberField id="b-days" label={t('Days')} value={days} onChange={setDays} min={1} max={30} />
              <NumberField id="b-people" label={t('Travelers')} value={people} onChange={setPeople} min={1} max={40} />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 text-[12.5px] text-frost-300">
              <RouteIcon className="h-4 w-4 shrink-0 text-glacier-300" />
              {dist.status === 'loading' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Measuring the road…')}</> : (
                <span>{start} → {destName}: <b className="text-frost-50">{dist.km} km</b> {t('each way')}
                  {dist.method === 'road' ? ` · ~${dist.hours.toFixed(1)} h ${t('by road')}` : ` · ${t('estimated')}`}
                  {' '}· {tripKm.toLocaleString()} km {t('in total with local driving')}</span>
              )}
            </div>
            <div>
              <div className="label">{t('Transport')}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(VEHICLES).map(([id, x]) => (
                  <button key={id} type="button" onClick={() => setVehicle(id)} aria-pressed={vehicle === id}
                    className={`rounded-xl border p-3 text-start transition ${vehicle === id ? 'border-glacier-400/50 bg-glacier-400/[.08]' : 'border-white/[.07] hover:border-white/15'}`}>
                    <div className="text-[13px] font-semibold text-frost-50">{t(x.label)}</div>
                    <div className="text-[11.5px] text-frost-400">{x.seats} {t('seats')} · {x.kmpl} km/L</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <NumberField id="b-rent" label={t('Hire per vehicle per day')} value={rent} onChange={setRent} step={500} suffix="PKR"
                             hint={`${vehicles} ${t(vehicles > 1 ? 'vehicles' : 'vehicle')} ${t('for')} ${p} ${t('travelers')}`} />
                <NumberField id="b-fuel" label={t('Fuel price per litre')} value={fuelPrice} onChange={setFuelPrice} step={1} suffix="PKR" hint={t('Set today’s pump price')} />
              </div>
            </div>
            <div>
              <div className="label">{t('Stay and food')}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(HOTELS).map(([id, [label]]) => (
                  <button key={id} type="button" onClick={() => setHotel(id)} aria-pressed={hotel === id}
                    className={`rounded-xl border px-3 py-2.5 text-start text-[13px] font-semibold transition ${hotel === id ? 'border-glacier-400/50 bg-glacier-400/[.08] text-frost-50' : 'border-white/[.07] text-frost-300 hover:border-white/15'}`}>
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <NumberField id="b-hotel" label={t('Per room per night')} value={hotelRate} onChange={setHotelRate} step={500} suffix="PKR" hint={`${Math.ceil(p / 2)} ${t('rooms')} × ${Math.max(0, n - 1)} ${t('nights')}`} />
                <NumberField id="b-food" label={t('Food per person per day')} value={food} onChange={setFood} step={100} suffix="PKR" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField id="b-fee" label={t('Entry fees per person')} value={fee} onChange={setFee} step={50} suffix="PKR"
                           hint={ENTRY_NOTE[destName] ? t(ENTRY_NOTE[destName]) : t('No permit fee on record for this route')} />
              <div>
                <label className="flex items-center gap-2.5 pt-6 text-[13px] text-frost-200">
                  <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} className="h-4 w-4 accent-[#6CC4C0]" /> {t('Hire a licensed guide')}
                </label>
                {guide && <div className="mt-2"><NumberField id="b-guide" label={t('Guide per day')} value={guideRate} onChange={setGuideRate} step={500} suffix="PKR" /></div>}
              </div>
            </div>
            <p className="flex items-start gap-2 text-[11.5px] text-frost-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('Rates are editable starting points, not quotes. Distance is from OpenStreetMap routing (OSRM); fees come from the permit records on each route.')}</p>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="glass-strong rounded-2xl p-6 lg:sticky lg:top-24">
            <div className="text-[10px] uppercase tracking-[.16em] text-frost-400">{t('Estimated total')}</div>
            <motion.div key={total} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}
              className="mt-1 font-mono text-3xl font-bold text-frost-50">{pkr(total)}</motion.div>
            <div className="mt-1 text-[12.5px] text-frost-400">{pkr(Math.round(total / p))} {t('per person')} · {n} {t('days')}</div>
            <div className="my-6"><DonutChart data={breakdown} format={pkr} centerLabel={t('Total')} /></div>
            <DonutLegend data={breakdown} format={pkr} />
          </div>
        </Reveal>
      </div>
    </div>
  )
}
