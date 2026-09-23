"""PostgreSQL + PostGIS schema.

Geometry lives in `geography` columns (not `geometry`) so `ST_Distance`
returns metres over the spheroid without a projection step — which is what
the operator-proximity ranking needs in mountainous terrain.

The JSONB columns hold the genuinely document-shaped fields (itineraries,
verification checklists, forecast tuples). Everything the app filters,
sorts or joins on is a real column.
"""
from __future__ import annotations

from datetime import datetime, timezone

from geoalchemy2 import Geography
from sqlalchemy import (Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary,
                        String, Text, UniqueConstraint)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------- reference
class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    base: Mapped[str] = mapped_column(String(80))
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    trips: Mapped[int] = mapped_column(Integer, default=0)
    since: Mapped[int] = mapped_column(Integer, default=2020)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    response_min: Mapped[int] = mapped_column(Integer, default=5)
    avatar_hue: Mapped[int] = mapped_column(Integer, default=200)
    verification: Mapped[dict] = mapped_column(JSONB, default=dict)
    vehicles: Mapped[list] = mapped_column(JSONB, default=list)
    languages: Mapped[list] = mapped_column(JSONB, default=list)
    #: base of operations — the anchor for ST_Distance proximity ranking
    location: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True)

    packages: Mapped[list["Package"]] = relationship(back_populates="operator")


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    valley: Mapped[str] = mapped_column(String(80), index=True)
    distance_km: Mapped[int] = mapped_column(Integer, default=0)
    drive_hours: Mapped[float] = mapped_column(Float, default=0.0)
    elevation_m: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), index=True)
    status_note: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(400), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    traveler_reports: Mapped[int] = mapped_column(Integer, default=0)
    permits: Mapped[list] = mapped_column(JSONB, default=list)
    hazards: Mapped[list] = mapped_column(JSONB, default=list)
    #: "seed" until a live source overwrites it, then the adapter name
    origin: Mapped[str] = mapped_column(String(32), default="seed")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    #: the drivable corridor, for spatial queries against hazards
    path: Mapped[object] = mapped_column(
        Geography(geometry_type="LINESTRING", srid=4326), nullable=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    severity: Mapped[str] = mapped_column(String(16), index=True)
    kind: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    routes: Mapped[list] = mapped_column(JSONB, default=list)
    source: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(400), default="")
    origin: Mapped[str] = mapped_column(String(32), default="seed", index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    location: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True)


class Weather(Base):
    __tablename__ = "weather"

    city: Mapped[str] = mapped_column(String(80), primary_key=True)
    temp_c: Mapped[int] = mapped_column(Integer, default=0)
    feels_c: Mapped[int] = mapped_column(Integer, default=0)
    condition: Mapped[str] = mapped_column(String(120), default="")
    icon: Mapped[str] = mapped_column(String(32), default="sun")
    wind_kmh: Mapped[int] = mapped_column(Integer, default=0)
    humidity: Mapped[int] = mapped_column(Integer, default=0)
    visibility_km: Mapped[int] = mapped_column(Integer, default=10)
    forecast: Mapped[list] = mapped_column(JSONB, default=list)
    origin: Mapped[str] = mapped_column(String(32), default="seed")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    location: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True)


class Package(Base):
    __tablename__ = "packages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operator_id: Mapped[str] = mapped_column(ForeignKey("operators.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    days: Mapped[int] = mapped_column(Integer, index=True)
    price_pkr: Mapped[int] = mapped_column(Integer, index=True)
    pickup: Mapped[str] = mapped_column(String(80), index=True)
    destination: Mapped[str] = mapped_column(String(80), index=True)
    group_size: Mapped[str] = mapped_column(String(32), default="")
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    reviews: Mapped[int] = mapped_column(Integer, default=0)
    difficulty: Mapped[str] = mapped_column(String(32), default="")
    hero: Mapped[str] = mapped_column(String(32), default="")
    tags: Mapped[list] = mapped_column(JSONB, default=list)
    includes: Mapped[list] = mapped_column(JSONB, default=list)
    excludes: Mapped[list] = mapped_column(JSONB, default=list)
    routes: Mapped[list] = mapped_column(JSONB, default=list)
    itinerary: Mapped[list] = mapped_column(JSONB, default=list)
    highlight: Mapped[str] = mapped_column(String(200), default="")
    photo_query: Mapped[str] = mapped_column(String(120), default="")
    images: Mapped[list] = mapped_column(JSONB, default=list)
    operator_url: Mapped[str] = mapped_column(String(500), default="")
    whatsapp: Mapped[str] = mapped_column(String(20), default="")
    #: "seed" rows mirror data.py; "admin" rows were added or edited in the
    #: app and are loaded over the seeded list on startup.
    source: Mapped[str] = mapped_column(String(16), default="seed", index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 default=utcnow, onupdate=utcnow)

    operator: Mapped[Operator] = relationship(back_populates="packages")


