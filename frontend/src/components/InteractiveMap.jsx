import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Activity, Building2, Fuel, Hospital, Loader2, MapPin, Package, Route as RouteIcon, Search, Shield, Utensils,
} from 'lucide-react'

import { api, pkr, relTime } from '../lib/api'
import { useData } from '../lib/store'
import { useT } from '../lib/i18n'
import { STATUS } from '../lib/api'
import { useToast } from './ui'

/*
 * Map layers. "Static" layers come with the site's data (destinations,
 * packages, roads, earthquakes); "nearby" layers are fetched from
 * OpenStreetMap around the centre of the map, 15 km out, when switched on
 * or when the map is moved and "Search this area" is pressed.
 */
const LAYERS = [
  { id: 'destinations', label: 'Destinations', Icon: MapPin, color: '#D9B45F', kind: 'static' },
  { id: 'packages', label: 'Packages', Icon: Package, color: '#E3C47E', kind: 'static' },
  { id: 'roads', label: 'Road status', Icon: RouteIcon, color: '#6CC4C0', kind: 'static' },
  { id: 'quakes', label: 'Earthquakes (7 days)', Icon: Activity, color: '#d03b3b', kind: 'static' },
  { id: 'restaurant', label: 'Restaurants', Icon: Utensils, color: '#d95926', kind: 'nearby' },
  { id: 'hotel', label: 'Hotels', Icon: Building2, color: '#3987e5', kind: 'nearby' },
  { id: 'hospital', label: 'Hospitals', Icon: Hospital, color: '#d55181', kind: 'nearby' },
  { id: 'fuel', label: 'Petrol pumps', Icon: Fuel, color: '#c98500', kind: 'nearby' },
  { id: 'police', label: 'Police', Icon: Shield, color: '#199e70', kind: 'nearby' },
]
const ROAD_COLOR = { open: '#0ca30c', caution: '#fab219', seasonal: '#6CC4C0', restricted: '#ec835a', closed: '#d03b3b' }
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/**
 * Real road shapes from OSRM, cached per route; a straight segment if OSRM is
 * unavailable, or if its shortest drive is much longer than the tracked road
 * (it detours round a pass it cannot route over, e.g. Shandur) — drawing the
 * detour would put the closure on the wrong road.
 */
