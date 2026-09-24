"""Admin and operator management: statistics, bookings, reviews, users,
road status and operators.

Road status is the one thing operators may change as well as admins: they
are on the ground, and the NHA feed is unreachable from a server. Each change
records who made it and when, and the site shows that "last updated" line.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import accounts, auth, data, profiles
from .db import records

router = APIRouter(prefix="/api/admin", tags=["admin"])

admin_only = auth.require_role("admin")
staff = auth.require_role("operator")          # operators and admins


def _month(iso_ts: str) -> str:
    return (iso_ts or "")[:7]


@router.get("/stats")
async def stats(user: auth.Identity = Depends(admin_only)):
    bookings = await records.bookings()
    reviews = await records.reviews()
    pidx = data.package_index()
    per_month: dict[str, dict] = defaultdict(lambda: {"bookings": 0, "revenue_pkr": 0})
    for b in bookings:
        m = per_month[_month(b["created_at"])]
        m["bookings"] += 1
        if b["status"] in ("confirmed", "completed"):
            m["revenue_pkr"] += b["total_pkr"]
    dest = Counter(pidx[b["package_id"]]["destination"] for b in bookings if b["package_id"] in pidx)
    users = await profiles.list_all()
    active_uids = {b["uid"] for b in bookings if b.get("uid")}
    rating_hist = Counter(r["rating"] for r in reviews if r["status"] == "approved")
    return {
        "totals": {
            "bookings": len(bookings),
            "confirmed": sum(1 for b in bookings if b["status"] in ("confirmed", "completed")),
            "revenue_pkr": sum(b["total_pkr"] for b in bookings if b["status"] in ("confirmed", "completed")),
            "users": len(users) or await records.user_count(),
            "active_users": len(active_uids),
            "packages": len(data.PACKAGES),
            "pending_reviews": sum(1 for r in reviews if r["status"] == "pending"),
        },
        "per_month": [{"month": k, **v} for k, v in sorted(per_month.items()) if k][-12:],
        "popular_destinations": [{"destination": k, "bookings": v} for k, v in dest.most_common()],
        "ratings": [{"stars": s, "count": rating_hist.get(s, 0)} for s in range(1, 6)],
        "roles": dict(Counter(u["role"] for u in users)),
    }


# ---------------------------------------------------------------- bookings
@router.get("/bookings")
async def all_bookings(user: auth.Identity = Depends(staff)):
    items = await records.bookings()
    pidx = data.package_index()
    if user.role == "operator":           # an operator sees only their own trips
        items = [b for b in items if pidx.get(b["package_id"], {}).get("operator_id") == user.operator_id]
    for b in items:
        p = pidx.get(b["package_id"])
        b["package_title"] = p["title"] if p else b["package_id"]
    return {"items": items}


class BookingStatusIn(BaseModel):
    status: Literal["pending_payment", "confirmed", "completed", "cancelled"]


@router.patch("/bookings/{booking_id}")
async def booking_status(booking_id: str, body: BookingStatusIn, user: auth.Identity = Depends(staff)):
    b = await records.booking(booking_id)
    if not b:
        raise HTTPException(404, "Booking not found")
    if user.role == "operator":
        pkg = data.package_index().get(b["package_id"], {})
        if pkg.get("operator_id") != user.operator_id:
            raise HTTPException(403, "That booking is for another operator")
    return await records.set_booking_status(booking_id, body.status)


# ----------------------------------------------------------------- reviews
@router.get("/reviews")
async def all_reviews(status: Optional[str] = None, user: auth.Identity = Depends(admin_only)):
    return {"items": await records.reviews(status=status)}


class ModerateIn(BaseModel):
    status: Literal["approved", "rejected", "pending"]


@router.patch("/reviews/{review_id}")
async def moderate(review_id: str, body: ModerateIn, user: auth.Identity = Depends(admin_only)):
    r = await records.set_review_status(review_id, body.status)
    if not r:
        raise HTTPException(404, "Review not found")
    await accounts.apply_review_ratings()
    return r


# ------------------------------------------------------------------- users
@router.get("/users")
async def users(user: auth.Identity = Depends(admin_only)):
    return {"items": sorted(await profiles.list_all(), key=lambda u: u.get("created_at", ""), reverse=True)}


class RoleIn(BaseModel):
    role: Literal["tourist", "operator", "admin"]
    operator_id: str = ""


@router.patch("/users/{uid}")
async def set_role(uid: str, body: RoleIn, user: auth.Identity = Depends(admin_only)):
    if body.role == "operator" and body.operator_id not in data.operator_index():
        raise HTTPException(422, "Pick which operator this account runs")
    if uid == user.uid and body.role != "admin":
        raise HTTPException(409, "You cannot remove your own admin role")
    return await profiles.set_role(uid, body.role, body.operator_id)


# -------------------------------------------------------------- road status
class RouteStatusIn(BaseModel):
    status: Literal["open", "caution", "restricted", "seasonal", "closed"]
    status_note: str = Field(..., min_length=3, max_length=400)


@router.patch("/routes/{route_id}")
async def set_route(route_id: str, body: RouteStatusIn, user: auth.Identity = Depends(staff)):
    r = data.route_index().get(route_id)
    if not r:
        raise HTTPException(404, "Route not found")
    previous = r["status"]
    who = user.name or user.email or user.phone or "staff"
    org = data.operator_index().get(user.operator_id, {}).get("name") if user.role == "operator" else "Admin"
    r.update({
        "status": body.status, "status_note": body.status_note.strip(),
        "source": f"Reported by {who} ({org or 'operator'})", "origin": "manual",
        "updated_by": who, "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "confidence": 0.9,
    })
    persisted = await records.save_route_status(r)
    if previous != body.status:
        from .main import _route_changed          # push + socket fan-out, as for a live source
        await _route_changed(r, previous, body.status)
    return {**r, "persisted": persisted}


# --------------------------------------------------------------- operators
class OperatorIn(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=160)
    base: Optional[str] = Field(None, min_length=2, max_length=80)
    verified: Optional[bool] = None
    languages: Optional[List[str]] = None
    vehicles: Optional[List[str]] = None


@router.patch("/operators/{operator_id}")
async def edit_operator(operator_id: str, body: OperatorIn, user: auth.Identity = Depends(admin_only)):
    op = data.operator_index().get(operator_id)
    if not op:
        raise HTTPException(404, "Operator not found")
    op.update(body.model_dump(exclude_none=True))
    return {**op, "persisted": await records.save_operator(op)}
