/**
 * Hand-built SVG landscape scenes. Every package and hero panel uses one, so the
 * app ships with real artwork, no external image hosts and no layout shift.
 */
import React from 'react'

const PALETTES = {
  hunza:   { sky: ['#132447', '#2a4f7a', '#f0a868'], far: '#3c6699', mid: '#22405f', near: '#14243a', snow: '#e8f3ff', accent: '#ffd28a' },
  attabad: { sky: ['#0d2a3d', '#12607a', '#7ee0e6'], far: '#1c7d93', mid: '#12566a', near: '#0c3346', snow: '#eafcff', accent: '#7ee0e6' },
  deosai:  { sky: ['#1b1740', '#4a3c7a', '#e5a0c8'], far: '#5b4d8f', mid: '#3a3163', near: '#221c3d', snow: '#f3ecff', accent: '#e5a0c8' },
  fairy:   { sky: ['#0f2038', '#1f4d55', '#9fe0c0'], far: '#2d6f6a', mid: '#1c4a49', near: '#102c2e', snow: '#eafff5', accent: '#9fe0c0' },
  kalash:  { sky: ['#2a1630', '#7a3350', '#ffb27a'], far: '#8f4258', mid: '#5d2c41', near: '#331828', snow: '#ffeede', accent: '#ffb27a' },
  k2:      { sky: ['#071427', '#123457', '#cfe6ff'], far: '#2a5580', mid: '#183a5c', near: '#0b1e33', snow: '#ffffff', accent: '#cfe6ff' },
}

export const sceneNames = Object.keys(PALETTES)

export function Scene({ name = 'hunza', className = '', seed = 0 }) {
  const p = PALETTES[name] || PALETTES.hunza
  const id = `${name}-${seed}`
  return (
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.sky[0]} />
          <stop offset="55%" stopColor={p.sky[1]} />
          <stop offset="100%" stopColor={p.sky[2]} />
        </linearGradient>
        <linearGradient id={`far-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.snow} />
          <stop offset="28%" stopColor={p.far} />
          <stop offset="100%" stopColor={p.mid} />
        </linearGradient>
        <linearGradient id={`near-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.mid} />
          <stop offset="100%" stopColor={p.near} />
        </linearGradient>
        <linearGradient id={`haze-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.accent} stopOpacity=".28" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`sun-${id}`} cx="50%" cy="50%">
          <stop offset="0%" stopColor={p.accent} stopOpacity=".95" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="260" fill={`url(#sky-${id})`} />
      <circle cx={300 - seed * 7} cy="74" r="46" fill={`url(#sun-${id})`} />
      <circle cx={300 - seed * 7} cy="74" r="12" fill={p.snow} opacity=".85" />

      {/* far ridge */}
      <path d="M0 150 L38 104 L62 126 L96 72 L130 118 L164 88 L198 132 L232 96 L268 130 L300 100 L338 136 L370 112 L400 146 L400 260 L0 260 Z"
            fill={`url(#far-${id})`} opacity=".92" />
      {/* snow caps */}
      <path d="M96 72 L82 92 L90 90 L98 98 L106 88 L114 92 Z" fill={p.snow} opacity=".92" />
      <path d="M164 88 L152 106 L160 104 L168 111 L176 101 L182 106 Z" fill={p.snow} opacity=".85" />
      <path d="M300 100 L290 116 L297 114 L304 121 L311 112 Z" fill={p.snow} opacity=".8" />

      {/* mid ridge */}
      <path d="M0 176 L46 142 L86 170 L124 138 L170 176 L214 144 L258 180 L304 148 L348 182 L400 154 L400 260 L0 260 Z"
            fill={`url(#near-${id})`} opacity=".95" />
      <rect y="150" width="400" height="60" fill={`url(#haze-${id})`} />

      {/* valley floor + road */}
      <path d="M0 206 C 80 196, 140 224, 200 212 C 262 200, 320 226, 400 210 L400 260 L0 260 Z" fill={p.near} />
      <path d="M-10 238 C 90 224, 150 252, 210 234 C 280 214, 330 244, 410 228"
            fill="none" stroke={p.accent} strokeOpacity=".5" strokeWidth="2.4" strokeDasharray="10 7" strokeLinecap="round" />
      <ellipse cx="200" cy="258" rx="230" ry="26" fill={p.near} opacity=".8" />
    </svg>
  )
}

export function sceneFor(pkg) {
  return pkg?.hero && PALETTES[pkg.hero] ? pkg.hero : 'hunza'
}