async function roadGeometry(id, [a, b], expectedKm) {
  const key = `nt-geom:v2:${id}`
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null')
    if (hit) return hit
  } catch { /* ignore */ }
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`)
    const j = await res.json()
    const route = j.routes?.[0]
    const line = route?.geometry?.coordinates?.map(([lon, lat]) => [lat, lon])
    const detour = expectedKm && route?.distance / 1000 > expectedKm * 1.4
    if (line?.length && !detour) {
      try { localStorage.setItem(key, JSON.stringify(line)) } catch { /* quota */ }
      return line
    }
  } catch { /* fall through */ }
  return [a, b]
}

function Tracker({ onMove }) {
  useMapEvents({ moveend: (e) => onMove(e.target.getCenter()) })
  return null
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A slow, smooth camera flight to the chosen destination. */
function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (reducedMotion()) map.setView(target, 12, { animate: false })
    else map.flyTo(target, 12, { duration: 1.7, easeLinearity: 0.15 })
  }, [map, target])
  return null
}

/**
 * Each layer lives in its own map pane, so turning it on or off fades the
 * whole pane (opacity only) instead of popping. A layer stays mounted once it
 * has been shown; a hidden pane is also taken out of hit-testing.
 */
function FadePane({ name, visible, z, children }) {
  const [mounted, setMounted] = useState(visible)
  useEffect(() => { if (visible) setMounted(true) }, [visible])
  if (!mounted) return null
  return (
    <Pane name={name} className="nt-pane" style={{ zIndex: z, opacity: 0 }}>
      <PaneFader name={name} visible={visible} />
      {children}
    </Pane>
  )
}

function PaneFader({ name, visible }) {
  const map = useMap()
  useEffect(() => {
    const el = map.getPane(name)
    if (!el) return undefined
    let raf = 0
    let timer = 0
    if (visible) {
      el.style.visibility = 'visible'
      raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { el.style.opacity = '1' }) })
    } else {
      el.style.opacity = '0'
      timer = setTimeout(() => { el.style.visibility = 'hidden' }, 480)
    }
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [map, name, visible])
  return null
}

/** A road draws itself from start to end the first time it appears. */
function drawIn(e) {
  const path = e.target.getElement?.()
  if (!path || reducedMotion() || typeof path.getTotalLength !== 'function') return
  const len = path.getTotalLength()
  if (!len) return
  path.style.strokeDasharray = `${len}`
  path.style.strokeDashoffset = `${len}`
  path.getBoundingClientRect()                       // commit the start state
  path.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.22,1,.36,1)'
  path.style.strokeDashoffset = '0'
  const done = () => {
    // Hand the stroke back to Leaflet (closed roads keep their dashes).
    path.style.transition = ''; path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''
    path.removeEventListener('transitionend', done)
  }
  path.addEventListener('transitionend', done)
}

/** Expanding rings for a recent earthquake, sized by its magnitude. */
const quakeIcons = {}
function quakeIcon(mag = 4) {
  const size = Math.round(22 + Math.max(0, mag - 3) * 10)
  return (quakeIcons[size] ||= L.divIcon({
    className: '', iconSize: [size, size],
    html: `<div class="nt-quake" style="width:${size}px;height:${size}px"><span></span><span></span><span></span></div>`,
  }))
}

export default function InteractiveMap() {
  const t = useT()
  const d = useData()
  const toast = useToast()
  const [on, setOn] = useState(() => new Set(['destinations', 'roads', 'quakes']))
  const [center, setCenter] = useState({ lat: 35.7, lng: 74.6 })
  const [searched, setSearched] = useState(null)
  const [pois, setPois] = useState({})
  const [loading, setLoading] = useState(new Set())
  const [geoms, setGeoms] = useState({})
  const [fly, setFly] = useState(null)

  const destinations = (d.destinations || []).filter((x) => x.lat != null)
  const quakes = (d.alerts || []).filter((a) => a.kind?.toLowerCase() === 'earthquake' && a.lat != null
    && Date.now() - new Date(a.issued_at).getTime() < 7 * 864e5)
  const pkgsByDest = useMemo(() => {
    const m = {}
    for (const p of d.packages || []) (m[p.destination] ||= []).push(p)
    return m
  }, [d.packages])

  useEffect(() => {
    let alive = true
    for (const r of d.routes || []) {
      if (!r.endpoints || geoms[r.id]) continue
      roadGeometry(r.id, r.endpoints, r.distance_km).then((line) => alive && setGeoms((g) => ({ ...g, [r.id]: line })))
    }
    return () => { alive = false }
  }, [d.routes])

  const fetchLayer = useCallback(async (id, at) => {
    setLoading((s) => new Set(s).add(id))
    try {
      const r = id === 'restaurant'
        ? await api.restaurantsAt(at.lat, at.lng)
        : await api.pois(id, at.lat, at.lng, 15000)
      if (r.ok === false) throw new Error(r.error || 'lookup failed')
      setPois((p) => ({ ...p, [id]: r.items || [] }))
    } catch (e) {
      toast(`${t(LAYERS.find((l) => l.id === id).label)}: ${e.message}`, 'bad')
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }, [toast, t])

  const toggle = (id) => {
    const layer = LAYERS.find((l) => l.id === id)
    const turningOn = !on.has(id)
    const next = new Set(on)
    if (turningOn) next.add(id)
    else next.delete(id)
    setOn(next)
    if (turningOn && layer.kind === 'nearby' && !pois[id]) {
      fetchLayer(id, center)
      setSearched(center)
    }
  }

  const searchHere = () => {
    setSearched(center)
    for (const l of LAYERS) if (l.kind === 'nearby' && on.has(l.id)) fetchLayer(l.id, center)
  }

  const nearbyOn = LAYERS.some((l) => l.kind === 'nearby' && on.has(l.id))
  const stale = nearbyOn && searched && (Math.abs(searched.lat - center.lat) > 0.05 || Math.abs(searched.lng - center.lng) > 0.05)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
      <div className="glass h-fit rounded-2xl p-3">
        <div className="label px-1">{t('Layers')}</div>
        <div className="space-y-0.5">
          {LAYERS.map(({ id, label, Icon, color }) => (
            <label key={id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] text-frost-200 transition hover:bg-white/[.04]">
              <input type="checkbox" checked={on.has(id)} onChange={() => toggle(id)} className="h-4 w-4 accent-[#6CC4C0]" />
              <Icon className="h-4 w-4" style={{ color }} />
              <span className="flex-1">{t(label)}</span>
              {loading.has(id) ? <Loader2 className="h-3.5 w-3.5 animate-spin text-frost-400" />
                : pois[id] && on.has(id) ? <span className="font-mono text-[11px] text-frost-400">{pois[id].length}</span> : null}
            </label>
          ))}
        </div>
        <div className="hairline my-3" />
        <div className="label px-1">{t('Go to')}</div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {destinations.map((x) => (
            <button key={x.id} onClick={() => setFly([x.lat, x.lon])} className="chip hover:border-glacier-400/40">{x.name}</button>
          ))}
        </div>
        <div className="hairline my-3" />
        <div className="space-y-1 px-1 text-[11px] text-frost-400">
          {Object.entries(ROAD_COLOR).map(([k, c]) => (
            <div key={k} className="flex items-center gap-2"><span className="h-1 w-5 rounded-full" style={{ background: c }} /> {t(STATUS[k]?.label || k)}</div>
          ))}
        </div>
      </div>

      <div className="glass relative h-[70vh] min-h-[420px] overflow-hidden rounded-2xl">
        {stale && (
          <button onClick={searchHere} className="btn-primary absolute start-1/2 top-3 z-[500] -translate-x-1/2 !px-4 !py-2 !text-[12.5px] rtl:translate-x-1/2">
            <Search className="h-3.5 w-3.5" /> {t('Search this area')}
          </button>
        )}
        <MapContainer center={[35.7, 74.6]} zoom={7} scrollWheelZoom className="h-full w-full">
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
          <Tracker onMove={(c) => setCenter({ lat: c.lat, lng: c.lng })} />
          <FlyTo target={fly} />

          <FadePane name="nt-roads" z={402} visible={on.has('roads')}>
          {(d.routes || []).map((r) => geoms[r.id] && (
            <Polyline key={r.id} positions={geoms[r.id]} eventHandlers={{ add: drawIn }}
              pathOptions={{ color: ROAD_COLOR[r.status] || '#6CC4C0', weight: r.status === 'closed' ? 6 : 4, opacity: 0.9, dashArray: r.status === 'closed' ? '8 8' : null }}>
              <Popup>
                <div className="font-semibold">{r.name}</div>
                <div><b>{STATUS[r.status]?.label || r.status}</b>: {r.status_note}</div>
                <div className="opacity-70">{t('Updated')} {relTime(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</div>
              </Popup>
            </Polyline>
          ))}
          </FadePane>

          <FadePane name="nt-quakes" z={404} visible={on.has('quakes')}>
          {quakes.map((q) => (
            <React.Fragment key={q.id}>
              {!reducedMotion() && <Marker position={[q.lat, q.lon]} icon={quakeIcon(q.magnitude)} interactive={false} keyboard={false} />}
              <CircleMarker center={[q.lat, q.lon]} radius={4 + (q.magnitude || 4) * 2}
                pathOptions={{ color: '#d03b3b', fillColor: '#d03b3b', fillOpacity: 0.25, weight: 2 }}>
                <Popup><div className="font-semibold">{q.title}</div><div className="opacity-70">{relTime(q.issued_at)} · {q.source}</div></Popup>
              </CircleMarker>
            </React.Fragment>
          ))}
          </FadePane>

          <FadePane name="nt-destinations" z={406} visible={on.has('destinations') || on.has('packages')}>
          {destinations.map((x) => (
            <CircleMarker key={x.id} center={[x.lat, x.lon]} radius={on.has('packages') ? 9 + Math.min(6, (pkgsByDest[x.name]?.length || 0) * 2) : 9}
              pathOptions={{ color: '#D9B45F', fillColor: '#D9B45F', fillOpacity: 0.45, weight: 2 }}>
              <Tooltip direction="top" offset={[0, -8]}>{x.name}</Tooltip>
              <Popup>
                <div className="font-semibold">{x.name} · {x.elevation_m} m</div>
                <div className="mb-1 opacity-80">{x.blurb}</div>
                {(pkgsByDest[x.name] || []).map((p) => (
                  <div key={p.id}><Link to={`/explore/${p.id}`}>{p.title}</Link> — {p.days} days, {pkr(p.price_pkr)}</div>
                ))}
              </Popup>
            </CircleMarker>
          ))}
          </FadePane>

          {LAYERS.filter((l) => l.kind === 'nearby').map((l, k) => (
            <FadePane key={l.id} name={`nt-${l.id}`} z={408 + k} visible={on.has(l.id)}>
            {(pois[l.id] || []).map((p) => (
            <CircleMarker key={`${l.id}-${p.id}`} center={[p.lat, p.lon]} radius={5}
              pathOptions={{ color: l.color, fillColor: l.color, fillOpacity: 0.85, weight: 1.5 }}>
              <Popup>
                <div className="font-semibold">{p.name}</div>
                <div className="opacity-70">{p.cuisine || p.label}{p.distance_km != null ? ` · ${p.distance_km} km from centre` : ''}</div>
                {p.phone && <div><a href={`tel:${p.phone.replace(/\s+/g, '')}`}>{p.phone}</a></div>}
                <a href={p.directions_url} target="_blank" rel="noreferrer noopener">{t('Get directions')} →</a>
              </Popup>
            </CircleMarker>
            ))}
            </FadePane>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
