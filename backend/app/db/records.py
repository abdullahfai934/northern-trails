"""Storage for accounts-era records: bookings by user, reviews, trip plans,
notifications, API keys and hand-edited road statuses.

Same contract as repo.py: with DATABASE_URL these hit PostgreSQL; without it
they use in-memory stand-ins, so the app and the tests run with no database.
Every function returns plain dicts.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, update

from . import repo
from .models import ApiKey, Booking, DeviceToken, Notification, Review, Route, TripPlan
from .session import enabled, session

log = logging.getLogger("northern_trails.records")

_MEM: dict[str, dict] = {"reviews": {}, "plans": {}, "notes": {}, "keys": {}}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt) -> str:
    return dt.isoformat() if isinstance(dt, datetime) else (dt or "")


def _row(obj, fields) -> dict:
    return {f: _iso(getattr(obj, f)) if isinstance(getattr(obj, f), datetime) else getattr(obj, f)
            for f in fields}


# ---------------------------------------------------------------- bookings
BOOKING_FIELDS = ("id", "package_id", "uid", "traveler_name", "email", "phone", "start_date",
                  "travelers", "total_pkr", "status", "condition_warnings", "notes", "created_at")


async def bookings(uid: str | None = None) -> list[dict]:
    """All bookings, or one user's, newest first."""
    if not enabled():
        rows = [dict(b) for b in repo._MEM_BOOKINGS.values() if uid is None or b.get("uid") == uid]
        for r in rows:
            r["created_at"] = _iso(r.get("created_at"))
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)
    async with session() as s:
        stmt = select(Booking).order_by(Booking.created_at.desc())
        if uid is not None:
            stmt = stmt.where(Booking.uid == uid)
        return [_row(b, BOOKING_FIELDS) for b in (await s.execute(stmt)).scalars().all()]


async def booking(booking_id: str) -> dict | None:
    if not enabled():
        b = repo._MEM_BOOKINGS.get(booking_id)
        return {**b, "created_at": _iso(b.get("created_at"))} if b else None
    async with session() as s:
        b = await s.get(Booking, booking_id)
        return _row(b, BOOKING_FIELDS) if b else None


async def set_booking_status(booking_id: str, status: str) -> dict | None:
    if not enabled():
        b = repo._MEM_BOOKINGS.get(booking_id)
        if b:
            b["status"] = status
        return await booking(booking_id)
    async with session() as s:
        b = await s.get(Booking, booking_id)
        if not b:
            return None
        b.status = status
        await s.commit()
    return await booking(booking_id)


# ----------------------------------------------------------------- reviews
REVIEW_FIELDS = ("id", "booking_id", "package_id", "operator_id", "uid", "author", "rating",
                 "guide_rating", "text", "photos", "status", "created_at")


async def add_review(row: dict) -> dict:
    row = {**row, "created_at": _now()}
    if not enabled():
        _MEM["reviews"][row["id"]] = row
        return {**row, "created_at": _iso(row["created_at"])}
    async with session() as s:
        s.add(Review(**row))
        await s.commit()
    return {**row, "created_at": _iso(row["created_at"])}


async def reviews(*, package_id: str | None = None, uid: str | None = None,
                  status: str | None = None) -> list[dict]:
    if not enabled():
        rows = list(_MEM["reviews"].values())
        rows = [r for r in rows if (package_id is None or r["package_id"] == package_id)
                and (uid is None or r["uid"] == uid) and (status is None or r["status"] == status)]
        return sorted([{**r, "created_at": _iso(r["created_at"])} for r in rows],
                      key=lambda r: r["created_at"], reverse=True)
    async with session() as s:
        stmt = select(Review).order_by(Review.created_at.desc())
        if package_id is not None:
            stmt = stmt.where(Review.package_id == package_id)
        if uid is not None:
            stmt = stmt.where(Review.uid == uid)
        if status is not None:
            stmt = stmt.where(Review.status == status)
        return [_row(r, REVIEW_FIELDS) for r in (await s.execute(stmt)).scalars().all()]


async def review_for_booking(booking_id: str) -> dict | None:
    if not enabled():
        return next((r for r in _MEM["reviews"].values() if r["booking_id"] == booking_id), None)
    async with session() as s:
        r = (await s.execute(select(Review).where(Review.booking_id == booking_id))).scalar_one_or_none()
        return _row(r, REVIEW_FIELDS) if r else None


