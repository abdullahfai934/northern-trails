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

/** Every route slides in from the right and out to the left — one continuous surface. */
const pageVariants = {
  initial: { opacity: 0, x: 42, filter: 'blur(8px)' },
  enter:   { opacity: 1, x: 0,  filter: 'blur(0px)', transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, x: -32, filter: 'blur(8px)', transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } },
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
              <Route path="/pay/return"       element={<Page><PayReturn /></Page>} />
              <Route path="*"                 element={<Page><Home /></Page>} />
            </Routes>
          </AnimatePresence>
          <Footer />
        </div>
        <BottomTabs />
      </PackageActionsProvider>
      </ToastHost>
      </WishlistProvider>
      </AuthProvider>
    </DataProvider>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
