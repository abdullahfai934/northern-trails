"""Query helpers over the PostGIS schema.

Every function here degrades: if the database is not configured or a query
fails, the caller falls back to the in-memory data layer. That keeps the
"clone and run with no infrastructure" property while making the database
the real source of truth when it exists.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, text

from ..geo import CITY_COORDS
from .models import (Alert, Booking, DeviceToken, Operator, Payment, Route,
                     TripRequest, User, Weather)
from .session import enabled, session

log = logging.getLogger("northern_trails.repo")

# In-memory stand-ins used when no database is configured. They keep the
# booking and payment flow fully demonstrable on a bare clone; a restart
# clears them, which is exactly the trade-off DATABASE_URL removes.
_MEM_BOOKINGS: dict[str, dict] = {}
_MEM_PAYMENTS: dict[str, dict] = {}


class _Row:
    """Attribute access over a dict, so callers treat memory and ORM rows alike."""

    def __init__(self, data: dict):
        self.__dict__.update(data)

    def __repr__(self) -> str:
        return f"<_Row {self.__dict__.get('id', '?')}>"


def _geog(lat: float, lon: float):
    return func.ST_GeogFromText(f"SRID=4326;POINT({lon} {lat})")


# ------------------------------------------------------- spatial dispatch
async def nearest_operators(pickup: str, available: set[str],
                            limit: int = 3) -> list[dict] | None:
    """Operators nearest a pickup point, by true spheroid distance.

    This is the query the Python proximity table stands in for: PostGIS
    ranks by metres from the operator's base, so adding an operator needs
    no hand-written adjacency list.
    """
    if not enabled():
        return None
    coords = CITY_COORDS.get(pickup)
    if not coords:
        return None
    try:
        origin = _geog(*coords)
        dist = func.ST_Distance(Operator.location, origin).label("metres")
        stmt = (
            select(Operator, dist)
            .where(Operator.location.isnot(None))
            .order_by(dist, Operator.response_min)
        )
        async with session() as s:
            rows = (await s.execute(stmt)).all()
    except Exception:
        log.exception("nearest_operators failed — falling back to in-memory ranking")
        return None

    out = []
    for op, metres in rows:
        if available and op.id not in available:
            continue
        out.append({
            "id": op.id, "name": op.name, "base": op.base, "rating": op.rating,
            "trips": op.trips, "since": op.since, "verified": op.verified,
            "response_min": op.response_min, "avatar_hue": op.avatar_hue,
            "verification": op.verification, "vehicles": op.vehicles,
            "languages": op.languages, "distance_km": round(metres / 1000, 1),
        })
    return out[:limit] or None


async def alerts_near_route(route_id: str, radius_km: float = 25.0) -> list[dict] | None:
    """Alerts whose point falls within `radius_km` of a route's corridor.

    A spatial join, rather than trusting the `routes` array an upstream
    feed guessed at.
    """
    if not enabled():
        return None
    try:
        stmt = (
            select(Alert)
            .join(Route, text("true"))
            .where(Route.id == route_id, Alert.location.isnot(None),
                   func.ST_DWithin(Alert.location, Route.path, radius_km * 1000))
        )
        async with session() as s:
            rows = (await s.execute(stmt)).scalars().all()
        return [{"id": a.id, "severity": a.severity, "kind": a.kind, "title": a.title,
                 "body": a.body, "source": a.source, "origin": a.origin} for a in rows]
    except Exception:
        log.exception("alerts_near_route failed")
        return None


# ------------------------------------------------------- conditions upsert
async def save_conditions(routes: list[dict] | None = None,
                          alerts: list[dict] | None = None,
                          weather: list[dict] | None = None) -> None:
    """Persist what the poller fetched. Best effort — never blocks a cycle."""
    if not enabled():
        return
    try:
        async with session() as s:
            for r in routes or []:
                await s.merge(Route(
                    id=r["id"], name=r.get("name", ""), valley=r.get("valley", ""),
                    status=r["status"], status_note=r.get("status_note", ""),
                    source=r.get("source", ""), source_url=r.get("source_url", ""),
                    confidence=r.get("confidence", 0.5), origin=r.get("origin", "seed"),
                    updated_at=datetime.now(timezone.utc),
                ))
            for a in alerts or []:
                await s.merge(Alert(
                    id=a["id"], severity=a["severity"], kind=a["kind"],
                    title=a["title"], body=a.get("body", ""), routes=a.get("routes", []),
                    source=a.get("source", ""), source_url=a.get("source_url", ""),
                    origin=a.get("origin", "seed"),
                    issued_at=datetime.now(timezone.utc),
                    location=_geog(a["lat"], a["lon"]) if a.get("lat") else None,
                ))
            for w in weather or []:
                await s.merge(Weather(
                    city=w["city"], temp_c=w["temp_c"], feels_c=w["feels_c"],
                    condition=w["condition"], icon=w["icon"], wind_kmh=w["wind_kmh"],
                    humidity=w["humidity"], visibility_km=w["visibility_km"],
                    forecast=[list(f) for f in w.get("forecast", [])],
                    origin=w.get("origin", "seed"), updated_at=datetime.now(timezone.utc),
                ))
            await s.commit()
    except Exception:
        log.exception("save_conditions failed — in-memory layer still updated")


# -------------------------------------------------------------- accounts
async def upsert_user(uid: str, phone: str = "", name: str = "",
                      role: str = "traveler") -> None:
    if not enabled():
        return
    try:
        async with session() as s:
            existing = await s.get(User, uid)
            if existing:
                existing.last_seen_at = datetime.now(timezone.utc)
                if phone:
                    existing.phone = phone
                if name:
                    existing.name = name
            else:
                s.add(User(uid=uid, phone=phone, name=name, role=role))
            await s.commit()
    except Exception:
        log.exception("upsert_user failed")


async def register_device(uid: str, token: str, platform: str = "web",
                          watch_routes: list[str] | None = None) -> None:
    if not enabled():
        return
    try:
        async with session() as s:
            row = (await s.execute(
                select(DeviceToken).where(DeviceToken.token == token))).scalar_one_or_none()
            if row:
                row.uid, row.watch_routes = uid, watch_routes or row.watch_routes
            else:
                s.add(DeviceToken(uid=uid, token=token, platform=platform,
                                  watch_routes=watch_routes or []))
            await s.commit()
    except Exception:
        log.exception("register_device failed")


async def tokens_for_routes(route_ids: list[str]) -> list[str]:
    """Device tokens watching any of these routes (plus blanket watchers)."""
    if not enabled():
        return []
    try:
        async with session() as s:
            rows = (await s.execute(select(DeviceToken))).scalars().all()
        wanted = set(route_ids)
        return [r.token for r in rows
                if not r.watch_routes or wanted & set(r.watch_routes)]
    except Exception:
        log.exception("tokens_for_routes failed")
        return []


# ------------------------------------------------------------ on-demand trips
_MEM_TRIPS: dict[str, dict] = {}


async def save_trip(req: dict) -> bool:
    """Upsert a trip. Called on creation and at every status change."""
    row = {
        "id": req["id"],
        "traveler_id": req.get("traveler_id", ""),
        "traveler_name": req.get("traveler_name", ""),
        "service": req.get("service", ""),
        "pickup": req.get("pickup", ""),
        "dropoff": req.get("dropoff", ""),
        "passengers": req.get("passengers", 1),
        "notes": req.get("notes", ""),
        "distance_km": req.get("distance_km"),
        "duration_min": req.get("duration_min"),
        "route_method": req.get("route_method", ""),
        "estimate_pkr": req.get("estimate_pkr", 0),
        "status": req.get("status", "searching"),
        "stage": req.get("stage", "") or "",
        "offer_count": len(req.get("offers", []) or []),
    }
    accepted = req.get("accepted_by") or {}
    if isinstance(accepted, dict) and accepted:
        row["accepted_operator_id"] = (accepted.get("operator") or {}).get("id")
        row["agreed_pkr"] = accepted.get("price_pkr")

    if not enabled():
        _MEM_TRIPS[row["id"]] = {**_MEM_TRIPS.get(row["id"], {}), **row,
                                 "created_at": datetime.now(timezone.utc)}
        return False
    try:
        coords = {}
        from ..geo import CITY_COORDS
        if req.get("pickup") in CITY_COORDS:
            coords["pickup_point"] = _geog(*CITY_COORDS[req["pickup"]])
        if req.get("dropoff") in CITY_COORDS:
            coords["dropoff_point"] = _geog(*CITY_COORDS[req["dropoff"]])
        async with session() as s:
            await s.merge(TripRequest(**row, **coords))
            await s.commit()
        return True
    except Exception:
        log.exception("save_trip failed")
        return False


async def trips_for_traveler(traveler_id: str, limit: int = 20) -> list[dict]:
    """A traveler's real ride history, newest first."""
    def shape(r) -> dict:
        return {
            "id": r["id"] if isinstance(r, dict) else r.id,
            "service": r["service"] if isinstance(r, dict) else r.service,
            "pickup": r["pickup"] if isinstance(r, dict) else r.pickup,
            "dropoff": r["dropoff"] if isinstance(r, dict) else r.dropoff,
            "status": r["status"] if isinstance(r, dict) else r.status,
            "stage": (r.get("stage") if isinstance(r, dict) else r.stage) or "",
            "distance_km": r["distance_km"] if isinstance(r, dict) else r.distance_km,
            "duration_min": r["duration_min"] if isinstance(r, dict) else r.duration_min,
            "estimate_pkr": r["estimate_pkr"] if isinstance(r, dict) else r.estimate_pkr,
            "agreed_pkr": (r.get("agreed_pkr") if isinstance(r, dict) else r.agreed_pkr),
            "created_at": str((r.get("created_at") if isinstance(r, dict) else r.created_at) or ""),
        }

    if not enabled():
        rows = [t for t in _MEM_TRIPS.values() if t.get("traveler_id") == traveler_id]
        rows.sort(key=lambda t: str(t.get("created_at", "")), reverse=True)
        return [shape(t) for t in rows[:limit]]
    try:
        async with session() as s:
            res = await s.execute(
                select(TripRequest)
                .where(TripRequest.traveler_id == traveler_id)
                .order_by(TripRequest.created_at.desc())
                .limit(limit))
            return [shape(r) for r in res.scalars().all()]
    except Exception:
        log.exception("trips_for_traveler failed")
        return []


