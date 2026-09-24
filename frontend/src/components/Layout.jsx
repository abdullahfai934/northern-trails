import React, { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AuthButton } from './SignIn'
import { apiDocsUrl } from '../lib/api'
import { useTheme } from '../lib/theme'
import { useWishlist } from '../lib/wishlist'
import { useLanguage, useT } from '../lib/i18n'
import { AnimatePresence, motion, useScroll, useSpring } from 'framer-motion'
import {
  Compass, Zap, Radio, Sparkles, LayoutDashboard, Mountain, Github, Wand2, Heart, Sun, Moon,
  Map as MapIcon, Calculator, Siren, Code2, ChevronDown, MoreHorizontal, Languages,
} from 'lucide-react'
import { Sheet, ease } from './ui'

const NAV = [
  { to: '/plan',       label: 'Plan',       icon: Wand2 },
  { to: '/explore',    label: 'Explore',    icon: Compass },
  { to: '/instant',    label: 'Instant',    icon: Zap },
  { to: '/conditions', label: 'Conditions', icon: Radio },
  { to: '/assistant',  label: 'Assistant',  icon: Sparkles },
  { to: '/operator',   label: 'Operator',   icon: LayoutDashboard },
]

const MORE = [
  { to: '/map',        label: 'Interactive map',  icon: MapIcon,    sub: 'Hospitals, fuel, police, closures' },
  { to: '/budget',     label: 'Budget calculator', icon: Calculator, sub: 'Transport, hotels, food, fees' },
  { to: '/sos',        label: 'Emergency SOS',    icon: Siren,      sub: 'Rescue 1122 and share location' },
  { to: '/developers', label: 'Developer API',    icon: Code2,      sub: 'Public REST API and keys' },
]

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const x = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 })
  return (
    <motion.div
      style={{ scaleX: x }}
      className="fixed inset-x-0 top-0 z-[80] h-[2px] origin-left bg-gradient-to-r from-glacier-300 via-glacier-400 to-amberz-400 rtl:origin-right rtl:bg-gradient-to-l"
    />
  )
}

function MoreMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const ref = useRef(null)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  const active = MORE.some((m) => pathname.startsWith(m.to))
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors
          ${active || open ? 'text-frost-50' : 'text-frost-300 hover:text-frost-100'}`}>
        {t('More')} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease }}
            className="glass-strong absolute start-0 top-11 z-[90] w-72 rounded-2xl p-1.5">
            {MORE.map(({ to, label, icon: Icon, sub }) => (
              <Link key={to} to={to} role="menuitem"
                className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[.05]">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-glacier-400/10 text-glacier-300"><Icon className="h-4 w-4" /></span>
                <span>
                  <span className="block text-[13px] font-semibold text-frost-50">{t(label)}</span>
                  <span className="block text-[11.5px] text-frost-400">{t(sub)}</span>
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LanguageToggle() {
  const { isUrdu, setLanguage } = useLanguage()
  return (
    <button onClick={() => setLanguage(isUrdu ? 'en' : 'ur')}
      aria-label={isUrdu ? 'Switch to English' : 'اردو میں دیکھیں'} title={isUrdu ? 'English' : 'اردو'}
      className="flex h-9 items-center gap-1 rounded-lg border border-white/10 px-2 text-[12px] font-semibold text-frost-200 transition hover:bg-white/[.06] hover:text-frost-50">
      <Languages className="hidden h-3.5 w-3.5 2xl:block" /> <span className={isUrdu ? '' : 'font-urdu'}>{isUrdu ? 'EN' : 'اردو'}</span>
    </button>
  )
}

export function TopNav() {
  const t = useT()
  const [solid, setSolid] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease }}
      className={`fixed inset-x-0 top-0 z-[75] transition-[background-color,border-color,backdrop-filter] duration-500
      ${solid ? 'border-b border-white/[.06] bg-ink-950/75 backdrop-blur-xl' : 'border-b border-transparent'}
      ${!solid && pathname === '/' ? 'on-photo' : ''}`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link to="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glacier-400/90 to-amberz-400/80 text-abyss shadow-glow">
            <Mountain className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-[15px] font-semibold tracking-normal text-frost-50">Northern Trails</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[.18em] text-frost-400 2xl:block">Gilgit-Baltistan · Chitral</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 xl:flex" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to)
            return (
              <NavLink key={to} to={to}
                className={`relative rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors
                  ${active ? 'text-frost-50' : 'text-frost-300 hover:text-frost-100'}`}>
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-white/[.06] ring-1 ring-white/[.06]"
                    transition={{ duration: 0.45, ease }} />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" /> {t(label)}
                </span>
              </NavLink>
            )
          })}
          <MoreMenu />
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link to="/developers"
            className={`hidden h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition md:flex
              ${pathname.startsWith('/developers') ? 'border-glacier-400/40 text-frost-50' : 'border-white/10 text-frost-300 hover:bg-white/[.06] hover:text-frost-50'}`}>
            <Code2 className="h-3.5 w-3.5" /> API
          </Link>
          <LanguageToggle />
          <WishlistLink />
          <ThemeToggle />
          <AuthButton />
          <Link to="/instant" className="btn-primary !hidden whitespace-nowrap !px-4 !py-2 !text-[13px] sm:!inline-flex">
            <Zap className="h-3.5 w-3.5" /> {t('Get a ride')}
          </Link>
        </div>
      </div>
    </motion.header>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}
      className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg border border-white/10 text-frost-200 transition hover:bg-white/[.06] hover:text-frost-50">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 14, opacity: 0, rotate: -40 }} animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 40 }} transition={{ duration: 0.25 }}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

function WishlistLink() {
  const { ids } = useWishlist()
  return (
    <Link to="/wishlist" aria-label={`Wishlist, ${ids.length} saved`} title="Wishlist"
      className="relative grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-frost-200 transition hover:bg-white/[.06] hover:text-frost-50">
      <Heart className={`h-4 w-4 ${ids.length ? 'fill-rose-400 text-rose-400' : ''}`} />
      <AnimatePresence>
        {ids.length > 0 && (
          <motion.span key={ids.length} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-snow">
            {ids.length}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

/** Mobile tab bar: the five main sections, and "More" for everything else. */
export function BottomTabs() {
  const t = useT()
  const { pathname } = useLocation()
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [pathname])
  const tabs = NAV.filter((n) => n.to !== '/operator')
  const moreItems = [...MORE, NAV.find((n) => n.to === '/operator')]
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-[75] xl:hidden" aria-label="Sections">
        <div className="mx-3 mb-3 flex items-center justify-around rounded-2xl border border-white/[.07] bg-ink-900/90 px-1.5 py-1.5 backdrop-blur-2xl shadow-lift">
          {tabs.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to)
            return (
              <NavLink key={to} to={to} className="relative flex-1 py-2 text-center">
                {active && (
                  <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-white/[.07]"
                    transition={{ duration: 0.4, ease }} />
                )}
                <span className={`relative flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors
                  ${active ? 'text-glacier-300' : 'text-frost-400'}`}>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.5 : 2} />
                  {t(label)}
                </span>
              </NavLink>
            )
          })}
          <button onClick={() => setMore(true)} className="relative flex-1 py-2 text-center" aria-label={t('More')}>
            <span className="flex flex-col items-center gap-1 text-[10px] font-semibold text-frost-400">
              <MoreHorizontal className="h-[18px] w-[18px]" /> {t('More')}
            </span>
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title={t('More')} side="bottom">
        <div className="grid gap-1.5 pb-4">
          {moreItems.map(({ to, label, icon: Icon, sub }) => (
            <Link key={to} to={to} className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-white/[.05]">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-glacier-400/10 text-glacier-300"><Icon className="h-4 w-4" /></span>
              <span>
                <span className="block text-[14px] font-semibold text-frost-50">{t(label)}</span>
                {sub && <span className="block text-[12px] text-frost-400">{t(sub)}</span>}
              </span>
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  )
}

export function Footer() {
  // The columns fold down into place (a 3D hinge along their top edge) as the
  // footer scrolls into view. CSS transitions in index.css, .nt-fold.
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setOpen(true); return undefined }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOpen(true); io.disconnect() } }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <footer ref={ref} className="relative mt-28 border-t border-white/[.07] px-5 pb-28 pt-14 sm:px-8 lg:pb-14">
      <div className={`nt-fold mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4 ${open ? 'nt-fold-open' : ''}`}>
        <div>
          <div className="mb-3 flex items-center gap-2 text-frost-50">
            <Mountain className="h-4 w-4 text-glacier-300" />
            <span className="font-extrabold tracking-tight">Northern Trails</span>
          </div>
          <p className="max-w-xs text-[13px] leading-relaxed text-frost-400">
            A hybrid marketplace for Northern Pakistan: plan multi-day tours, or match with a
            verified operator in real time, on top of a live road, weather and permit layer.
          </p>
        </div>
        <FooterCol title="Product" links={[['Explore packages', '/explore'], ['Plan a trip', '/plan'], ['Interactive map', '/map'], ['Budget calculator', '/budget'], ['Live conditions', '/conditions'], ['AI assistant', '/assistant'], ['Emergency SOS', '/sos']]} />
        <FooterCol title="Operators" links={[['Operator console', '/operator'], ['Admin dashboard', '/admin'], ['Developer API', '/developers'], ...(apiDocsUrl ? [['Swagger reference', apiDocsUrl]] : [])]} />
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
                     'Verified by hand, no public registry to query'}
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
  const t = useT()
  return (
    <div>
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[.18em] text-frost-400">{t(title)}</h4>
      <ul className="space-y-2 text-[13px]">
        {links.map(([label, to]) => (
          <li key={to}>
            {/* absolute URLs and /api paths leave the SPA router */}
            {/^https?:\/\//.test(to) || to.startsWith('/api') ? (
              <a href={to} target="_blank" rel="noreferrer"
                 className="text-frost-300 transition hover:text-glacier-300">{t(label)}</a>
            ) : (
              <Link to={to} className="text-frost-300 transition hover:text-glacier-300">{t(label)}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
