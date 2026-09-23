import React, { useEffect } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

/*
 * Circle markers rather than Leaflet's default pin: the default icon is a
 * PNG that bundlers cannot resolve, which shows up as broken images and 404s
 * in the console.
 */
/*
 * OpenStreetMap's own tiles: free, keyless, and fine for this volume under
 * the OSMF tile policy as long as attribution is shown. Dark mode inverts
 * them with a CSS filter (index.css) rather than switching to a styled
 * provider that needs an API key.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** Fly to whichever restaurant was picked from the list. */
function FlyTo({ selected }) {
  const map = useMap()
  useEffect(() => {
    if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 15), { duration: 0.8 })
  }, [map, selected])
  return null
}

export default function RestaurantMap({ center, items, selected, onSelect, label }) {
  const pts = [[center.lat, center.lon], ...items.slice(0, 12).map((r) => [r.lat, r.lon])]
  const initial = pts.length > 1 ? { bounds: pts, boundsOptions: { padding: [28, 28], maxZoom: 15 } }
                                  : { center: [center.lat, center.lon], zoom: 12 }
  return (
    <MapContainer {...initial} scrollWheelZoom={false} className="h-full w-full" attributionControl>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
      <FlyTo selected={selected} />
      <CircleMarker center={[center.lat, center.lon]} radius={9}
                    pathOptions={{ color: '#f5b73d', weight: 3, fillColor: '#f5b73d', fillOpacity: 0.35 }}>
        <Tooltip direction="top" offset={[0, -8]}>{label}</Tooltip>
      </CircleMarker>
      {items.map((r) => {
        const on = selected?.id === r.id
        return (
          <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={on ? 9 : 6}
                        eventHandlers={{ click: () => onSelect?.(r) }}
                        pathOptions={{ color: on ? '#ffffff' : '#0d8c9c', weight: on ? 3 : 2, fillColor: '#38c9d6', fillOpacity: 0.9 }}>
            <Popup>
              <div className="font-semibold">{r.name}</div>
              <div className="opacity-70">{r.cuisine} · {r.distance_km} km</div>
              <a href={r.directions_url} target="_blank" rel="noreferrer noopener">Get directions →</a>
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
