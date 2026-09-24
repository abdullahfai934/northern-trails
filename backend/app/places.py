"""Restaurants near a destination.

Order of preference:

1. **Google Places API (New)**, when GOOGLE_PLACES_API_KEY is set.
2. **OpenStreetMap via Overpass**, which needs no key. Coverage in the
   north is uneven: Karimabad and Skardu are well mapped, the Deosai plains
   have nothing. The search therefore widens its radius step by step until
   it finds somewhere to eat, and reports the radius it used rather than
   pretending the nearest place is around the corner.

Every item carries a Google Maps directions link built from its coordinates,
so "Get directions" works whichever source the item came from.
"""
from __future__ import annotations

import asyncio
import logging
import math
from typing import Any, Dict, List

import httpx

from . import config, data
from .ttlcache import TTLCache

log = logging.getLogger("northern_trails.places")

_cache = TTLCache("restaurants", ttl_sec=12 * 3600)

#: Search radii in metres, tried in order until something is found.
RADII = (2500, 8000, 25000)
MAX_ITEMS = 20

OSM_KINDS = {"restaurant": "Restaurant", "cafe": "Café", "fast_food": "Fast food"}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def directions_url(lat: float, lon: float, place_id: str = "") -> str:
    url = f"https://www.google.com/maps/dir/?api=1&destination={lat:.6f},{lon:.6f}"
    if place_id:
        url += f"&destination_place_id={place_id}"
    return url


def _cuisine(raw: str, kind: str) -> str:
    parts = [p.strip().replace("_", " ") for p in (raw or "").split(";") if p.strip()]
    if parts:
        return ", ".join(p.capitalize() for p in parts[:3])
    return OSM_KINDS.get(kind, "Restaurant")


async def _overpass(client: httpx.AsyncClient, lat: float, lon: float, radius: int) -> List[dict]:
    query = (
        f'[out:json][timeout:20];'
        f'nwr[amenity~"^(restaurant|cafe|fast_food)$"][name](around:{radius},{lat},{lon});'
        f'out center 80;'
    )
    elements = await _run_overpass(client, query)
    return [_restaurant(e) for e in elements if _has_point(e) and (e.get("tags") or {}).get("name")]


def _has_point(e: dict) -> bool:
    return (e.get("lat") or (e.get("center") or {}).get("lat")) is not None


async def _run_overpass(client: httpx.AsyncClient, query: str) -> List[dict]:
    last_exc: Exception | None = None
    elements = None
    for url in config.OVERPASS_URLS:
        # The public servers answer a burst with 429 or 504 and succeed a
        # few seconds later, so each mirror gets two more tries, backing off.
        for attempt in range(3):
            try:
                resp = await client.post(url, data={"data": query})
                if resp.status_code in (429, 504) and attempt < 2:
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                resp.raise_for_status()
                elements = resp.json().get("elements", [])
                break
            except Exception as exc:  # down or unreachable: next mirror
                last_exc = exc
                log.info("overpass %s failed: %s", url, exc)
                break
        if elements is not None:
            break
    if elements is None:
        raise last_exc or RuntimeError("no Overpass endpoint configured")
    return elements


def _restaurant(e: dict) -> dict:
    tags = e.get("tags") or {}
    elat = e.get("lat") or (e.get("center") or {}).get("lat")
    elon = e.get("lon") or (e.get("center") or {}).get("lon")
    kind = tags.get("amenity", "restaurant")
    address = ", ".join(x for x in (tags.get("addr:street"), tags.get("addr:city")) if x)
    return {
        "id": f"osm-{e['type']}-{e['id']}",
        "name": tags["name"],
        "cuisine": _cuisine(tags.get("cuisine", ""), kind),
        "kind": OSM_KINDS.get(kind, "Restaurant"),
        "lat": elat, "lon": elon,
        "address": address,
        "phone": tags.get("phone") or tags.get("contact:phone") or "",
        "website": tags.get("website") or tags.get("contact:website") or "",
        "opening_hours": tags.get("opening_hours", ""),
        "rating": None,
        "source": "openstreetmap",
        "source_url": f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
        "directions_url": directions_url(elat, elon),
    }


