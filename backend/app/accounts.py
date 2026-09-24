"""Signed-in traveler endpoints: profile, bookings, wishlist, notifications,
reviews. Everything here requires a Firebase ID token, and every query is
scoped to the caller's uid — no endpoint takes a user id from the client.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import auth, data, profiles
from .db import records

router = APIRouter(tags=["account"])

PHONE_RE = re.compile(r"^\+?[0-9][0-9\s-]{8,17}$")


def public_profile(user: auth.Identity) -> dict:
    p = user.profile
    return {
        "uid": user.uid, "email": user.email or p.get("email", ""), "phone": user.phone or p.get("phone", ""),
        "name": user.name, "role": user.role, "operator_id": p.get("operator_id", ""),
        "emergency_contact": p.get("emergency_contact") or {"name": "", "phone": ""},
        "wishlist": p.get("wishlist", []), "language": p.get("language", "en"),
        "notify_email": p.get("notify_email", True), "notify_push": p.get("notify_push", True),
        "provider": user.claims.get("firebase", {}).get("sign_in_provider", ""),
        "email_verified": bool(user.claims.get("email_verified")),
        "created_at": p.get("created_at", ""),
    }


# ----------------------------------------------------------------- profile
class EmergencyContact(BaseModel):
    name: str = Field("", max_length=80)
    phone: str = Field("", max_length=24)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if v and not PHONE_RE.match(v):
            raise ValueError("Enter a phone number like +92 300 1234567")
        return v


class ProfileIn(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    emergency_contact: Optional[EmergencyContact] = None
    language: Optional[str] = Field(None, pattern="^(en|ur)$")
    notify_email: Optional[bool] = None
    notify_push: Optional[bool] = None


@router.get("/api/me")
async def me(user: auth.Identity = Depends(auth.require_user)):
    return public_profile(user)


@router.patch("/api/me")
async def update_me(body: ProfileIn, user: auth.Identity = Depends(auth.require_user)):
    fields = body.model_dump(exclude_none=True)
    if "name" in fields:
        fields["name"] = " ".join(fields["name"].split())
    user.profile = {**user.profile, **(await profiles.update(user.uid, fields))}
    return public_profile(user)


# ---------------------------------------------------------------- wishlist
class WishlistIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=200)


@router.put("/api/me/wishlist")
async def set_wishlist(body: WishlistIn, user: auth.Identity = Depends(auth.require_user)):
    known = data.package_index()
    ids = list(dict.fromkeys(i for i in body.ids if i in known))
    await profiles.update(user.uid, {"wishlist": ids})
    return {"ids": ids}


# ---------------------------------------------------------------- bookings
def _trip_end(b: dict) -> date | None:
    pkg = data.package_index().get(b["package_id"])
    try:
        start = date.fromisoformat(b.get("start_date") or "")
    except ValueError:
        return None
    return start + timedelta(days=(pkg or {}).get("days", 1))


def reviewable(b: dict) -> bool:
    """A trip can be reviewed once it has run its course, or once an
    operator or admin marks it completed."""
    if b["status"] == "completed":
        return True
    end = _trip_end(b)
    return b["status"] == "confirmed" and end is not None and end <= date.today()


@router.get("/api/me/bookings")
async def my_bookings(user: auth.Identity = Depends(auth.require_user)):
    pidx = data.package_index()
    out = []
    for b in await records.bookings(uid=user.uid):
        pkg = pidx.get(b["package_id"])
        review = await records.review_for_booking(b["id"])
        out.append({**b, "package": {k: pkg[k] for k in ("id", "title", "destination", "days", "photo_query",
                                                          "images", "operator_id") if k in pkg} if pkg else None,
                    "can_review": reviewable(b) and review is None,
                    "review": review})
    return {"items": out}


# ----------------------------------------------------------- notifications
@router.get("/api/me/notifications")
async def my_notifications(user: auth.Identity = Depends(auth.require_user)):
    items = await records.notifications(user.uid)
    return {"items": items, "unread": sum(1 for n in items if not n["read"])}


@router.post("/api/me/notifications/read")
async def read_all(user: auth.Identity = Depends(auth.require_user)):
    await records.mark_read(user.uid)
    return {"ok": True}


# ----------------------------------------------------------------- reviews
class ReviewIn(BaseModel):
    booking_id: str
    rating: int = Field(..., ge=1, le=5)
    guide_rating: Optional[int] = Field(None, ge=1, le=5)
    text: str = Field("", max_length=1500)
    photos: List[str] = Field(default_factory=list, max_length=4)

    @field_validator("photos")
    @classmethod
    def _photos(cls, v: List[str]) -> List[str]:
        for u in v:
            if not re.fullmatch(r"/api/images/[0-9a-f]{32}", u):
                raise ValueError("Photos must be uploaded through the review form")
        return v


@router.post("/api/reviews", status_code=201)
async def add_review(body: ReviewIn, user: auth.Identity = Depends(auth.require_user)):
    b = await records.booking(body.booking_id)
    if not b or b.get("uid") != user.uid:
        raise HTTPException(404, "Booking not found")
    if not reviewable(b):
        raise HTTPException(409, "You can review a trip once it has been completed.")
    if await records.review_for_booking(b["id"]):
        raise HTTPException(409, "You have already reviewed this trip.")
    pkg = data.package_index().get(b["package_id"]) or {}
    row = await records.add_review({
        "id": "rv-" + uuid.uuid4().hex[:12], "booking_id": b["id"], "package_id": b["package_id"],
        "operator_id": pkg.get("operator_id", ""), "uid": user.uid,
        "author": user.name or (b.get("traveler_name") or "Traveler").split()[0],
        "rating": body.rating, "guide_rating": body.guide_rating, "text": body.text.strip(),
        "photos": body.photos, "status": "pending",
    })
    return {**row, "note": "Thanks! Your review appears once an admin has approved it."}


@router.get("/api/packages/{package_id}/reviews")
async def package_reviews(package_id: str):
    items = await records.reviews(package_id=package_id, status="approved")
    for r in items:
        r.pop("uid", None)
    avg = round(sum(r["rating"] for r in items) / len(items), 1) if items else None
    return {"items": items, "count": len(items), "average": avg}


@router.get("/api/me/reviews")
async def my_reviews(user: auth.Identity = Depends(auth.require_user)):
    return {"items": await records.reviews(uid=user.uid)}


async def apply_review_ratings() -> None:
    """Fold approved reviews into package and operator ratings.

    A package's stored rating and review count stand for the reviews it had
    before this app existed; approved reviews here are averaged in on top.
    """
    approved = await records.reviews(status="approved")
    by_pkg: dict[str, list[int]] = {}
    by_op: dict[str, list[int]] = {}
    for r in approved:
        by_pkg.setdefault(r["package_id"], []).append(r["rating"])
        if r.get("guide_rating"):
            by_op.setdefault(r["operator_id"], []).append(r["guide_rating"])
    for p in data.PACKAGES:
        base_n, base_r = _BASE.setdefault("pkg:" + p["id"], (p.get("reviews", 0), p.get("rating", 0.0)))
        extra = by_pkg.get(p["id"], [])
        n = base_n + len(extra)
        p["reviews"] = n
        p["rating"] = round((base_r * base_n + sum(extra)) / n, 1) if n else 0.0
    for o in data.OPERATORS:
        base_n, base_r = _BASE.setdefault("op:" + o["id"], (max(o.get("trips", 0), 1), o.get("rating", 0.0)))
        extra = by_op.get(o["id"], [])
        o["rating"] = round((base_r * base_n + sum(extra)) / (base_n + len(extra)), 1)


#: Each package's and operator's rating before any in-app review, so
#: recomputing is idempotent.
_BASE: dict[str, tuple[int, float]] = {}
