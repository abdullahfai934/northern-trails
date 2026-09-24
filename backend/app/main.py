"""Northern Trails API — marketplace, live conditions, real-time matching, AI assistant."""
from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import re
import uuid
from datetime import date, timedelta
from typing import List, Optional

from fastapi import (Depends, FastAPI, HTTPException, Query, Request,
                     WebSocket, WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import (accounts, admin, alerts, assistant, auth, dashboard, data, devapi, photos,
               places, planner, push, safety, tripai)
from . import payments as pay
from .config import PAYMENTS_RETURN_URL, feature_report
from .geo import ROUTE_ENDPOINTS
from .db import records, repo
from .db import session as dbsession
from .matching import RESPONSE_WINDOW_SEC, hub
from .sources.poller import poller

log = logging.getLogger("northern_trails")

app = FastAPI(title="Northern Trails API", version="1.0.0",
              description="AI-powered tour marketplace & live conditions assistant for Northern Pakistan")

app.include_router(admin.router)
app.include_router(accounts.router)
app.include_router(dashboard.router)
app.include_router(devapi.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ schemas
class TripRequest(BaseModel):
    traveler_id: str = Field(..., examples=["trv-demo"])
    traveler_name: str = "Traveler"
    service: str = Field(..., examples=["jeep"])
    pickup: str
    dropoff: str
    when: str = "now"
    passengers: int = 2
    distance_km: Optional[int] = None
    notes: str = ""


class OfferIn(BaseModel):
    operator_id: str
    price_pkr: int
    eta_min: int
    message: str = ""


class RejectIn(BaseModel):
    operator_id: str
    reason: str = ""


class AcceptIn(BaseModel):
    offer_id: str


class ChatIn(BaseModel):
    message: str
    history: List[dict] = []


class AvailabilityIn(BaseModel):
    available: bool


class DeviceIn(BaseModel):
    token: str
    platform: str = "web"
    watch_routes: List[str] = []


class PaymentStartIn(BaseModel):
    booking_id: str
    provider: str = ""
    email: str = ""
    phone: str = ""


PHONE_RE = re.compile(r"^\+?[0-9][0-9\s-]{8,17}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


class BookingIn(BaseModel):
    package_id: str
    traveler_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field("", max_length=160)
    phone: str = Field("", max_length=24)
    start_date: str = ""
    travelers: int = Field(2, ge=1, le=20)
    notes: str = Field("", max_length=500)

    @field_validator("traveler_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Enter the lead traveler's full name")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip()
        if v and not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if v and not PHONE_RE.match(v):
            raise ValueError("Enter a phone number like +92 300 1234567")
        return v

    @field_validator("start_date")
    @classmethod
    def _start(cls, v: str) -> str:
        v = v.strip()
        if not v:
            return v
        try:
            d = date.fromisoformat(v)
        except ValueError:
            raise ValueError("Start date must be YYYY-MM-DD")
        if d < date.today():
            raise ValueError("Start date is in the past")
        if d > date.today() + timedelta(days=730):
            raise ValueError("Start date is more than two years away")
        return v


# ------------------------------------------------------------- marketplace
class PlanIn(BaseModel):
    destination: str = ""
    start_city: str = ""
    budget_pkr: int = Field(0, ge=0)
    days: int = Field(0, ge=0, le=60)
    people: int = Field(1, ge=1, le=40)
    interests: List[str] = Field(default_factory=list)
    travel_date: str = ""


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "assistant_engine": "gemini" if assistant.GEMINI_KEY else "grounded-offline",
        "features": feature_report(),
    }


@app.get("/api/bootstrap")
def bootstrap():
    """Everything the client needs on first paint, in one round trip."""
    return {
        "packages": [data.package_with_operator(p) for p in data.PACKAGES],
        "operators": data.OPERATORS,
        "routes": [{**r, "endpoints": ROUTE_ENDPOINTS.get(r["id"])} for r in data.ROUTES],
        "alerts": data.ALERTS,
        "weather": data.WEATHER,
        "services": data.SERVICE_TYPES,
        "cities": data.CITIES,
        "destinations": data.DESTINATIONS,
        "suggestions": assistant.SUGGESTIONS,
    }


@app.get("/api/packages", dependencies=[Depends(devapi.rate_limited)])
def list_packages(
    q: str = "",
    destination: str = "",
    pickup: str = "",
    max_price: int = Query(0, ge=0),
    min_days: int = Query(0, ge=0),
    max_days: int = Query(0, ge=0),
    sort: str = "recommended",
):
    items = [data.package_with_operator(p) for p in data.PACKAGES]
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p["title"].lower() or ql in p["destination"].lower()
                 or any(ql in t.lower() for t in p["tags"]) or ql in p["operator"]["name"].lower()]
    if destination:
        items = [p for p in items if p["destination"].lower() == destination.lower()]
    if pickup:
        items = [p for p in items if p["pickup"].lower() == pickup.lower()]
    if max_price:
        items = [p for p in items if p["price_pkr"] <= max_price]
    if min_days:
        items = [p for p in items if p["days"] >= min_days]
    if max_days:
        items = [p for p in items if p["days"] <= max_days]

    keys = {
        "price_asc": lambda p: p["price_pkr"],
        "price_desc": lambda p: -p["price_pkr"],
        "duration": lambda p: p["days"],
        "rating": lambda p: -p["rating"],
        "recommended": lambda p: (-p["rating"], p["price_pkr"]),
    }
    items.sort(key=keys.get(sort, keys["recommended"]))
    return {"count": len(items), "items": items}


@app.get("/api/packages/{package_id}", dependencies=[Depends(devapi.rate_limited)])
def get_package(package_id: str):
    pkg = next((p for p in data.PACKAGES if p["id"] == package_id), None)
    if not pkg:
        raise HTTPException(404, "Package not found")
    full = data.package_with_operator(pkg)
    ridx = data.route_index()
    full["route_conditions"] = [ridx[r] for r in pkg["routes"] if r in ridx]
    full["active_alerts"] = [a for a in data.ALERTS if set(a["routes"]) & set(pkg["routes"])]
    dest = data.destination_by_name(pkg["destination"])
    if dest:
        full["destination_info"] = {k: dest[k] for k in ("id", "name", "lat", "lon", "elevation_m",
                                                         "attractions", "blurb")}
    return full


@app.get("/api/photos")
async def place_photos(q: str = Query(..., min_length=2, max_length=80),
                       count: int = Query(6, ge=1, le=12)):
    """Landscape photos of a place, with author and licence for each."""
    return await photos.search(q, count)


@app.get("/api/places/restaurants")
async def nearby_restaurants(destination: str = "", lat: Optional[float] = None,
                             lon: Optional[float] = None):
    """Named places to eat near a destination (or a lat/lon), nearest first."""
    if lat is not None and not (-90 <= lat <= 90) or lon is not None and not (-180 <= lon <= 180):
        raise HTTPException(400, "lat/lon out of range")
    result = await places.nearby(destination, lat, lon)
    if not result["ok"] and "Unknown destination" in result.get("error", ""):
        raise HTTPException(404, result["error"])
    return result


@app.get("/api/images/{image_id}")
async def uploaded_image(image_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", image_id):
        raise HTTPException(404, "Image not found")
    hit = await repo.get_image(image_id)
    if not hit:
        raise HTTPException(404, "Image not found")
    content_type, blob = hit
    return Response(blob, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/destinations", dependencies=[Depends(devapi.rate_limited)])
def list_destinations():
    """Destination catalogue, each with its Safety Score and Travel Condition Score."""
    return {"items": [
        {**d, "safety": safety.score(d), "travel_condition": planner.travel_condition(d)}
        for d in data.DESTINATIONS
    ]}


@app.get("/api/restaurants", dependencies=[Depends(devapi.rate_limited)])
async def restaurants_near(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    """Restaurants near a point, nearest first (public API shape)."""
    return await places.nearby("", lat, lng)


@app.get("/api/places/pois")
async def points_of_interest(kind: str, lat: float = Query(..., ge=-90, le=90),
                             lng: float = Query(..., ge=-180, le=180),
                             radius: int = Query(15000, ge=500, le=50000)):
    """Hospitals, petrol pumps, police stations or hotels near a point."""
    result = await places.pois(kind, lat, lng, radius)
    if not result["ok"] and "kind must be" in result.get("error", ""):
        raise HTTPException(422, result["error"])
    return result


@app.get("/api/safety")
def safety_scores():
    """Safety Score out of 100 for every destination, with its working."""
    return {"items": safety.all_scores()}


@app.get("/api/recommendations")
def recommendations():
    """Best places to visit this week, from the forecast, roads and season."""
    return {"items": safety.recommendations()}


@app.get("/api/destinations/{destination_id}")
def get_destination(destination_id: str):
    dest = data.destination_index().get(destination_id)
    if not dest:
        raise HTTPException(404, "Destination not found")
    ridx = data.route_index()
    return {
        **dest,
        "travel_condition": planner.travel_condition(dest),
        "routes": [ridx[r] for r in dest["routes"] if r in ridx],
        "packages": [data.package_with_operator(p) for p in data.PACKAGES
                     if p["destination"] == dest["name"]],
    }


@app.post("/api/plan")
def plan_trip(body: PlanIn):
    """Compare every destination against one traveler's stated requirements."""
    return planner.plan(
        destination=body.destination, start_city=body.start_city,
        budget_pkr=body.budget_pkr, days=body.days, people=body.people,
        interests=body.interests, travel_date=body.travel_date,
    )


class AiPlanIn(BaseModel):
    days: int = Field(..., ge=1, le=21)
    budget_pkr: int = Field(0, ge=0, le=10_000_000)
    people: int = Field(2, ge=1, le=40)
    start_city: str = Field("Islamabad", max_length=60)
    interests: List[str] = Field(default_factory=list, max_length=10)
    destination: str = Field("", max_length=60)
    travel_date: str = Field("", max_length=10)


@app.post("/api/plan/ai")
async def ai_plan(body: AiPlanIn, user: auth.Identity = Depends(auth.require_user)):
    """A day-by-day itinerary built from real packages, restaurants and
    destinations. Costs are computed here, never by the model."""
    return await tripai.build(body.model_dump())


class SavePlanIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    brief: dict = Field(default_factory=dict)
    plan: dict


@app.get("/api/me/plans")
async def my_plans(user: auth.Identity = Depends(auth.require_user)):
    return {"items": await records.plans(user.uid)}


@app.post("/api/me/plans", status_code=201)
async def save_plan(body: SavePlanIn, user: auth.Identity = Depends(auth.require_user)):
    pid = str(body.plan.get("id") or "") or "plan-" + uuid.uuid4().hex[:10]
    existing = await records.plan(pid)
    if existing and existing["uid"] != user.uid:
        pid = "plan-" + uuid.uuid4().hex[:10]
    return await records.save_plan({"id": pid, "uid": user.uid, "title": body.title.strip(),
                                    "brief": body.brief, "plan": {**body.plan, "id": pid}})


@app.delete("/api/me/plans/{plan_id}")
async def delete_plan(plan_id: str, user: auth.Identity = Depends(auth.require_user)):
    existing = await records.plan(plan_id)
    if not existing or existing["uid"] != user.uid:
        raise HTTPException(404, "Plan not found")
    await records.delete_plan(plan_id)
    return {"deleted": plan_id}


@app.get("/api/plan/methodology")
def plan_methodology():
    """How the Travel Condition Score is calculated, weights included."""
    return planner.methodology()


@app.post("/api/bookings")
async def create_booking(body: BookingIn, user: auth.Identity = Depends(auth.require_user)):
    """Create a booking in `pending_payment`; checkout confirms it."""
    pkg = next((p for p in data.PACKAGES if p["id"] == body.package_id), None)
    if not pkg:
        raise HTTPException(404, "Package not found")
    ridx = data.route_index()
    warnings = [
        f"{ridx[r]['name']} is currently {ridx[r]['status']} — {ridx[r]['status_note']}"
        for r in pkg["routes"] if r in ridx and ridx[r]["status"] in ("closed", "restricted", "caution")
    ]
    travelers = max(1, body.travelers)
    total = pkg["price_pkr"] * travelers
    booking_id = "NT-" + pkg["id"].split("-")[1].upper() + "-" + uuid.uuid4().hex[:6].upper()

    stored = await repo.create_booking({
        "id": booking_id, "package_id": pkg["id"],
        "uid": None if user.anonymous else user.uid,
        "traveler_name": body.traveler_name, "email": body.email or user.email,
        "phone": body.phone or user.phone, "start_date": body.start_date,
        "travelers": travelers, "total_pkr": total,
        "status": "pending_payment", "condition_warnings": warnings,
        "notes": body.notes.strip(),
    })

    return {
        "booking_id": booking_id,
        "status": "pending_payment",
        "package": pkg["title"],
        "package_id": pkg["id"],
        "operator": data.operator_index()[pkg["operator_id"]]["name"],
        "total_pkr": total,
        "travelers": travelers,
        "condition_warnings": warnings,
        "persisted": stored,
        "payment": {"required": True, "providers": pay.available()},
    }


@app.get("/api/bookings/{booking_id}")
async def get_booking(booking_id: str, user: auth.Identity = Depends(auth.current_user)):
    """A booking, for its owner or for staff. Bookings hold names and phone
    numbers, so a guessed id must not be enough to read one."""
    row = await records.booking(booking_id)
    if not row:
        raise HTTPException(404, "Booking not found")
    owner = row.get("uid")
    if owner and not (user.uid == owner or user.role in ("admin", "operator")):
        raise HTTPException(404, "Booking not found")
    return {
        "booking_id": row["id"], "package_id": row["package_id"], "status": row["status"],
        "total_pkr": row["total_pkr"], "travelers": row["travelers"],
        "traveler_name": row["traveler_name"], "start_date": row["start_date"],
        "condition_warnings": row["condition_warnings"], "created_at": row["created_at"],
    }


# ---------------------------------------------------------- live conditions
@app.get("/api/conditions")
def conditions(valley: str = ""):
    routes = data.ROUTES
    if valley:
        routes = [r for r in routes if r["valley"].lower() == valley.lower()]
    return {"routes": routes, "alerts": data.ALERTS, "weather": data.WEATHER}


@app.get("/api/conditions/sources")
def condition_sources():
    """Which live sources are up, and how much of the layer they cover.

    Declared before /api/conditions/{route_id} on purpose — FastAPI matches
    routes in order, so the path parameter would otherwise swallow this.
    """
    return poller.status()


@app.post("/api/conditions/refresh")
async def refresh_conditions():
    """Force a poll cycle now instead of waiting for the interval."""
    return await poller.refresh_all()


@app.get("/api/conditions/{key}", dependencies=[Depends(devapi.rate_limited)])
def condition(key: str):
    """Conditions for a destination (id or name): weather, earthquakes within
    100 km this week, road status and the Safety Score. A route id returns
    that road with its alerts."""
    r = data.route_index().get(key)
    if r:
        return {**r, "alerts": [a for a in data.ALERTS if key in a["routes"]]}
    dest = data.destination_index().get(key) or data.destination_by_name(key.replace("-", " "))
    if not dest:
        raise HTTPException(404, "No destination or route with that id. Try /api/destinations.")
    score = safety.score(dest)
    return {
        "destination": {k: dest[k] for k in ("id", "name", "lat", "lon", "elevation_m")},
        "weather": score["parts"]["weather"]["reading"],
        "earthquakes": score["parts"]["earthquakes"]["events"],
        "roads": score["parts"]["road"]["routes"],
        "alerts": [a for a in data.ALERTS if set(a.get("routes", [])) & set(dest["routes"])],
        "safety": {k: score[k] for k in ("score", "level", "label", "color", "summary")},
        "computed_at": score["computed_at"],
    }


@app.get("/api/operators")
def operators():
    return {"items": data.OPERATORS, "availability": hub.availability}


# ------------------------------------------------------- on-demand matching
@app.get("/api/trips/quote")
async def trip_quote(service: str, pickup: str, dropoff: str, passengers: int = 1):
    """Price a trip before committing to it, from the real road route."""
    if pickup not in data.CITIES or dropoff not in data.CITIES:
        raise HTTPException(
            400, "Northern Trails covers Gilgit-Baltistan and Chitral only. "
                 f"Pick from: {', '.join(data.CITIES)}")
    if pickup == dropoff:
        raise HTTPException(400, "Pickup and drop-off are the same place")
    return await hub.quote({"service": service, "pickup": pickup,
                            "dropoff": dropoff, "passengers": passengers})


@app.post("/api/trips/request")
async def request_trip(body: TripRequest, user: auth.Identity = Depends(auth.current_user)):
    # This product covers the northern network only; refuse anything else
    # rather than quoting a route it cannot actually serve.
    if body.pickup not in data.CITIES or body.dropoff not in data.CITIES:
        raise HTTPException(
            400, "Northern Trails covers Gilgit-Baltistan and Chitral only. "
                 f"Pick from: {', '.join(data.CITIES)}")
    if body.pickup == body.dropoff:
        raise HTTPException(400, "Pickup and drop-off are the same place")
    payload = body.model_dump()
    if not user.anonymous:
        payload["uid"] = user.uid
    return await hub.create_request(payload)


@app.get("/api/trips/history/{traveler_id}")
async def trip_history(traveler_id: str, limit: int = Query(20, ge=1, le=100)):
    """A traveler's real ride records, not the in-flight animation."""
    return {"items": await repo.trips_for_traveler(traveler_id, limit)}


@app.get("/api/trips/{request_id}")
def get_trip(request_id: str):
    req = hub.requests.get(request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    return req


@app.post("/api/trips/{request_id}/offer")
async def make_offer(request_id: str, body: OfferIn,
                     user: auth.Identity = Depends(auth.require_role("operator"))):
    _act_as(user, body.operator_id)
    offer = await hub.offer(request_id, body.operator_id, body.price_pkr, body.eta_min, body.message)
    if not offer:
        raise HTTPException(409, "Request is no longer open")
    return offer


@app.post("/api/trips/{request_id}/reject")
async def reject_offer(request_id: str, body: RejectIn,
                       user: auth.Identity = Depends(auth.require_role("operator"))):
    _act_as(user, body.operator_id)
    await hub.reject(request_id, body.operator_id, body.reason)
    return {"ok": True}


@app.post("/api/trips/{request_id}/accept")
async def accept_offer(request_id: str, body: AcceptIn):
    req = await hub.accept_offer(request_id, body.offer_id)
    if not req:
        raise HTTPException(409, "Offer is no longer available")
    return req


def _require_operator(operator_id: str) -> dict:
    """Reject unknown operator ids.

    Without this the console accepted any string: a made-up id returned a
    job list and could toggle availability, writing phantom entries into
    the dispatcher's state.
    """
    op = data.operator_index().get(operator_id)
    if not op:
        raise HTTPException(404, f"No verified operator with id '{operator_id}'")
    return op


def _act_as(user: auth.Identity, operator_id: str) -> None:
    """An operator account may only act for its own operator; admins for any."""
    if user.role != "admin" and user.operator_id != operator_id:
        raise HTTPException(403, "This operator console belongs to another operator.")


@app.get("/api/operators/{operator_id}/jobs")
def operator_jobs(operator_id: str, user: auth.Identity = Depends(auth.require_role("operator"))):
    """This operator's own work queue.

    Scoped deliberately: `open` lists only requests actually dispatched to
    them and not yet bid on, rather than every open request on the
    platform, which would let anyone bid on work never offered to them.
    """
    op = _require_operator(operator_id)
    _act_as(user, operator_id)
    return {
        "operator_id": operator_id,
        "operator": op["name"],
        "available": hub.availability.get(operator_id, True),
        "open": hub.open_jobs_for(operator_id),
        "awaiting": hub.jobs_bid_on(operator_id),
        "active": hub.active_jobs_for(operator_id),
        "stats": hub.operator_stats(operator_id),
        "response_window_sec": RESPONSE_WINDOW_SEC,
    }


@app.get("/api/operators/{operator_id}")
def operator_detail(operator_id: str):
    op = _require_operator(operator_id)
    return {**op,
            "available": hub.availability.get(operator_id, True),
            "stats": hub.operator_stats(operator_id),
            "packages": [p["id"] for p in data.PACKAGES
                         if p["operator_id"] == operator_id]}


@app.post("/api/operators/{operator_id}/availability")
def set_availability(operator_id: str, body: AvailabilityIn,
                     user: auth.Identity = Depends(auth.require_role("operator"))):
    _require_operator(operator_id)
    _act_as(user, operator_id)
    hub.set_availability(operator_id, body.available)
    return {"operator_id": operator_id, "available": body.available,
            "open_jobs": len(hub.open_jobs_for(operator_id))}



# ------------------------------------------------------------ auth & push
@app.get("/api/auth/config")
def auth_config():
    """Tells the SPA whether to show the phone-login screen at all."""
    return {"enabled": auth.enabled(), "required": auth.AUTH_REQUIRED}


@app.get("/api/auth/me")
async def auth_me(user: auth.Identity = Depends(auth.current_user)):
    return {"uid": user.uid, "phone": user.phone, "anonymous": user.anonymous,
            "sign_in_provider": user.claims.get("firebase", {}).get("sign_in_provider", "")}


@app.post("/api/devices/register")
async def register_device(body: DeviceIn, user: auth.Identity = Depends(auth.current_user)):
    """Store an FCM token so this device gets condition-change pushes."""
    if not body.token.strip():
        raise HTTPException(400, "Missing device token")
    await repo.register_device(user.uid, body.token.strip(), body.platform, body.watch_routes)
    return {"ok": True, "uid": user.uid, "push_enabled": push.enabled(),
            "watching": body.watch_routes}


# ---------------------------------------------------------------- payments
@app.get("/api/payments/providers")
def payment_providers():
    return {"providers": pay.available(), "active": pay.get_provider().name}


@app.post("/api/payments/start")
async def start_payment(body: PaymentStartIn):
    """Create a transaction and hand back a form for the browser to POST."""
    booking = await repo.get_booking(body.booking_id)
    if not booking:
        raise HTTPException(404, "Booking not found — create the booking first")
    if booking.status == "confirmed":
        raise HTTPException(409, "This booking is already paid")
    amount = booking.total_pkr
    description = f"Northern Trails booking {booking.id}"
    email = body.email or booking.email
    phone = body.phone or booking.phone

    provider = pay.get_provider(body.provider)
    txn = pay.txn_ref()
    checkout = provider.start(
        txn=txn, amount_pkr=amount, booking_id=body.booking_id,
        description=description, return_url=PAYMENTS_RETURN_URL,
        email=email, phone=phone,
    )
    await repo.save_payment({
        "id": txn, "booking_id": body.booking_id, "provider": provider.name,
        "amount_pkr": amount, "status": "initiated",
    })
    return checkout.as_dict()


async def _settle(payload: dict, provider_name: str = ""):
    provider = pay.get_provider(provider_name)
    verdict = provider.verify(payload)
    if not verdict.txn_ref:
        raise HTTPException(400, "Callback carried no transaction reference")
    if not verdict.verified:
        # A callback we cannot authenticate never confirms a booking.
        log.warning("payment callback failed verification: %s", verdict.txn_ref)
    booking_id = await repo.settle_payment(
        verdict.txn_ref, verdict.status, verdict.code, verdict.message,
        verdict.raw, verdict.provider_ref)
    return verdict, booking_id


@app.post("/api/payments/callback")
async def payment_callback(request: Request, provider: str = ""):
    """Gateway post-back. Verifies the signature before confirming anything."""
    form = await request.form()
    payload = dict(form) if form else dict(await _safe_json(request))
    verdict, booking_id = await _settle(payload, provider)
    return {"txn_ref": verdict.txn_ref, "paid": verdict.paid,
            "verified": verdict.verified, "code": verdict.code,
            "message": verdict.message, "booking_id": booking_id}


async def _safe_json(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


@app.get("/api/payments/mock/checkout")
def mock_checkout(txn_ref: str = "", amount_pkr: str = "0", booking_id: str = "",
                  return_url: str = "", signature: str = "", description: str = ""):
    """The sandbox gateway screen: approve or decline, like a real hosted page."""
    from .payments.mock import sign
    base = {"txn_ref": txn_ref, "amount_pkr": amount_pkr, "booking_id": booking_id,
            "description": description, "return_url": return_url}
    approve = dict(base, code="000", message="Approved", provider_ref="MOCK-" + txn_ref[-6:])
    decline = dict(base, code="124", message="Declined by issuer", provider_ref="")
    approve["signature"], decline["signature"] = sign(approve), sign(decline)

    def form(fields: dict, label: str, css: str) -> str:
        inputs = "".join(
            f'<input type="hidden" name="{k}" value="{v}">' for k, v in fields.items())
        return (f'<form method="post" action="/api/payments/mock/complete">{inputs}'
                f'<button class="{css}">{label}</button></form>')

    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8">
<title>Sandbox gateway — Northern Trails</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{{font-family:system-ui,sans-serif;background:#070b14;color:#e8eef9;
      display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}}
 .card{{background:#0f1729;border:1px solid #23304a;border-radius:16px;
       padding:28px;max-width:420px;width:100%}}
 h1{{font-size:17px;margin:0 0 4px}} .muted{{color:#8fa3c4;font-size:13px;margin:0 0 18px}}
 .amt{{font-size:30px;font-weight:700;margin:14px 0}}
 .row{{display:flex;gap:10px;margin-top:18px}} form{{flex:1}}
 button{{width:100%;padding:11px;border-radius:9px;border:0;font-weight:600;cursor:pointer;font-size:14px}}
 .ok{{background:#3ddc97;color:#04210f}} .no{{background:#2a3550;color:#e8eef9}}
 code{{color:#8fa3c4;font-size:11px}}
</style></head><body><div class="card">
<h1>Sandbox payment gateway</h1>
<p class="muted">No real money moves. This screen stands in for JazzCash or Easypaisa
hosted checkout and signs its callback the same way.</p>
<div>Booking <strong>{booking_id}</strong></div>
<div class="amt">PKR {int(float(amount_pkr or 0)):,}</div>
<code>txn {txn_ref}</code>
<div class="row">{form(approve, 'Approve payment', 'ok')}{form(decline, 'Decline', 'no')}</div>
</div></body></html>""")


@app.post("/api/payments/mock/complete")
async def mock_complete(request: Request):
    form = await request.form()
    payload = dict(form)
    return_url = payload.get("return_url", "") or "/"
    verdict, booking_id = await _settle(payload, "mock")
    sep = "&" if "?" in return_url else "?"
    return RedirectResponse(
        f"{return_url}{sep}txn={verdict.txn_ref}&paid={str(verdict.paid).lower()}"
        f"&booking={booking_id or payload.get('booking_id','')}",
        status_code=303)


# ------------------------------------------------------------ AI assistant
@app.post("/api/assistant/chat")
async def chat(body: ChatIn):
    if not body.message.strip():
        raise HTTPException(400, "Empty message")
    return await assistant.answer(body.message, body.history)


# --------------------------------------------------------------- websockets
@app.websocket("/ws/traveler/{traveler_id}")
async def ws_traveler(ws: WebSocket, traveler_id: str):
    await ws.accept()
    await hub.join("traveler", traveler_id, ws)
    await ws.send_json({"type": "hello", "role": "traveler", "id": traveler_id})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await hub.leave("traveler", traveler_id, ws)


@app.websocket("/ws/operator/{operator_id}")
async def ws_operator(ws: WebSocket, operator_id: str):
    await ws.accept()
    await hub.join("operator", operator_id, ws)
    await ws.send_json({"type": "hello", "role": "operator", "id": operator_id,
                        "open_jobs": hub.open_jobs()})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await hub.leave("operator", operator_id, ws)



# --------------------------------------------------------------- lifecycle
@app.on_event("startup")
async def on_startup():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    report = feature_report()
    log.info("starting Northern Trails — %s", report)

    if dbsession.enabled():
        try:
            await dbsession.init_db()
            from .db.seed import seed_all
            await seed_all()
            loaded = await admin.load_saved_packages()
            if loaded:
                log.info("loaded %d packages saved from the admin screen", loaded)
            await _load_saved_state()
        except Exception:
            # A database problem must not stop the app booting: it falls
            # back to the in-memory layer, which is fully functional.
            log.exception("database setup failed — continuing in-memory")
    else:
        log.info("no DATABASE_URL — using the in-memory data layer")

    try:
        await accounts.apply_review_ratings()
    except Exception:
        log.exception("could not apply review ratings")
    poller.on_route_change = _route_changed
    poller.start()
    global _alert_task
    if os.environ.get("ALERTS_ENABLED", "1").lower() in ("1", "true", "yes"):
        _alert_task = asyncio.create_task(alerts.loop())


_alert_task = None


async def _load_saved_state() -> None:
    """Road statuses and operator edits as last saved, over the seed data.

    The first boot writes the seed into the database; from then on the
    database is the record, so a status an operator set — and when they set
    it — survives restarts and redeploys."""
    ridx = data.route_index()
    for row in await records.stored_routes():
        r = ridx.get(row["id"])
        if r:
            r.update({k: row[k] for k in ("status", "status_note", "source", "origin", "updated_by",
                                          "updated_at") if row.get(k) not in (None, "")})
    oidx = data.operator_index()
    for row in await records.stored_operators():
        o = oidx.get(row["id"])
        if o:
            o.update({k: v for k, v in row.items() if v not in (None, "")})


async def _route_changed(route: dict, previous: str, current: str) -> None:
    """Fan a road-status change out to watchers and any connected sockets."""
    try:
        await push.notify_condition_change(route, previous, current)
    except Exception:
        log.exception("push for %s failed", route.get("id"))
    try:
        await hub.to_all_operators({
            "type": "condition.change", "route_id": route["id"],
            "name": route.get("name", ""), "previous": previous, "current": current,
            "note": route.get("status_note", ""),
        })
    except Exception:
        log.exception("socket broadcast for %s failed", route.get("id"))


@app.on_event("shutdown")
async def on_shutdown():
    if _alert_task:
        _alert_task.cancel()
    await poller.stop()
    if dbsession.enabled():
        await dbsession.dispose()
    log.info("shutdown complete")


# ------------------------------------------------- serve built SPA (prod)
DIST = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
