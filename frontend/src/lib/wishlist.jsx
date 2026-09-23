import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Saved packages, kept in this browser.
 *
 * Stored as package ids, not copies, so a saved trip always shows its
 * current price and itinerary. Ids whose package has since been removed are
 * simply skipped when the list is rendered.
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
  const [ids, setIds] = useState(load)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* storage full or blocked */ }
  }, [ids])

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY) setIds(load()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Returns true when the package was added, false when it was removed. */
  const toggle = useCallback((id) => {
    const added = !ids.includes(id)
    setIds((cur) => (added ? [id, ...cur.filter((x) => x !== id)] : cur.filter((x) => x !== id)))
    return added
  }, [ids])

  const value = useMemo(() => ({
    ids,
    has: (id) => ids.includes(id),
    toggle,
    clear: () => setIds([]),
  }), [ids, toggle])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
