"""Real road routing for on-demand trips.

The ride quote used to run on a flat guess of 60 km whenever the client did
not supply a distance. That produced a plausible-looking but invented price
and ETA. This module asks OSRM for the actual driving distance and duration
over the real road network, which in this terrain is very different from
straight-line distance: Gilgit to Skardu is 138 km as the crow flies and
209 km of road.

OSRM's public demo server is keyless. If it is unreachable the caller falls
back to a haversine estimate inflated by a terrain factor, and the response
says which method was used — an estimate is never presented as measured.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from .geo import CITY_COORDS, haversine_km

log = logging.getLogger("northern_trails.routing")

OSRM = "https://router.project-osrm.org/route/v1/driving"

#: Mountain roads switchback heavily; straight-line under-reads badly here.
TERRAIN_FACTOR = 1.55
#: Average moving speed on KKH / jeep tracks, km per hour.
AVG_SPEED_KMH = 38.0

_cache: dict[tuple[str, str], dict] = {}


async def road_route(pickup: str, dropoff: str) -> dict:
    """Driving distance and duration between two known towns.

    Returns {distance_km, duration_min, method, ok}. `method` is "osrm" for
    a measured road route or "estimate" for the fallback.
    """
    key = (pickup, dropoff)
    if key in _cache:
        return _cache[key]

    start, end = CITY_COORDS.get(pickup), CITY_COORDS.get(dropoff)
    if not start or not end:
        return {"distance_km": None, "duration_min": None,
                "method": "unknown", "ok": False,
                "note": "One of these places is not in the tracked northern network."}

    result = None
    # The public OSRM demo server drops roughly one request in three, so a
    # single failure is not a reason to fall back to an estimate.
    url = f"{OSRM}/{start[1]},{start[0]};{end[1]},{end[0]}"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                resp = await client.get(url, params={"overview": "false"})
                resp.raise_for_status()
                payload = resp.json()
            routes = payload.get("routes") or []
            if routes:
                best = routes[0]
                result = {
                    "distance_km": round(best["distance"] / 1000, 1),
                    "duration_min": round(best["duration"] / 60),
                    "method": "osrm",
                    "ok": True,
                    "note": "Measured over the real road network (OSRM).",
                }
                break
        except Exception as exc:
            if attempt == 2:
                log.warning("OSRM unavailable after 3 tries (%s) — using terrain estimate",
                            type(exc).__name__)
            else:
                await asyncio.sleep(0.4 * (attempt + 1))

    if result is None:
        straight = haversine_km(start, end)
        km = round(straight * TERRAIN_FACTOR, 1)
        result = {
            "distance_km": km,
            "duration_min": round(km / AVG_SPEED_KMH * 60),
            "method": "estimate",
            "ok": True,
            "note": "Routing service unavailable — estimated from straight-line "
                    "distance with a mountain-terrain factor.",
        }

    _cache[key] = result
    return result
