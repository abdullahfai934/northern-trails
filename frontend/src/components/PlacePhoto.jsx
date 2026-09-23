import React, { useEffect, useMemo, useState } from 'react'
import { Mountain } from 'lucide-react'
import { usePhotos } from '../lib/photos'
import { assetUrl } from '../lib/api'

const NONE = []

/** A stable hue per place, so a placeholder looks the same on every visit. */
function hueFor(text = '') {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Shown when there is no photo to show. Never an empty box, never a broken image. */
export function PhotoPlaceholder({ name, className = '', compact = false }) {
  const h = hueFor(name)
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, hsl(${h} 70% 62% / .55), transparent 60%),
                     radial-gradient(90% 80% at 90% 100%, hsl(${(h + 50) % 360} 75% 55% / .45), transparent 60%),
                     linear-gradient(160deg, hsl(${(h + 200) % 360} 45% 18%), hsl(${(h + 230) % 360} 50% 10%))`,
      }}
      role="img"
      aria-label={name ? `${name} (no photo available)` : 'No photo available'}
    >
      <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-1/2 w-full opacity-40" aria-hidden="true">
        <path d="M0 120 L0 80 L60 40 L100 70 L150 20 L210 75 L260 45 L320 85 L360 60 L400 80 L400 120 Z" fill="rgba(255,255,255,.18)" />
        <path d="M0 120 L0 95 L80 70 L140 95 L200 60 L270 100 L340 75 L400 95 L400 120 Z" fill="rgba(0,0,0,.28)" />
      </svg>
      {!compact && (
        <div className="relative flex flex-col items-center gap-1.5 px-4 text-center">
          <Mountain className="h-6 w-6 text-snow/80" strokeWidth={1.6} />
          <span className="font-display text-lg font-semibold tracking-tight text-snow drop-shadow">{name}</span>
        </div>
      )}
    </div>
  )
}

/**
 * A photo of a place.
 *
 * Uses the package's own images first (uploaded or pasted in the admin
 * screen), then photos looked up by `query`. If an image fails to load the
 * next one is tried; when none are left the gradient placeholder shows.
 */
export default function PlacePhoto({
  query, name, images = NONE, index = 0, className = '', imgClassName = '',
  eager = false, large = false, credit = false, count = 6, onPhotos,
}) {
  const { items, status } = usePhotos(query, count)
  const [failed, setFailed] = useState(() => new Set())
  const [loadedSrc, setLoadedSrc] = useState('')

  const list = useMemo(() => {
    const own = (images || []).filter(Boolean).map((u, i) => ({
      id: `own-${i}`, url: assetUrl(u), thumb: assetUrl(u), alt: name, credit: '', source: 'operator',
    }))
    return [...own, ...items].filter((p) => !failed.has(p.id))
  }, [images, items, failed, name])

  useEffect(() => { onPhotos?.(list) }, [list, onPhotos])

  const photo = list.length ? list[index % list.length] : null
  const src = photo ? (large ? photo.url : photo.thumb || photo.url) : ''
  const waiting = !photo && status === 'loading' && !(images || []).length

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* The placeholder sits underneath, so a slow photo fades in over it. */}
      <PhotoPlaceholder name={name} compact={Boolean(photo) || waiting} className="absolute inset-0" />
      {waiting && (
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-snow/10 to-transparent" />
      )}
      {photo && (
        <img
          key={src}
          src={src}
          alt={photo.alt || name || ''}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable="false"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailed((f) => new Set(f).add(photo.id))}
          className={`absolute inset-0 h-full w-full select-none object-cover transition-[opacity,transform] duration-700 ease-out
            ${loadedSrc === src ? 'scale-100 opacity-100' : 'scale-105 opacity-0'} ${imgClassName}`}
        />
      )}
      {credit && photo?.credit && loadedSrc === src && (
        <a href={photo.credit_url} target="_blank" rel="noreferrer noopener"
           onClick={(e) => e.stopPropagation()}
           className="absolute bottom-2 right-2 z-10 max-w-[70%] truncate rounded-md bg-abyss/55 px-2 py-0.5 text-[9.5px] text-snow/80 backdrop-blur-sm transition hover:text-snow">
          Photo: {photo.credit}{photo.license ? ` · ${photo.license}` : ''}
        </a>
      )}
    </div>
  )
}
