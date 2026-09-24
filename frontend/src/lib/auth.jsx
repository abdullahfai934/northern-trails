import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, setTokenProvider } from './api'
import * as fb from './firebase'

/**
 * Session state: the Firebase user, their Northern Trails profile (role,
 * operator link, emergency contact, wishlist) and the one sign-in sheet.
 *
 * `requireAuth(action)` runs `action` straight away when signed in, and
 * otherwise opens the sign-in sheet and runs it after a successful sign-in —
 * so "Book now" or the wishlist heart simply carry on where the user was.
 */
const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(!fb.configured)
  const [profileError, setProfileError] = useState('')
  const [sheet, setSheet] = useState({ open: false, reason: '' })
  const pending = useRef(null)

  // Until the session restore below has started, calls go out anonymously
  // (signed-in pages wait for `ready` anyway), so the first API request does
  // not pull the Firebase SDK into the first paint.
  const started = useRef(false)
  useEffect(() => { setTokenProvider(() => (started.current ? fb.idToken() : '')) }, [])

  const loadProfile = useCallback(async () => {
    try {
      const p = await api.me()
      setProfile(p)
      setProfileError('')
      return p
    } catch (e) {
      setProfileError(e.message)
      return null
    }
  }, [])

  useEffect(() => {
    if (!fb.configured) return undefined
    let unsub = () => {}
    let alive = true
    // Restoring a session loads the Firebase SDK, so wait until the first
    // paint is done; it still runs within a second or two of load.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300))
    const cancel = window.cancelIdleCallback || clearTimeout
    const handle = idle(() => {
      started.current = true
      fb.onUser(async (u) => {
        if (!alive) return
        setUser(u)
        if (u) await loadProfile()
        else setProfile(null)
        setReady(true)
      }).then((fn) => { if (typeof fn === 'function') { if (alive) unsub = fn; else fn() } })
    }, { timeout: 2000 })
    return () => { alive = false; cancel(handle); unsub() }
  }, [loadProfile])

  // After sign-in, finish what the user was doing before they were asked.
  useEffect(() => {
    if (user && pending.current) {
      const fn = pending.current
      pending.current = null
      setSheet({ open: false, reason: '' })
      setTimeout(fn, 250)
    }
  }, [user])

  // Reuse an existing notification grant silently; never prompt here.
  useEffect(() => {
    if (!user) return
    fb.requestPushToken({ ask: false }).then((token) => {
      if (token) api.registerDevice({ token, platform: 'web', watch_routes: [] }).catch(() => {})
    })
  }, [user])

  const openSignIn = useCallback((reason = '') => setSheet({ open: true, reason }), [])
  const closeSignIn = useCallback(() => { pending.current = null; setSheet({ open: false, reason: '' }) }, [])

  const requireAuth = useCallback((action, reason = 'Sign in to continue') => {
    if (user) { action?.(); return true }
    pending.current = action || null
    setSheet({ open: true, reason })
    return false
  }, [user])

  const signOut = useCallback(async () => {
    await fb.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  /** Ask for notification permission and register this device for alerts. */
  const enablePush = useCallback(async () => {
    const token = await fb.requestPushToken({ ask: true })
    if (!token) return false
    await api.registerDevice({ token, platform: 'web', watch_routes: [] })
    return true
  }, [])

  const role = profile?.role || (user ? 'tourist' : 'guest')
  const value = {
    configured: fb.configured,
    ready,
    user,
    profile,
    profileError,
    role,
    isAdmin: role === 'admin',
    isOperator: role === 'operator' || role === 'admin',
    signedIn: !!user,
    uid: user?.uid || '',
    displayName: profile?.name || user?.displayName || user?.email?.split('@')[0] || user?.phoneNumber || '',
    photoURL: user?.photoURL || '',
    sheet, openSignIn, closeSignIn, requireAuth,
    refreshProfile: loadProfile,
    setProfile,
    enablePush,
    signOut,
    // raw sign-in methods, used by the sheet
    sendOtp: fb.sendOtp,
    confirmCode: fb.confirmCode,
    signUpEmail: fb.signUpEmail,
    signInEmail: fb.signInEmail,
    signInGoogle: fb.signInGoogle,
    resetPassword: fb.resetPassword,
    resendVerification: fb.resendVerification,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
