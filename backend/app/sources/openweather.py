"""OpenWeatherMap poller.

Fills the rows in `data.WEATHER` from the free-tier endpoints:
  /data/2.5/weather   -> current conditions
  /data/2.5/forecast  -> 5 day / 3 hour, collapsed to a daily hi/lo

Output matches the seeded WEATHER shape exactly, so nothing downstream
(assistant context pack, Conditions page) needs to know which mode it is in.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone

import httpx

from ..config import OPENWEATHER_KEY
from ..geo import CITY_COORDS
from .base import Source

CURRENT = "https://api.openweathermap.org/data/2.5/weather"
FORECAST = "https://api.openweathermap.org/data/2.5/forecast"

# OWM condition-code families -> the icon vocabulary the seeded rows use.
def icon_for(code: int, clouds: int = 0) -> str:
    if 200 <= code < 300:
        return "storm"
    if 300 <= code < 600:
        return "rain"
    if 600 <= code < 700:
        return "snow"
    if 700 <= code < 800:
        return "fog"
    if code == 800:
        return "sun"
    if code == 801 or clouds < 60:
        return "cloud-sun"
    return "cloud"


class OpenWeatherSource(Source):
    name = "openweathermap"
    source_url = "https://openweathermap.org"

    def __init__(self, cities: list[str] | None = None):
        # Only the six cities the Conditions page actually renders.
        self.cities = cities or [
            "Karimabad (Hunza)", "Skardu", "Khunjerab Pass",
            "Chitral", "Deosai Plains", "Fairy Meadows",
        ]

    def configured(self) -> bool:
        return bool(OPENWEATHER_KEY)

    async def _city(self, client: httpx.AsyncClient, city: str) -> dict | None:
        lat, lon = CITY_COORDS[city]
        params = {"lat": lat, "lon": lon, "units": "metric", "appid": OPENWEATHER_KEY}

        cur_r, fc_r = await asyncio.gather(
            client.get(CURRENT, params=params),
            client.get(FORECAST, params=params),
            return_exceptions=True,
        )
        if isinstance(cur_r, Exception):
            raise cur_r
        cur_r.raise_for_status()
        cur = cur_r.json()

        weather0 = (cur.get("weather") or [{}])[0]
        main = cur.get("main") or {}
        row = {
            "city": city,
            "temp_c": round(main.get("temp", 0)),
            "feels_c": round(main.get("feels_like", main.get("temp", 0))),
            "condition": (weather0.get("description") or "").capitalize() or "Unknown",
            "icon": icon_for(weather0.get("id", 800), (cur.get("clouds") or {}).get("all", 0)),
            "wind_kmh": round((cur.get("wind") or {}).get("speed", 0) * 3.6),
            "humidity": main.get("humidity", 0),
            "visibility_km": round(cur.get("visibility", 10000) / 1000),
            "forecast": [],
            "lat": lat,
            "lon": lon,
            "source": "OpenWeatherMap",
            "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }

        # Forecast is best-effort: a working `current` row is still useful.
        if not isinstance(fc_r, Exception) and fc_r.status_code == 200:
            buckets: dict[str, list] = defaultdict(list)
            for slot in fc_r.json().get("list", []):
                dt = datetime.fromtimestamp(slot["dt"], tz=timezone.utc)
                buckets[dt.strftime("%a")].append(slot)
            today = datetime.now(timezone.utc).strftime("%a")
            days = [d for d in buckets if d != today][:3]
            for day in days:
                slots = buckets[day]
                temps = [s["main"]["temp"] for s in slots]
                mid = slots[len(slots) // 2]
                row["forecast"].append((
                    day, round(max(temps)), round(min(temps)),
                    icon_for(mid["weather"][0]["id"], (mid.get("clouds") or {}).get("all", 0)),
                ))
        return row

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        results = await asyncio.gather(
            *(self._city(client, c) for c in self.cities), return_exceptions=True
        )
        rows, first_error = [], None
        for city, res in zip(self.cities, results):
            if isinstance(res, Exception):
                first_error = first_error or res
                continue
            if res:
                rows.append(res)
        # All six failed => surface the reason instead of silently going empty.
        if not rows and first_error:
            raise first_error
        return rows
