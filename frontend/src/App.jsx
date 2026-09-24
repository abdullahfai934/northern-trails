import React, { Suspense, lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { BottomTabs, Footer, ScrollProgress, TopNav } from './components/Layout'
import { DataProvider } from './lib/store'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { WishlistProvider } from './lib/wishlist'
import { Skeleton, ToastHost } from './components/ui'
import { PackageActionsProvider } from './components/PackageActions'
import ErrorBoundary from './components/ErrorBoundary'

import Home from './pages/Home'
import { SignInSheet } from './components/SignIn'

/* Home ships in the main bundle; every other page is its own chunk, fetched
   when it is first opened (and prefetched once the browser is idle). */
const PAGES = {
  Explore: () => import('./pages/Explore'),
  Plan: () => import('./pages/Plan'),
  PackageDetail: () => import('./pages/PackageDetail'),
  Instant: () => import('./pages/Instant'),
  Conditions: () => import('./pages/Conditions'),
  Assistant: () => import('./pages/Assistant'),
  Operator: () => import('./pages/Operator'),
  PayReturn: () => import('./pages/PayReturn'),
  Wishlist: () => import('./pages/Wishlist'),
  Admin: () => import('./pages/Admin'),
  Profile: () => import('./pages/Profile'),
  Developers: () => import('./pages/Developers'),
  MapPage: () => import('./pages/MapPage'),
  Sos: () => import('./pages/Sos'),
  Budget: () => import('./pages/Budget'),
}
const Explore = lazy(PAGES.Explore)
const Plan = lazy(PAGES.Plan)
const PackageDetail = lazy(PAGES.PackageDetail)
const Instant = lazy(PAGES.Instant)
const Conditions = lazy(PAGES.Conditions)
const Assistant = lazy(PAGES.Assistant)
const Operator = lazy(PAGES.Operator)
const PayReturn = lazy(PAGES.PayReturn)
const Wishlist = lazy(PAGES.Wishlist)
const Admin = lazy(PAGES.Admin)
const Profile = lazy(PAGES.Profile)
const Developers = lazy(PAGES.Developers)
const MapPage = lazy(PAGES.MapPage)
const Sos = lazy(PAGES.Sos)
const Budget = lazy(PAGES.Budget)

function prefetchPages() {
  const run = () => Object.values(PAGES).forEach((load) => load().catch(() => {}))
  // After the first interaction, or a quiet moment well after load, so it
  // never competes with the first paint.
  const start = () => {
    ['pointerdown', 'keydown', 'scroll'].forEach((e) => window.removeEventListener(e, start))
    ;(window.requestIdleCallback || ((f) => setTimeout(f, 200)))(run)
  }
  ;['pointerdown', 'keydown', 'scroll'].forEach((e) => window.addEventListener(e, start, { once: true, passive: true }))
  setTimeout(start, 12000)
}
import { ServerWaking } from './components/ServerWaking'

/** Pages fade and rise into place, and fade out upward — slow, ease-out, never bouncy. */
const pageVariants = {
  initial: { opacity: 0, y: 14 },
  enter:   { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } },
}

function Page({ children }) {
  return (
    <motion.main variants={pageVariants} initial="initial" animate="enter" exit="exit">
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </motion.main>
  )
}

/** Shown for the moment a page's chunk is on its way. */
function PageLoading() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8" aria-busy="true">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="mt-4 h-5 w-1/3" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}
      </div>
    </div>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [pathname])
  return null
}

export default function App() {
  const location = useLocation()
  useEffect(prefetchPages, [])
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <DataProvider>
      <AuthProvider>
      <WishlistProvider>
      <ToastHost>
      <PackageActionsProvider>
        <ScrollProgress />
        <TopNav />
        <ScrollToTop />
        <div className="min-h-screen pt-16">
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/"                 element={<Page><Home /></Page>} />
              <Route path="/plan"             element={<Page><Plan /></Page>} />
              <Route path="/explore"          element={<Page><Explore /></Page>} />
              <Route path="/explore/:id"      element={<Page><PackageDetail /></Page>} />
              <Route path="/instant"          element={<Page><Instant /></Page>} />
              <Route path="/conditions"       element={<Page><Conditions /></Page>} />
              <Route path="/assistant"        element={<Page><Assistant /></Page>} />
              <Route path="/operator"         element={<Page><Operator /></Page>} />
              <Route path="/wishlist"         element={<Page><Wishlist /></Page>} />
              <Route path="/admin"            element={<Page><Admin /></Page>} />
              <Route path="/profile"          element={<Page><Profile /></Page>} />
              <Route path="/developers"       element={<Page><Developers /></Page>} />
              <Route path="/map"              element={<Page><MapPage /></Page>} />
              <Route path="/sos"              element={<Page><Sos /></Page>} />
              <Route path="/budget"           element={<Page><Budget /></Page>} />
              <Route path="/pay/return"       element={<Page><PayReturn /></Page>} />
              <Route path="*"                 element={<Page><Home /></Page>} />
            </Routes>
          </AnimatePresence>
          <Footer />
        </div>
        <BottomTabs />
        <SignInSheet />
        <ServerWaking />
      </PackageActionsProvider>
      </ToastHost>
      </WishlistProvider>
      </AuthProvider>
    </DataProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
