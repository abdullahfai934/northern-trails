"""Package administration: add, edit and remove tour packages, upload photos.

Guarded by a shared secret, ADMIN_TOKEN, sent as the `X-Admin-Token` header.
With no token configured every route here answers 503, so a fresh deploy
never exposes an open admin surface.

A package added here is written to the database when one is configured and
loaded back over the seeded catalogue on startup. Without a database it lives
in memory until the next restart, and the response says so (`persisted`).
"""
from __future__ import annotations

import hmac
import re
import uuid
from typing import List, Literal

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from . import auth, config, data
from .db import repo

router = APIRouter(prefix="/api/admin", tags=["admin"])

#: Ids present at import time. These are the sample catalogue: they can be
#: edited (the edit is stored as an override) but not deleted.
SEED_IDS = frozenset(p["id"] for p in data.PACKAGES)

#: The illustrated scene the SPA draws while a destination's photos load.
HERO_FOR = {"Hunza": "hunza", "Skardu": "k2", "Deosai": "deosai",
            "Fairy Meadows": "fairy", "Chitral": "kalash"}

MAX_IMAGE_BYTES = 3 * 1024 * 1024
IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"RIFF": "image/webp",
}


def require_admin(x_admin_token: str = Header("", alias="X-Admin-Token")) -> None:
    if not config.ADMIN_TOKEN:
        raise HTTPException(503, "Package admin is switched off: set ADMIN_TOKEN on the server.")
    if not hmac.compare_digest(x_admin_token.encode(), config.ADMIN_TOKEN.encode()):
        raise HTTPException(401, "Wrong admin token.")


async def package_editor(x_admin_token: str = Header("", alias="X-Admin-Token"),
                         user: auth.Identity = Depends(auth.current_user)) -> auth.Identity:
    """Who may add and edit packages: a signed-in admin or operator, or a
    script holding ADMIN_TOKEN. Operators are limited to their own packages
    (checked in each route)."""
    if x_admin_token and config.ADMIN_TOKEN and hmac.compare_digest(
            x_admin_token.encode(), config.ADMIN_TOKEN.encode()):
        return auth.Identity(uid="admin-token", anonymous=False, profile={"role": "admin"})
    if user.anonymous:
        raise HTTPException(401, "Sign in with an operator or admin account.")
    if user.role not in ("admin", "operator"):
        raise HTTPException(403, "Only operators and admins can manage packages.")
    if user.role == "operator" and not user.operator_id:
        raise HTTPException(403, "Your operator account is not linked to an operator yet — ask an admin.")
    return user


def _own(user: auth.Identity, operator_id: str) -> None:
    if user.role == "operator" and operator_id != user.operator_id:
        raise HTTPException(403, "You can only manage your own operator's packages.")


