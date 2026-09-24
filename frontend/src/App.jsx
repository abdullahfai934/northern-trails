import React, { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { BottomTabs, Footer, ScrollProgress, TopNav } from './components/Layout'
import { DataProvider } from './lib/store'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { WishlistProvider } from './lib/wishlist'
import { ToastHost } from './components/ui'
import { PackageActionsProvider } from './components/PackageActions'
import ErrorBoundary from './components/ErrorBoundary'

import Home from './pages/Home'
import Explore from './pages/Explore'
import Plan from './pages/Plan'
import PackageDetail from './pages/PackageDetail'
import Instant from './pages/Instant'
import Conditions from './pages/Conditions'
import Assistant from './pages/Assistant'
import Operator from './pages/Operator'
import PayReturn from './pages/PayReturn'
import Wishlist from './pages/Wishlist'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import Developers from './pages/Developers'
import MapPage from './pages/MapPage'
import Sos from './pages/Sos'
import Budget from './pages/Budget'
import { SignInSheet } from './components/SignIn'
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
      {children}
    </motion.main>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [pathname])
  return null
}

export default function App() {
  const location = useLocation()
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
