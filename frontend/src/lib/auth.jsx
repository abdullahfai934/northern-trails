import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, setTokenProvider } from './api'
import * as fb from './firebase'

/**
 * Phone-OTP session state.
 *
 * Firebase is optional: when it is not configured this provider settles
 * immediately with `configured: false` and every consumer renders its
 * signed-out branch. No screen is ever blocked on auth.
 */
const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(!fb.configured)
  const [pushToken, setPushToken] = useState('')
  const registered = useRef(false)

  // Let the API layer attach a Bearer token without importing Firebase.
  useEffect(() => { setTokenProvider(() => fb.idToken()) }, [])

  useEffect(() => {
    if (!fb.configured) return undefined
    let unsub = () => {}
    let alive = true
    fb.onUser((u) => {
      if (!alive) return
      setUser(u)
      setReady(true)
    }).then((fn) => { if (typeof fn === 'function') unsub = fn })
    return () => { alive = false; unsub() }
  }, [])

  // Once signed in, register this device for condition-change pushes.
  useEffect(() => {
    if (!user || registered.current) return
    registered.current = true
    ;(async () => {
      const token = await fb.requestPushToken()
      if (!token) return
      setPushToken(token)
      try {
        await api.registerDevice({ token, platform: 'web', watch_routes: [] })
      } catch (err) {
        console.warn('device registration failed:', err.message)
      }
      // The service worker needs the config to handle background pushes.
      navigator.serviceWorker?.ready?.then((reg) => {
        reg.active?.postMessage({
          type: 'FIREBASE_CONFIG',
          config: {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          },
        })
      })
    })()
  }, [user])

  const signOut = useCallback(async () => {
    await fb.signOut()
    setUser(null)
    registered.current = false
  }, [])

  const value = {
    configured: fb.configured,
    ready,
    user,
    pushToken,
    signedIn: !!user,
    phone: user?.phoneNumber || '',
    uid: user?.uid || '',
    sendOtp: fb.sendOtp,
    confirmCode: fb.confirmCode,
    signOut,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