# ------------------------------------------------------------------ schema
class ItineraryDay(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    body: str = Field("", max_length=600)


URL_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*\.[^\s]{2,}$", re.I)


def normalize_whatsapp(raw: str) -> str:
    """'+92 300 1234567', '0300-1234567' -> '923001234567' (wa.me format)."""
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:   # Pakistani local mobile
        digits = "92" + digits[1:]
    return digits


class PackageIn(BaseModel):
    title: str = Field(..., min_length=4, max_length=120)
    destination: str
    operator_id: str
    pickup: str = Field("Islamabad", min_length=2, max_length=60)
    price_pkr: int = Field(..., ge=1000, le=5_000_000)
    days: int = Field(..., ge=1, le=30)
    highlight: str = Field("", max_length=160)
    difficulty: Literal["Easy", "Moderate", "Challenging", "Expedition"] = "Moderate"
    group_size: str = Field("2–12", max_length=16)
    tags: List[str] = Field(default_factory=list, max_length=6)
    includes: List[str] = Field(default_factory=list, max_length=20)
    excludes: List[str] = Field(default_factory=list, max_length=20)
    itinerary: List[ItineraryDay] = Field(..., min_length=1, max_length=30)
    operator_url: str = Field("", max_length=500)
    whatsapp: str = Field("", max_length=24)
    images: List[str] = Field(default_factory=list, max_length=8)

    @field_validator("title", "pickup", "highlight", "group_size")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("destination")
    @classmethod
    def _known_destination(cls, v: str) -> str:
        dest = data.destination_by_name(v)
        if not dest:
            names = ", ".join(d["name"] for d in data.DESTINATIONS)
            raise ValueError(f"Pick a destination the conditions layer tracks: {names}")
        return dest["name"]

    @field_validator("operator_id")
    @classmethod
    def _known_operator(cls, v: str) -> str:
        if v not in data.operator_index():
            raise ValueError("Unknown operator")
        return v

    @field_validator("tags", "includes", "excludes")
    @classmethod
    def _clean_list(cls, v: List[str]) -> List[str]:
        out = [" ".join(x.split())[:120] for x in v if x and x.strip()]
        return list(dict.fromkeys(out))

    @field_validator("operator_url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if v and not URL_RE.match(v):
            raise ValueError("Enter a full web address starting with https://")
        return v

    @field_validator("whatsapp")
    @classmethod
    def _whatsapp(cls, v: str) -> str:
        digits = normalize_whatsapp(v)
        if digits and not 10 <= len(digits) <= 15:
            raise ValueError("Enter the WhatsApp number with country code, e.g. +92 300 1234567")
        return digits

    @field_validator("images")
    @classmethod
    def _images(cls, v: List[str]) -> List[str]:
        out = []
        for u in (x.strip() for x in v if x and x.strip()):
            if not (u.startswith("/api/images/") or URL_RE.match(u)):
                raise ValueError(f"Not an image address: {u[:60]}")
            out.append(u)
        return out


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "trip"


def _build(body: PackageIn, package_id: str, existing: dict | None) -> dict:
    dest = data.destination_by_name(body.destination)
    pkg = {
        # Ratings and review counts come from travelers, not from the admin
        # form: a new listing starts at zero rather than at a made-up score.
        "rating": 0.0, "reviews": 0,
        **(existing or {}),
        "id": package_id,
        "title": body.title, "destination": dest["name"], "operator_id": body.operator_id,
        "pickup": body.pickup, "price_pkr": body.price_pkr, "days": body.days,
        "highlight": body.highlight, "difficulty": body.difficulty,
        "group_size": body.group_size, "tags": body.tags,
        "includes": body.includes, "excludes": body.excludes,
        "itinerary": [(f"Day {i + 1}", d.title, d.body) for i, d in enumerate(body.itinerary)],
        "operator_url": body.operator_url, "whatsapp": body.whatsapp, "images": body.images,
        "routes": list(dest["routes"]),
        "hero": HERO_FOR.get(dest["name"], "hunza"),
        "photo_query": (existing or {}).get("photo_query") or dest.get("photo_query") or dest["name"],
        "source": "admin",
    }
    return data.normalize_package(pkg)


def _put(pkg: dict) -> None:
    for i, p in enumerate(data.PACKAGES):
        if p["id"] == pkg["id"]:
            data.PACKAGES[i] = pkg
            return
    data.PACKAGES.append(pkg)


# ------------------------------------------------------------------ routes
@router.get("/status")
def admin_status():
    """Whether admin is available at all. Needs no token."""
    return {"enabled": bool(config.ADMIN_TOKEN), "persistent": repo.enabled()}


@router.post("/verify")
def verify(x_admin_token: str = Header("", alias="X-Admin-Token")):
    """Check a token for the sign-in screen.

    Answers 200 either way, with `ok` saying whether it matched: a mistyped
    password is an expected outcome here, not an HTTP error. Every route that
    changes data still requires the token and answers 401 without it.
    """
    if not config.ADMIN_TOKEN:
        raise HTTPException(503, "Package admin is switched off: set ADMIN_TOKEN on the server.")
    ok = hmac.compare_digest(x_admin_token.encode(), config.ADMIN_TOKEN.encode())
    return {"ok": ok, "persistent": repo.enabled()}


@router.post("/packages", status_code=201)
async def create_package(body: PackageIn, user: auth.Identity = Depends(package_editor)):
    _own(user, body.operator_id)
    package_id = f"pkg-{_slug(body.destination)}-{_slug(body.title)[:24]}-{uuid.uuid4().hex[:4]}"
    pkg = _build(body, package_id, None)
    stored = await repo.save_package(pkg)
    _put(pkg)
    return {"package": data.package_with_operator(pkg), "persisted": stored}


@router.put("/packages/{package_id}")
async def update_package(package_id: str, body: PackageIn, user: auth.Identity = Depends(package_editor)):
    existing = data.package_index().get(package_id)
    if not existing:
        raise HTTPException(404, "Package not found")
    _own(user, existing["operator_id"])
    _own(user, body.operator_id)
    pkg = _build(body, package_id, existing)
    stored = await repo.save_package(pkg)
    _put(pkg)
    return {"package": data.package_with_operator(pkg), "persisted": stored}


@router.delete("/packages/{package_id}")
async def delete_package(package_id: str, user: auth.Identity = Depends(package_editor)):
    if package_id in SEED_IDS:
        raise HTTPException(403, "Sample packages can be edited but not deleted.")
    if package_id not in data.package_index():
        raise HTTPException(404, "Package not found")
    _own(user, data.package_index()[package_id]["operator_id"])
    stored = await repo.delete_package(package_id)
    data.PACKAGES[:] = [p for p in data.PACKAGES if p["id"] != package_id]
    return {"deleted": package_id, "persisted": stored}


@router.post("/images", status_code=201)
async def upload_image(file: UploadFile = File(...), user: auth.Identity = Depends(auth.current_user),
                       x_admin_token: str = Header("", alias="X-Admin-Token")):
    """Upload a photo. Operators and admins use it for packages; any
    signed-in traveler may use it for photos on their own review."""
    token_ok = bool(x_admin_token and config.ADMIN_TOKEN and hmac.compare_digest(
        x_admin_token.encode(), config.ADMIN_TOKEN.encode()))
    if user.anonymous and not token_ok:
        raise HTTPException(401, "Sign in to upload photos.")
    blob = await file.read(MAX_IMAGE_BYTES + 1)
    if len(blob) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is larger than 3 MB.")
    # Trust the bytes, not the filename or the declared content type.
    content_type = next((ct for sig, ct in IMAGE_SIGNATURES.items() if blob.startswith(sig)), None)
    if content_type == "image/webp" and blob[8:12] != b"WEBP":
        content_type = None
    if not content_type:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP image.")
    image_id = uuid.uuid4().hex
    stored = await repo.save_image(image_id, content_type, blob)
    return {"url": f"/api/images/{image_id}", "persisted": stored, "bytes": len(blob)}


async def load_saved_packages() -> int:
    """Lay packages saved from the admin screen over the seeded catalogue."""
    rows = await repo.admin_packages()
    for row in rows:
        if row.get("operator_id") not in data.operator_index():
            continue
        if row.get("source") == "archived":
            data.PACKAGES[:] = [p for p in data.PACKAGES if p["id"] != row["id"]]
            continue
        _put(data.normalize_package(row))
    return len(rows)