class PackageImage(Base):
    """A photo uploaded through the admin screen, served at /api/images/{id}.

    Stored in the database rather than on disk because container hosts give
    the app an ephemeral filesystem: a file written there is gone after the
    next deploy, while the row survives.
    """
    __tablename__ = "package_images"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(48))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ----------------------------------------------------------- accounts/push
class User(Base):
    """A traveler or operator identified by Firebase phone auth."""
    __tablename__ = "users"

    uid: Mapped[str] = mapped_column(String(128), primary_key=True)   # Firebase uid
    phone: Mapped[str] = mapped_column(String(32), index=True, default="")
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default="traveler")  # traveler|operator
    operator_id: Mapped[str | None] = mapped_column(
        ForeignKey("operators.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DeviceToken(Base):
    """An FCM registration token. One user may have several devices."""
    __tablename__ = "device_tokens"
    __table_args__ = (UniqueConstraint("token", name="uq_device_token"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(128), index=True)
    token: Mapped[str] = mapped_column(String(512))
    platform: Mapped[str] = mapped_column(String(16), default="web")
    #: routes this device wants condition-change pushes for
    watch_routes: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ------------------------------------------------------------ on-demand trips
class TripRequest(Base):
    """A real on-demand ride, from request through to completion.

    The dispatcher keeps in-flight requests in memory for speed; this table
    is the durable record, so a ride survives a restart and shows up in the
    traveler's history as an actual trip rather than a transient animation.
    """
    __tablename__ = "trip_requests"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    traveler_id: Mapped[str] = mapped_column(String(64), index=True)
    traveler_name: Mapped[str] = mapped_column(String(120), default="")
    uid: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    service: Mapped[str] = mapped_column(String(32))
    pickup: Mapped[str] = mapped_column(String(80))
    dropoff: Mapped[str] = mapped_column(String(80))
    passengers: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str] = mapped_column(Text, default="")

    #: real road distance/duration behind the fare
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    route_method: Mapped[str] = mapped_column(String(16), default="")
    estimate_pkr: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String(24), default="searching", index=True)
    stage: Mapped[str] = mapped_column(String(32), default="")
    accepted_operator_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agreed_pkr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    offer_count: Mapped[int] = mapped_column(Integer, default=0)

    pickup_point: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True)
    dropoff_point: Mapped[object] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 default=utcnow, onupdate=utcnow)


# -------------------------------------------------------- bookings/payments
class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    package_id: Mapped[str] = mapped_column(ForeignKey("packages.id"), index=True)
    uid: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    traveler_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    start_date: Mapped[str] = mapped_column(String(32), default="")
    travelers: Mapped[int] = mapped_column(Integer, default=1)
    total_pkr: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="pending_payment", index=True)
    condition_warnings: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    payments: Mapped[list["Payment"]] = relationship(back_populates="booking")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)     # our txn ref
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), index=True)
    provider: Mapped[str] = mapped_column(String(24), index=True)      # jazzcash|easypaisa|mock
    amount_pkr: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="initiated", index=True)
    provider_ref: Mapped[str] = mapped_column(String(120), default="")
    response_code: Mapped[str] = mapped_column(String(24), default="")
    response_message: Mapped[str] = mapped_column(Text, default="")
    raw_response: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    settled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    booking: Mapped[Booking] = relationship(back_populates="payments")
