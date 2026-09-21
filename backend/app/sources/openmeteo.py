"""Open-Meteo weather — the default live weather source.

Chosen over OpenWeatherMap as the default for one reason: it needs no API
key, so a fresh clone has genuinely live weather with nothing to sign up
for. OpenWeatherMap stays supported and takes priority when
OPENWEATHER_API_KEY is set.

Open-Meteo also reports elevation per point, which matters here: Khunjerab
is at 4,693 m and its weather has nothing to do with Gilgit's at 1,500 m.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx

from ..geo import CITY_COORDS
from .base import Source

ENDPOINT = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes -> (label, icon)
WMO: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "sun"),
    1: ("Mainly clear", "sun"),
    2: ("Partly cloudy", "cloud-sun"),
    3: ("Overcast", "cloud"),
    45: ("Fog", "fog"), 48: ("Depositing rime fog", "fog"),
    51: ("Light drizzle", "rain"), 53: ("Drizzle", "rain"), 55: ("Dense drizzle", "rain"),
    56: ("Freezing drizzle", "rain"), 57: ("Freezing drizzle", "rain"),
    61: ("Light rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"), 67: ("Freezing rain", "rain"),
    71: ("Light snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"), 81: ("Rain showers", "rain"), 82: ("Violent rain showers", "rain"),
    85: ("Snow showers", "snow"), 86: ("Heavy snow showers", "snow"),
    95: ("Thunderstorm", "storm"), 96: ("Thunderstorm with hail", "storm"),
    99: ("Thunderstorm with hail", "storm"),
}

#: Codes that make a mountain road genuinely harder to drive.
HAZARDOUS = {56, 57, 65, 66, 67, 71, 73, 75, 77, 82, 85, 86, 95, 96, 99}


def describe(code: int) -> tuple[str, str]:
    return WMO.get(int(code), ("Unknown", "cloud"))


class OpenMeteoSource(Source):
    name = "open-meteo"
    source_url = "https://open-meteo.com"
    #: cities that failed on the most recent cycle
    partial: list[str] = []

    def __init__(self, cities: list[str] | None = None):
        self.cities = cities or [
            "Karimabad (Hunza)", "Skardu", "Khunjerab Pass",
            "Chitral", "Deosai Plains", "Fairy Meadows",
        ]

    async def _city(self, client: httpx.AsyncClient, city: str) -> dict:
        lat, lon = CITY_COORDS[city]
        resp = await client.get(ENDPOINT, params={
            "latitude": lat, "longitude": lon,
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                       "wind_speed_10m,visibility,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min,weather_code",
            "timezone": "Asia/Karachi",
            "forecast_days": 4,
        })
        resp.raise_for_status()
        payload = resp.json()
        cur = payload.get("current", {})
        code = cur.get("weather_code", 0)
        label, icon = describe(code)

        forecast = []
        daily = payload.get("daily", {})
        days = daily.get("time", [])[1:4]          # skip today
        for i, iso_day in enumerate(days, start=1):
            try:
                name = datetime.fromisoformat(iso_day).strftime("%a")
            except ValueError:
                name = iso_day
            d_label, d_icon = describe(daily.get("weather_code", [0])[i])
            forecast.append((
                name,
                round(daily.get("temperature_2m_max", [0])[i]),
                round(daily.get("temperature_2m_min", [0])[i]),
                d_icon,
            ))

        visibility_m = cur.get("visibility")
        return {
            "city": city,
            "temp_c": round(cur.get("temperature_2m", 0)),
            "feels_c": round(cur.get("apparent_temperature", cur.get("temperature_2m", 0))),
            "condition": label,
            "icon": icon,
            "wind_kmh": round(cur.get("wind_speed_10m", 0)),
            "humidity": round(cur.get("relative_humidity_2m", 0)),
            "visibility_km": round(visibility_m / 1000) if visibility_m else 10,
            "forecast": forecast,
            "lat": lat,
            "lon": lon,
            "elevation_m": round(payload.get("elevation", 0)),
            "driving_hazard": int(code) in HAZARDOUS,
            "source": "Open-Meteo",
            "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        # Open-Meteo's free tier rate-limits bursts. Firing all six cities at
        # once silently loses one or two, so cap concurrency and retry a
        # throttled city once before giving up on it.
        gate = asyncio.Semaphore(2)

        async def one(city: str):
            async with gate:
                for attempt in (0, 1):
                    try:
                        return await self._city(client, city)
                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code == 429 and attempt == 0:
                            await asyncio.sleep(1.5)
                            continue
                        raise
                return None

        results = await asyncio.gather(*(one(c) for c in self.cities),
                                       return_exceptions=True)
        rows, failures, first_error = [], [], None
        for city, res in zip(self.cities, results):
            if isinstance(res, Exception) or res is None:
                failures.append(city)
                first_error = first_error or res
                continue
            rows.append(res)
        if not rows and first_error:
            raise first_error
        if failures:
            # Partial coverage is worth knowing about; the seeded rows for
            # these cities stay in place.
            self.partial = failures
        return rows