# ------------------------------------------------------ points of interest
#: Map layers and the SOS page. Each kind is an OpenStreetMap tag filter.
POI_KINDS = {
    "hospital": ('nwr[amenity~"^(hospital|clinic|doctors)$"]', "Hospital / clinic"),
    "fuel": ('nwr[amenity=fuel]', "Petrol pump"),
    "police": ('nwr[amenity=police]', "Police station"),
    "hotel": ('nwr[tourism~"^(hotel|guest_house|hostel|motel)$"]', "Hotel / guest house"),
}
_poi_cache = TTLCache("pois", ttl_sec=24 * 3600)


async def pois(kind: str, lat: float, lon: float, radius: int = 15000,
               *, client: httpx.AsyncClient | None = None) -> Dict[str, Any]:
    if kind not in POI_KINDS:
        return {"ok": False, "error": f"kind must be one of {', '.join(POI_KINDS)}", "items": []}
    radius = max(500, min(radius, 50000))
    key = f"{kind}:{lat:.3f},{lon:.3f}:{radius}"
    cached = _poi_cache.get(key)
    if cached is not None:
        return {**cached, "cached": True}
    if not config.LOOKUPS_ENABLED and client is None:
        return {"ok": True, "kind": kind, "items": [], "source": "none"}
    filt, label = POI_KINDS[kind]
    query = f'[out:json][timeout:25];{filt}(around:{radius},{lat},{lon});out center 120;'
    own = client is None
    client = client or httpx.AsyncClient(timeout=30, headers={"User-Agent": config.SOURCE_USER_AGENT})
    try:
        elements = await _run_overpass(client, query)
    except Exception:
        stale = _poi_cache.get(key, allow_stale=True)
        if stale is not None:
            return {**stale, "stale": True}
        return {"ok": False, "kind": kind, "items": [],
                "error": "The map directory could not be reached. Try again shortly."}
    finally:
        if own:
            await client.aclose()
    items = []
    for e in elements:
        if not _has_point(e):
            continue
        t = e.get("tags") or {}
        elat = e.get("lat") or e["center"]["lat"]
        elon = e.get("lon") or e["center"]["lon"]
        items.append({
            "id": f"osm-{e['type']}-{e['id']}", "kind": kind, "label": label,
            "name": t.get("name") or t.get("name:en") or label,
            "lat": elat, "lon": elon, "distance_km": round(haversine_km(lat, lon, elat, elon), 2),
            "phone": t.get("phone") or t.get("contact:phone") or t.get("emergency:phone") or "",
            "emergency": t.get("emergency") == "yes",
            "directions_url": directions_url(elat, elon),
        })
    items.sort(key=lambda x: x["distance_km"])
    result = {"ok": True, "kind": kind, "radius_m": radius, "source": "openstreetmap", "items": items[:80]}
    _poi_cache.set(key, result)
    return result


async def _google(client: httpx.AsyncClient, lat: float, lon: float, radius: int) -> List[dict]:
    resp = await client.post(
        "https://places.googleapis.com/v1/places:searchNearby",
        headers={
            "X-Goog-Api-Key": config.GOOGLE_PLACES_KEY,
            "X-Goog-FieldMask": ",".join([
                "places.id", "places.displayName", "places.location", "places.primaryTypeDisplayName",
                "places.formattedAddress", "places.rating", "places.nationalPhoneNumber",
                "places.websiteUri", "places.googleMapsUri",
            ]),
        },
        json={
            "includedTypes": ["restaurant", "cafe", "fast_food_restaurant"],
            "maxResultCount": MAX_ITEMS,
            "rankPreference": "DISTANCE",
            "locationRestriction": {"circle": {
                "center": {"latitude": lat, "longitude": lon}, "radius": float(min(radius, 50000))}},
        },
    )
    resp.raise_for_status()
    out = []
    for p in resp.json().get("places", []):
        loc = p.get("location") or {}
        if "latitude" not in loc:
            continue
        out.append({
            "id": "gp-" + p["id"],
            "name": (p.get("displayName") or {}).get("text", "Restaurant"),
            "cuisine": (p.get("primaryTypeDisplayName") or {}).get("text", "Restaurant"),
            "kind": "Restaurant",
            "lat": loc["latitude"], "lon": loc["longitude"],
            "address": p.get("formattedAddress", ""),
            "phone": p.get("nationalPhoneNumber", ""),
            "website": p.get("websiteUri", ""),
            "opening_hours": "",
            "rating": p.get("rating"),
            "source": "google-places",
            "source_url": p.get("googleMapsUri", ""),
            "directions_url": directions_url(loc["latitude"], loc["longitude"], p["id"]),
        })
    return out