# ------------------------------------------------------ bookings/payments
async def create_booking(row: dict) -> bool:
    if not enabled():
        _MEM_BOOKINGS[row["id"]] = {**row, "created_at": datetime.now(timezone.utc)}
        return False        # False = "not durably stored", which the API reports
    try:
        async with session() as s:
            s.add(Booking(**row))
            await s.commit()
        return True
    except Exception:
        log.exception("create_booking failed")
        return False


async def get_booking(booking_id: str):
    if not enabled():
        row = _MEM_BOOKINGS.get(booking_id)
        return _Row(row) if row else None
    try:
        async with session() as s:
            return await s.get(Booking, booking_id)
    except Exception:
        log.exception("get_booking failed")
        return None


async def save_payment(row: dict) -> bool:
    if not enabled():
        _MEM_PAYMENTS[row["id"]] = dict(row)
        return False
    try:
        async with session() as s:
            await s.merge(Payment(**row))
            await s.commit()
        return True
    except Exception:
        log.exception("save_payment failed")
        return False


async def settle_payment(txn_ref: str, status: str, code: str, message: str,
                         raw: dict, provider_ref: str = "") -> str | None:
    """Mark a payment settled and move its booking. Returns the booking id."""
    if not enabled():
        payment = _MEM_PAYMENTS.get(txn_ref)
        if not payment:
            return None
        payment.update({"status": status, "response_code": code,
                        "response_message": message, "raw_response": raw,
                        "provider_ref": provider_ref or payment.get("provider_ref", ""),
                        "settled_at": datetime.now(timezone.utc)})
        booking = _MEM_BOOKINGS.get(payment["booking_id"])
        if booking:
            booking["status"] = "confirmed" if status == "paid" else "payment_failed"
        return payment["booking_id"]
    try:
        async with session() as s:
            pay = await s.get(Payment, txn_ref)
            if not pay:
                return None
            pay.status, pay.response_code = status, code
            pay.response_message, pay.raw_response = message, raw
            pay.provider_ref = provider_ref or pay.provider_ref
            pay.settled_at = datetime.now(timezone.utc)
            booking = await s.get(Booking, pay.booking_id)
            if booking:
                booking.status = "confirmed" if status == "paid" else "payment_failed"
            await s.commit()
            return pay.booking_id
    except Exception:
        log.exception("settle_payment failed")
        return None
