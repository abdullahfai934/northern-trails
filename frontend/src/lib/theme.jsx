import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Light/dark theme.
 *
 * index.html applies the saved (or system) theme before first paint; this
 * provider takes over from there. The choice is stored per browser. Until
 * the visitor picks one, the site follows the operating system setting.
 */
const Ctx = createContext({ theme: 'dark', toggle: () => {} })
export const useTheme = () => useContext(Ctx)

function read() {
  try {
    const t = localStorage.getItem('nt-theme')
    if (t === 'light' || t === 'dark') return t
  } catch { /* storage blocked: fall through to the system setting */ }
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(read)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f6fa' : '#070b14')
  }, [theme])

  // Follow the OS setting live, but only while the visitor has not chosen.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!mq) return undefined
    const onChange = (e) => {
      let saved = null
      try { saved = localStorage.getItem('nt-theme') } catch { /* ignore */ }
      if (!saved) setTheme(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('nt-theme', next) } catch { /* ignore */ }
      return next
    })
  }, [])

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}
