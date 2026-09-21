import React, { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AuthButton } from './SignIn'
import { apiDocsUrl } from '../lib/api'
import { useData } from '../lib/store'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Compass, Zap, Radio, Sparkles, LayoutDashboard, Mountain, Github } from 'lucide-react'

const NAV = [
  { to: '/explore',    label: 'Explore',    icon: Compass },
  { to: '/instant',    label: 'Instant',    icon: Zap },
  { to: '/conditions', label: 'Conditions', icon: Radio },
  { to: '/assistant',  label: 'Assistant',  icon: Sparkles },
  { to: '/operator',   label: 'Operator',   icon: LayoutDashboard },
]

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const x = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 })
  return (
    <motion.div
      style={{ scaleX: x }}
      className="fixed inset-x-0 top-0 z-[80] h-[2px] origin-left bg-gradient-to-r from-glacier-300 via-glacier-400 to-amberz-400"
    />
  )
}

export function TopNav() {
  const [solid, setSolid] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`fixed inset-x-0 top-0 z-[75] transition-all duration-500
      ${solid ? 'border-b border-white/[.07] bg-ink-950/80 backdrop-blur-xl' : 'border-b border-transparent'}`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="group flex items-center gap-2.5">
          <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glacier-400/90 to-amberz-400/80 text-ink-950 shadow-glow">
            <Mountain className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-extrabold tracking-tight text-frost-50">Northern Trails</span>
            <span className="block text-[10px] font-medium uppercase tracking-[.18em] text-frost-400">Gilgit-Baltistan · Chitral</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to)
            return (
              <NavLink key={to} to={to}
                className={`relative rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors
                  ${active ? 'text-frost-50' : 'text-frost-300 hover:text-frost-100'}`}>
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-white/[.07] ring-1 ring-white/10"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" /> {label}
                </span>
              </NavLink>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <AuthButton />
          {apiDocsUrl && (
            <a href={apiDocsUrl} target="_blank" rel="noreferrer"
               className="hidden rounded-lg border border-white/10 px-3 py-2 text-[12px] font-semibold text-frost-300 transition hover:bg-white/[.06] hover:text-frost-50 sm:block">
              API
            </a>
          )}
          <Link to="/instant" className="btn-primary !px-4 !py-2 !text-[13px]">
            <Zap className="h-3.5 w-3.5" /> Get a ride
          </Link>
        </div>
      </div>
    </header>
  )
}

export function BottomTabs() {
  const { pathname } = useLocation()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[75] lg:hidden">
      <div className="mx-3 mb-3 flex items-center justify-around rounded-2xl border border-white/[.08] bg-ink-900/90 px-1.5 py-1.5 backdrop-blur-2xl shadow-lift">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to)
          return (
            <NavLink key={to} to={to} className="relative flex-1 py-2 text-center">
              {active && (
                <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-white/[.08]"
                  transition={{ type: 'spring', stiffness: 400, damping: 34 }} />
              )}
              <span className={`relative flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors
                ${active ? 'text-glacier-300' : 'text-frost-400'}`}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.5 : 2} />
                {label}
              </span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

export function Footer() {
  return (
    <footer className="relative mt-28 border-t border-white/[.07] px-5 pb-28 pt-14 sm:px-8 lg:pb-14">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-3 flex items-center gap-2 text-frost-50">
            <Mountain className="h-4 w-4 text-glacier-300" />
            <span className="font-extrabold tracking-tight">Northern Trails</span>
          </div>
          <p className="max-w-xs text-[13px] leading-relaxed text-frost-400">
            A hybrid marketplace for Northern Pakistan: plan multi-day tours, or match with a
            verified operator in real time — on top of a live road, weather and permit layer.
          </p>
        </div>
        <FooterCol title="Product" links={[['Explore packages', '/explore'], ['Instant match', '/instant'], ['Live conditions', '/conditions'], ['AI assistant', '/assistant']]} />
        <FooterCol title="Operators" links={[['Operator console', '/operator'], ['Verification', '/conditions'], ...(apiDocsUrl ? [['API reference', apiDocsUrl]] : [])]} />
        <DataSources />
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-3 border-t border-white/[.06] pt-6 text-[12px] text-frost-400 sm:flex-row">
        <span>© {new Date().getFullYear()} Northern Trails · Final Year Project prototype</span>
        <span className="flex items-center gap-2"><Github className="h-3.5 w-3.5" /> FastAPI · React · WebSockets · Gemini</span>
      </div>
    </footer>
  )
}

/**
 * The data sources, with their real status.
 *
 * This list used to name four feeds as though all four were wired up. Two
 * of them cannot be reached from a server at all — NHA sits behind a
 * Cloudflare CAPTCHA, and no district or tourism registry publishes a
 * machine-readable feed. Listing them flat implied a freshness the app
 * could not deliver, which is the one thing a live-conditions product must
 * not do. Each entry now carries what it actually is.
 */
const SOURCES = [
  ['Open-Meteo', 'weather + forecast', 'live'],
  ['OpenWeatherMap', 'second opinion, cross-checked', 'key'],
  ['GDACS (UN/JRC)', 'floods, GLOF, hazards', 'live'],
  ['USGS', 'earthquakes near routes', 'live'],
  ['PMD', 'tourist-region advisory', 'live'],
  ['OSRM', 'road distance + ETA', 'live'],
  ['NHA road advisories', 'blocked by Cloudflare', 'blocked'],
  ['District / tourism registries', 'no public feed exists', 'manual'],
]

const DOT = {
  live: 'bg-glacier-300',
  key: 'bg-amberz-300/70',
  blocked: 'bg-rose-400/70',
  manual: 'bg-frost-400/50',
}

function DataSources() {
  return (
    <div>
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">
        Data sources
      </h4>
      <ul className="space-y-2 text-[13px] text-frost-300">
        {SOURCES.map(([name, what, state]) => (
          <li key={name} className="flex items-start gap-2 leading-snug">
            <span
              title={state === 'live' ? 'Fetched live' :
                     state === 'key' ? 'Active once an API key is set' :
                     state === 'blocked' ? 'Reachable only via an official feed' :
                     'Verified by hand — no public registry to query'}
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]} ${
                state === 'live' ? 'animate-pulse' : ''}`}
            />
            <span className="min-w-0">
              <span className={state === 'live' ? 'text-frost-200' : 'text-frost-400'}>{name}</span>
              <span className="block text-[11px] text-frost-400">{what}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FooterCol({ title, links }) {
  return (
    <div>
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">{title}</h4>
      <ul className="space-y-2 text-[13px]">
        {links.map(([label, to]) => (
          <li key={to}>
            {/* absolute URLs and /api paths leave the SPA router */}
            {/^https?:\/\//.test(to) || to.startsWith('/api') ? (
              <a href={to} target="_blank" rel="noreferrer"
                 className="text-frost-300 transition hover:text-glacier-300">{label}</a>
            ) : (
              <Link to={to} className="text-frost-300 transition hover:text-glacier-300">{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
