import React, { Suspense, lazy } from 'react'
import { useT } from '../lib/i18n'
import { Reveal, SectionTitle, Skeleton } from '../components/ui'

// Leaflet is heavy; load it with the page, not with the site.
const InteractiveMap = lazy(() => import('../components/InteractiveMap'))

export default function MapPage() {
  const t = useT()
  return (
    <div className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8">
      <Reveal>
        <SectionTitle eyebrow="Interactive map" title={t('The north, layer by layer.')}
          sub={t('Destinations and packages, road closures, recent earthquakes, and the restaurants, hotels, hospitals, petrol pumps and police stations around wherever you look.')} />
      </Reveal>
      <Suspense fallback={<Skeleton className="h-[70vh] rounded-2xl" />}>
        <InteractiveMap />
      </Suspense>
    </div>
  )
}
