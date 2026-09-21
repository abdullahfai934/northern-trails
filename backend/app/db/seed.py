"""Load the seeded data layer into PostgreSQL, with geometry.

Idempotent: re-running upserts by primary key rather than duplicating, so
it is safe as a container start step. Route paths and operator/city points
are built here from `geo.py` — this is what makes ST_Distance possible.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select

from .. import data
from ..geo import CITY_COORDS, ROUTE_ENDPOINTS
from .models import Alert, Operator, Package, Route, Weather
from .session import session

log = logging.getLogger("northern_trails.seed")


def _point(lat: float, lon: float):
    """WKT POINT — note PostGIS takes (lon lat), not (lat lon)."""
    return func.ST_GeogFromText(f"SRID=4326;POINT({lon} {lat})")


def _line(a: tuple[float, float], b: tuple[float, float]):
    return func.ST_GeogFromText(
        f"SRID=4326;LINESTRING({a[1]} {a[0]}, {b[1]} {b[0]})")


def _dt(value) -> datetime:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


async def seed_all(force: bool = False) -> dict:
    counts = {}
    async with session() as s:
        existing = (await s.execute(select(func.count()).select_from(Operator))).scalar() or 0
        if existing and not force:
            log.info("database already seeded (%d operators) — skipping", existing)
            return {"skipped": True, "operators": existing}

        for op in data.OPERATORS:
            lat, lon = CITY_COORDS.get(op["base"], (35.92, 74.31))
            await s.merge(Operator(
                id=op["id"], name=op["name"], base=op["base"], rating=op["rating"],
                trips=op["trips"], since=op["since"], verified=op["verified"],
                response_min=op.get("response_min", 5), avatar_hue=op.get("avatar_hue", 200),
                verification=op.get("verification", {}), vehicles=op.get("vehicles", []),
                languages=op.get("languages", []), location=_point(lat, lon),
            ))
        counts["operators"] = len(data.OPERATORS)

        for r in data.ROUTES:
            ends = ROUTE_ENDPOINTS.get(r["id"])
            await s.merge(Route(
                id=r["id"], name=r["name"], valley=r["valley"],
                distance_km=r["distance_km"], drive_hours=r["drive_hours"],
                elevation_m=r["elevation_m"], status=r["status"],
                status_note=r["status_note"], source=r.get("source", ""),
                source_url=r.get("source_url", ""), confidence=r.get("confidence", 0.5),
                traveler_reports=r.get("traveler_reports", 0),
                permits=r.get("permits", []), hazards=r.get("hazards", []),
                origin=r.get("origin", "seed"), updated_at=_dt(r.get("updated_at")),
                path=_line(*ends) if ends else None,
            ))
        counts["routes"] = len(data.ROUTES)

        for a in data.ALERTS:
            await s.merge(Alert(
                id=a["id"], severity=a["severity"], kind=a["kind"], title=a["title"],
                body=a.get("body", ""), routes=a.get("routes", []),
                source=a.get("source", ""), source_url=a.get("source_url", ""),
                origin=a.get("origin", "seed"), issued_at=_dt(a.get("issued_at")),
                location=_point(a["lat"], a["lon"]) if a.get("lat") else None,
            ))
        counts["alerts"] = len(data.ALERTS)

        for w in data.WEATHER:
            lat, lon = CITY_COORDS.get(w["city"], (35.92, 74.31))
            await s.merge(Weather(
                city=w["city"], temp_c=w["temp_c"], feels_c=w["feels_c"],
                condition=w["condition"], icon=w["icon"], wind_kmh=w["wind_kmh"],
                humidity=w["humidity"], visibility_km=w["visibility_km"],
                forecast=[list(f) for f in w.get("forecast", [])],
                origin=w.get("origin", "seed"), location=_point(lat, lon),
            ))
        counts["weather"] = len(data.WEATHER)

        for p in data.PACKAGES:
            await s.merge(Package(
                id=p["id"], operator_id=p["operator_id"], title=p["title"],
                days=p["days"], price_pkr=p["price_pkr"], pickup=p["pickup"],
                destination=p["destination"], group_size=p.get("group_size", ""),
                rating=p.get("rating", 0.0), reviews=p.get("reviews", 0),
                difficulty=p.get("difficulty", ""), hero=p.get("hero", ""),
                tags=p.get("tags", []), includes=p.get("includes", []),
                excludes=p.get("excludes", []), routes=p.get("routes", []),
                itinerary=[list(i) for i in p.get("itinerary", [])],
            ))
        counts["packages"] = len(data.PACKAGES)

        await s.commit()
    log.info("seeded %s", counts)
    return counts
