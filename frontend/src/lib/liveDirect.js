/**
 * Live data fetched straight from the browser.
 *
 * When the SPA is hosted statically with no backend reachable, most of the
 * product's value — current weather, recent earthquakes, real road
 * distances — does not actually need our server. Open-Meteo, USGS and OSRM
 * all send `Access-Control-Allow-Origin: *`, so the page can call them
 * itself and show genuinely current conditions instead of a stale sample.
 *
 * What still needs the backend: the grounded assistant, ride matching over
 * WebSockets, bookings and payments. Those depend on server state, not just
 * on public data.
 *
 * GDACS is deliberately absent — its RSS feed sends no CORS header, so the
 * browser cannot read it. Seeded hazard rows stand in, still labelled.
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
const OSRM = 'https://router.project-osrm.org/route/v1/driving'

export const CITY_COORDS = {
  'Karimabad (Hunza)': [36.3167, 74.6667],
  Skardu: [35.2971, 75.6333],
  'Khunjerab Pass': [36.8508, 75.4269],
  Chitral: [35.8511, 71.7864],
  'Deosai Plains': [34.9667, 75.0],
  'Fairy Meadows': [35.3878, 74.5783],
  Gilgit: [35.9208, 74.3144],
  Passu: [36.4667, 74.8667],
  Khaplu: [35.1667, 76.3333],
  Chilas: [35.4167, 74.1],
  'Raikot Bridge': [35.4333, 74.5833],
  Astore: [35.3667, 74.85],
  Naltar: [36.1667, 74.1833],
  'Attabad Lake': [36.34, 74.865],
  Deosai: [34.9667, 75.0],
}

/** WMO weather codes → the icon vocabulary the cards already use. */
const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud-sun'],
  3: ['Overcast', 'cloud'], 45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Dense drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'], 80: ['Rain showers', 'rain'], 81: ['Rain showers', 'rain'],
  82: ['Violent showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm, hail', 'storm'], 99: ['Thunderstorm, hail', 'storm'],
}
const HAZARDOUS = new Set([56, 57, 65, 66, 67, 71, 73, 75, 77, 82, 85, 86, 95, 96, 99])

const describe = (code) => WMO[code] || ['Unknown', 'cloud']

function visibilityKm(metres) {
  if (!metres) return 10
  const km = metres / 1000
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km)
}

/** Open-Meteo rate-limits bursts, so cities go out a couple at a time. */
async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        try { out[idx] = await fn(items[idx]) } catch { out[idx] = null }
      }
    }),
  )
  return out.filter(Boolean)
}

export async function fetchWeather(cities) {
  const wanted = cities.filter((c) => CITY_COORDS[c])
  return mapLimit(wanted, 2, async (city) => {
    const [lat, lon] = CITY_COORDS[city]
    const params = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,visibility,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code',
      timezone: 'Asia/Karachi', forecast_days: '4',
    })
    const res = await fetch(`${OPEN_METEO}?${params}`)
    if (!res.ok) throw new Error(`open-meteo ${res.status}`)
    const d = await res.json()
    const cur = d.current || {}
    const code = cur.weather_code ?? 0
    const [condition, icon] = describe(code)

    const forecast = []
    const daily = d.daily || {}
    for (let i = 1; i <= 3 && daily.time?.[i]; i++) {
      const day = new Date(daily.time[i]).toLocaleDateString('en', { weekday: 'short' })
      forecast.push([day, Math.round(daily.temperature_2m_max[i]),
        Math.round(daily.temperature_2m_min[i]), describe(daily.weather_code[i])[1]])
    }

    return {
      city,
      temp_c: Math.round(cur.temperature_2m ?? 0),
      feels_c: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
      condition,
      icon,
      wind_kmh: Math.round(cur.wind_speed_10m ?? 0),
      humidity: Math.round(cur.relative_humidity_2m ?? 0),
      // Sub-kilometre visibility must not round to "0 km" — on a pass
      // that is the most important number on the card, not missing data.
      visibility_km: visibilityKm(cur.visibility),
      forecast,
      elevation_m: Math.round(d.elevation ?? 0),
      driving_hazard: HAZARDOUS.has(code),
      origin: 'open-meteo',
      source: 'Open-Meteo (fetched in your browser)',
      updated_at: new Date().toISOString(),
    }
  })
}

/** Recent quakes near the tracked corridor — they trigger the rockfall. */
export async function fetchQuakes() {
  const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10)
  const params = new URLSearchParams({
    format: 'geojson', minlatitude: '34', maxlatitude: '37.5',
    minlongitude: '70.5', maxlongitude: '77.5',
    starttime: since, minmagnitude: '4.0', orderby: 'time',
  })
  const res = await fetch(`${USGS}?${params}`)
  if (!res.ok) throw new Error(`usgs ${res.status}`)
  const d = await res.json()
  return (d.features || []).map((f) => {
    const p = f.properties || {}
    const mag = p.mag ?? 0
    return {
      id: `usgs-${f.id}`,
      severity: mag >= 5.5 ? 'high' : mag >= 4.5 ? 'medium' : 'low',
      kind: 'Earthquake',
      title: `M${mag} earthquake near ${p.place || 'Northern Pakistan'}`,
      body: `Magnitude ${mag}. Recent seismic activity raises rockfall and landslide `
          + 'risk on nearby mountain roads, so check road status before travelling.',
      routes: [],
      source: 'USGS Earthquake Hazards Program',
      source_url: p.url || '',
      issued_at: new Date(p.time || Date.now()).toISOString(),
      origin: 'usgs',
    }
  })
}

/** Real driving distance and duration, so a fare is measured not guessed. */
export async function fetchRoute(pickup, dropoff) {
  const a = CITY_COORDS[pickup]
  const b = CITY_COORDS[dropoff]
  if (!a || !b) return null
  // The public OSRM demo server drops roughly one request in three.
  let d = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${OSRM}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false`)
      if (!res.ok) throw new Error(`osrm ${res.status}`)
      d = await res.json()
      break
    } catch (err) {
      if (attempt === 2) return null
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  const route = (d?.routes || [])[0]
  if (!route) return null
  return {
    distance_km: Math.round(route.distance / 100) / 10,
    duration_min: Math.round(route.duration / 60),
    route_method: 'osrm',
    route_note: 'Measured over the real road network (OSRM), fetched in your browser.',
  }
}