async def set_review_status(review_id: str, status: str) -> dict | None:
    if not enabled():
        r = _MEM["reviews"].get(review_id)
        if r:
            r["status"] = status
            return {**r, "created_at": _iso(r["created_at"])}
        return None
    async with session() as s:
        r = await s.get(Review, review_id)
        if not r:
            return None
        r.status = status
        await s.commit()
        return _row(r, REVIEW_FIELDS)


# -------------------------------------------------------------- trip plans
PLAN_FIELDS = ("id", "uid", "title", "brief", "plan", "created_at", "updated_at")


async def save_plan(row: dict) -> dict:
    now = _now()
    if not enabled():
        existing = _MEM["plans"].get(row["id"], {})
        _MEM["plans"][row["id"]] = {**existing, **row, "created_at": existing.get("created_at", now),
                                    "updated_at": now}
        r = _MEM["plans"][row["id"]]
        return {**r, "created_at": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"])}
    async with session() as s:
        existing = await s.get(TripPlan, row["id"])
        if existing:
            for k in ("title", "brief", "plan"):
                if k in row:
                    setattr(existing, k, row[k])
            existing.updated_at = now
        else:
            s.add(TripPlan(**row, created_at=now, updated_at=now))
        await s.commit()
        return _row(await s.get(TripPlan, row["id"]), PLAN_FIELDS)


async def plans(uid: str) -> list[dict]:
    if not enabled():
        rows = [r for r in _MEM["plans"].values() if r["uid"] == uid]
        return sorted([{**r, "created_at": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"])}
                       for r in rows], key=lambda r: r["updated_at"], reverse=True)
    async with session() as s:
        stmt = select(TripPlan).where(TripPlan.uid == uid).order_by(TripPlan.updated_at.desc())
        return [_row(p, PLAN_FIELDS) for p in (await s.execute(stmt)).scalars().all()]


async def plan(plan_id: str) -> dict | None:
    if not enabled():
        r = _MEM["plans"].get(plan_id)
        return {**r, "created_at": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"])} if r else None
    async with session() as s:
        p = await s.get(TripPlan, plan_id)
        return _row(p, PLAN_FIELDS) if p else None


async def delete_plan(plan_id: str) -> None:
    if not enabled():
        _MEM["plans"].pop(plan_id, None)
        return
    async with session() as s:
        p = await s.get(TripPlan, plan_id)
        if p:
            await s.delete(p)
            await s.commit()


# ----------------------------------------------------------- notifications
NOTE_FIELDS = ("id", "uid", "key", "kind", "title", "body", "link", "channels", "read", "created_at")


async def add_notification(row: dict) -> dict | None:
    """Store a notification; None if this (uid, key) was already sent."""
    if not enabled():
        k = (row["uid"], row["key"])
        if k in _MEM["notes"]:
            return None
        r = {**row, "id": len(_MEM["notes"]) + 1, "read": False, "created_at": _now()}
        _MEM["notes"][k] = r
        return {**r, "created_at": _iso(r["created_at"])}
    async with session() as s:
        exists = (await s.execute(select(Notification.id).where(
            Notification.uid == row["uid"], Notification.key == row["key"]))).first()
        if exists:
            return None
        n = Notification(**row)
        s.add(n)
        await s.commit()
        return _row(n, NOTE_FIELDS)


async def notifications(uid: str, limit: int = 50) -> list[dict]:
    if not enabled():
        rows = [r for (u, _), r in _MEM["notes"].items() if u == uid]
        return sorted([{**r, "created_at": _iso(r["created_at"])} for r in rows],
                      key=lambda r: r["created_at"], reverse=True)[:limit]
    async with session() as s:
        stmt = (select(Notification).where(Notification.uid == uid)
                .order_by(Notification.created_at.desc()).limit(limit))
        return [_row(n, NOTE_FIELDS) for n in (await s.execute(stmt)).scalars().all()]


async def mark_read(uid: str) -> None:
    if not enabled():
        for (u, _), r in _MEM["notes"].items():
            if u == uid:
                r["read"] = True
        return
    async with session() as s:
        await s.execute(update(Notification).where(Notification.uid == uid).values(read=True))
        await s.commit()


async def device_tokens(uid: str) -> list[str]:
    if not enabled():
        return []
    async with session() as s:
        rows = (await s.execute(select(DeviceToken.token).where(DeviceToken.uid == uid))).all()
        return [r[0] for r in rows]


# ---------------------------------------------------------------- API keys
KEY_FIELDS = ("id", "uid", "label", "prefix", "requests", "revoked", "created_at", "last_used_at")


async def add_key(row: dict) -> dict:
    row = {**row, "created_at": _now(), "requests": 0, "revoked": False, "last_used_at": None}
    if not enabled():
        _MEM["keys"][row["id"]] = row
    else:
        async with session() as s:
            s.add(ApiKey(**row))
            await s.commit()
    return {k: _iso(row[k]) if isinstance(row.get(k), datetime) else row.get(k) for k in KEY_FIELDS}


async def keys(uid: str) -> list[dict]:
    if not enabled():
        rows = [r for r in _MEM["keys"].values() if r["uid"] == uid]
        return [{k: _iso(r[k]) if isinstance(r.get(k), datetime) else r.get(k) for k in KEY_FIELDS}
                for r in rows]
    async with session() as s:
        stmt = select(ApiKey).where(ApiKey.uid == uid).order_by(ApiKey.created_at.desc())
        return [_row(k, KEY_FIELDS) for k in (await s.execute(stmt)).scalars().all()]


async def key_by_hash(key_hash: str) -> dict | None:
    if not enabled():
        return next((r for r in _MEM["keys"].values() if r["key_hash"] == key_hash), None)
    async with session() as s:
        k = (await s.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))).scalar_one_or_none()
        return _row(k, KEY_FIELDS) if k else None


async def touch_key(key_id: str) -> None:
    if not enabled():
        r = _MEM["keys"].get(key_id)
        if r:
            r["requests"] += 1
            r["last_used_at"] = _now()
        return
    async with session() as s:
        await s.execute(update(ApiKey).where(ApiKey.id == key_id)
                        .values(requests=ApiKey.requests + 1, last_used_at=_now()))
        await s.commit()


async def revoke_key(uid: str, key_id: str) -> bool:
    if not enabled():
        r = _MEM["keys"].get(key_id)
        if r and r["uid"] == uid:
            r["revoked"] = True
            return True
        return False
    async with session() as s:
        k = await s.get(ApiKey, key_id)
        if not k or k.uid != uid:
            return False
        k.revoked = True
        await s.commit()
        return True


# ------------------------------------------------------------ road status
async def save_route_status(route: dict) -> bool:
    if not enabled():
        return False
    async with session() as s:
        r = await s.get(Route, route["id"])
        if not r:
            return False
        r.status, r.status_note = route["status"], route.get("status_note", "")
        r.source, r.origin = route.get("source", ""), route.get("origin", "manual")
        r.updated_by = route.get("updated_by", "")
        r.updated_at = datetime.fromisoformat(route["updated_at"])
        await s.commit()
    return True


async def stored_routes() -> list[dict]:
    """Road statuses as last saved, to lay over the seeded list at startup."""
    if not enabled():
        return []
    async with session() as s:
        rows = (await s.execute(select(Route))).scalars().all()
        return [{"id": r.id, "status": r.status, "status_note": r.status_note, "source": r.source,
                 "origin": r.origin, "updated_by": r.updated_by or "",
                 "updated_at": _iso(r.updated_at)} for r in rows]


async def user_count() -> int:
    if not enabled():
        return 0
    from .models import User
    async with session() as s:
        return (await s.execute(select(func.count()).select_from(User))).scalar() or 0


async def save_operator(op: dict) -> bool:
    if not enabled():
        return False
    from .models import Operator
    async with session() as s:
        row = await s.get(Operator, op["id"])
        if not row:
            return False
        for k in ("name", "base", "verified", "languages", "vehicles"):
            setattr(row, k, op.get(k, getattr(row, k)))
        await s.commit()
    return True


async def stored_operators() -> list[dict]:
    if not enabled():
        return []
    from .models import Operator
    async with session() as s:
        rows = (await s.execute(select(Operator))).scalars().all()
        return [{"id": o.id, "name": o.name, "base": o.base, "verified": o.verified,
                 "languages": o.languages, "vehicles": o.vehicles} for o in rows]