def resolve_center(destination: str = "", lat: float | None = None,
                   lon: float | None = None) -> tuple[float, float, str] | None:
    """(lat, lon, label) for a destination name, a city, or raw coordinates."""
    if lat is not None and lon is not None:
        return lat, lon, destination or f"{lat:.3f}, {lon:.3f}"
    dest = data.destination_by_name(destination)
    if dest and dest.get("lat") is not None:
        return dest["lat"], dest["lon"], dest["name"]
    from .geo import CITY_COORDS
    for name, (clat, clon) in CITY_COORDS.items():
        if name.lower() == (destination or "").strip().lower():
            return clat, clon, name
    return None


async def nearby(destination: str = "", lat: float | None = None, lon: float | None = None,
                 *, client: httpx.AsyncClient | None = None) -> Dict[str, Any]:
    """Named places to eat near a destination, nearest first."""
    center = resolve_center(destination, lat, lon)
    if center is None:
        return {"ok": False, "error": f"Unknown destination '{destination}'", "items": []}
    clat, clon, label = center
    base = {"ok": True, "destination": label, "center": {"lat": clat, "lon": clon}}

    key = f"{clat:.4f},{clon:.4f}"
    cached = _cache.get(key)
    if cached is not None:
        return {**base, **cached, "cached": True}
    if not config.LOOKUPS_ENABLED and client is None:
        return {**base, "items": [], "radius_m": 0, "source": "none",
                "note": "Restaurant lookups are switched off on this server."}

    own = client is None
    client = client or httpx.AsyncClient(
        timeout=25, headers={"User-Agent": config.SOURCE_USER_AGENT})
    items: List[dict] = []
    used_radius, source, error = 0, "none", ""
    try:
        for radius in RADII:
            used_radius = radius
            try:
                if config.GOOGLE_PLACES_KEY:
                    try:
                        items = await _google(client, clat, clon, radius)
                        source = "google-places"
                    except Exception as exc:
                        log.warning("google places failed, using OSM: %s", exc)
                        items = await _overpass(client, clat, clon, radius)
                        source = "openstreetmap"
                else:
                    items = await _overpass(client, clat, clon, radius)
                    source = "openstreetmap"
            except Exception as exc:
                error = str(exc) or type(exc).__name__
                break
            if items:
                break
    finally:
        if own:
            await client.aclose()

    for it in items:
        it["distance_km"] = round(haversine_km(clat, clon, it["lat"], it["lon"]), 2)
    items.sort(key=lambda it: it["distance_km"])
    items = items[:MAX_ITEMS]

    if error and not items:
        stale = _cache.get(key, allow_stale=True)
        if stale is not None:
            return {**base, **stale, "cached": True, "stale": True}
        return {**base, "ok": False, "items": [], "radius_m": used_radius, "source": source,
                "error": "The restaurant directory could not be reached. Try again shortly."}

    result = {"items": items, "radius_m": used_radius, "source": source}
    if not items:
        where = "Google Places" if source == "google-places" else "OpenStreetMap"
        result["note"] = f"{where} lists no restaurants within {used_radius // 1000} km of {label}."
    _cache.set(key, result)
    return {**base, **result}
