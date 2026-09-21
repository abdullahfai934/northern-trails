"""Coordinates for every place the conditions layer tracks.

Two consumers: the OpenWeatherMap poller (needs lat/lon per city) and the
PostGIS layer (route endpoints become LINESTRING geometry, operator bases
become POINT geometry so `ST_Distance` can replace the Python ranking).
"""
from __future__ import annotations

# city -> (lat, lon) for the weather poller
CITY_COORDS: dict[str, tuple[float, float]] = {
    "Karimabad (Hunza)": (36.3167, 74.6667),
    "Skardu": (35.2971, 75.6333),
    "Khunjerab Pass": (36.8508, 75.4269),
    "Chitral": (35.8511, 71.7864),
    "Deosai Plains": (34.9667, 75.4000),
    "Fairy Meadows": (35.3878, 74.5783),
    "Gilgit": (35.9208, 74.3144),
    "Passu": (36.4667, 74.8667),
    "Khaplu": (35.1667, 76.3333),
    "Chilas": (35.4167, 74.1000),
    "Raikot Bridge": (35.4333, 74.5833),
    "Astore": (35.3667, 74.8500),
    "Naltar": (36.1667, 74.1833),
    "Attabad Lake": (36.3400, 74.8650),
    "Raikot": (35.4333, 74.5833),
    # short forms used by operator `base` fields
    "Karimabad": (36.3167, 74.6667),
    "Hunza": (36.3167, 74.6667),
    "Deosai": (34.9667, 75.4000),
}

# route -> ((start_lat, start_lon), (end_lat, end_lon))
ROUTE_ENDPOINTS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    "kkh-gilgit-hunza": ((35.9208, 74.3144), (36.3167, 74.6667)),
    "kkh-hunza-khunjerab": ((36.3167, 74.6667), (36.8508, 75.4269)),
    "skardu-road": ((35.9208, 74.3144), (35.2971, 75.6333)),
    "deosai-plains": ((35.2971, 75.6333), (35.3667, 74.8500)),
    "shandur-chitral": ((35.9208, 74.3144), (35.8511, 71.7864)),
    "fairy-meadows": ((35.4333, 74.5833), (35.3878, 74.5783)),
}

# Bounding box for Gilgit-Baltistan + Chitral, used to filter global hazard
# feeds (GDACS is worldwide) down to events that actually affect our routes.
REGION_BBOX = {"min_lat": 34.0, "max_lat": 37.5, "min_lon": 70.5, "max_lon": 77.5}


def in_region(lat: float, lon: float) -> bool:
    b = REGION_BBOX
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    from math import asin, cos, radians, sin, sqrt
    lat1, lon1, lat2, lon2 = map(radians, (a[0], a[1], b[0], b[1]))
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(h))


def nearest_routes(lat: float, lon: float, limit: int = 3,
                   max_km: float = 150.0) -> list[str]:
    """Route ids near a point — maps a hazard onto the roads it can affect.

    `max_km` matters: without a ceiling the "nearest" route to a far-off
    event is still returned, which would pin an unrelated flood onto a
    Karakoram road. An event with nothing within range gets an empty list
    and is treated as a regional advisory rather than a road hazard.
    """
    scored = []
    for rid, (start, end) in ROUTE_ENDPOINTS.items():
        mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        d = haversine_km((lat, lon), mid)
        if d <= max_km:
            scored.append((d, rid))
    scored.sort()
    return [rid for _, rid in scored[:limit]]
