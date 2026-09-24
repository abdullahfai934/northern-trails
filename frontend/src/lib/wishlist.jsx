import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'

/**
 * Saved packages.
 *
 * Saving needs an account: the list lives on the user's profile so it
 * follows them across devices. A copy is kept in this browser so it shows
 * instantly and offline. Stored as package ids, not copies, so a saved trip
 * always shows its current price; ids whose package was removed are skipped.
 */
const KEY = 'nt-wishlist'
const Ctx = createContext(null)
export const useWishlist = () => useContext(Ctx)

function load() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

export function WishlistProvider({ children }) {
  const auth = useAuth()
  const [ids, setIds] = useState(load)
  const synced = useRef('')

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* storage full or blocked */ }
  }, [ids])

  // On sign-in, merge what this browser had with the account's list.
  useEffect(() => {
    if (!auth?.profile || synced.current === auth.uid) return
    synced.current = auth.uid
    const merged = [...new Set([...(auth.profile.wishlist || []), ...load()])]
    setIds(merged)
    if (merged.length !== (auth.profile.wishlist || []).length) api.setWishlist(merged).catch(() => {})
  }, [auth?.profile, auth?.uid])

  useEffect(() => { if (!auth?.signedIn) synced.current = '' }, [auth?.signedIn])

  /** true = added, false = removed, null = sign-in requested first. */
  const toggle = useCallback((id) => {
    if (!auth?.signedIn) {
      auth?.requireAuth(() => {}, 'Sign in to save trips to your wishlist')
      return null
    }
    const added = !ids.includes(id)
    const next = added ? [id, ...ids.filter((x) => x !== id)] : ids.filter((x) => x !== id)
    setIds(next)
    api.setWishlist(next).catch(() => {})
    return added
  }, [ids, auth])

  const value = useMemo(() => ({
    ids,
    has: (id) => ids.includes(id),
    toggle,
    clear: () => { setIds([]); if (auth?.signedIn) api.setWishlist([]).catch(() => {}) },
  }), [ids, toggle, auth?.signedIn])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
