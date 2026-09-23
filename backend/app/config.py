"""Central configuration and feature flags.

Every integration in this app is fallback-first: it runs without credentials
using the seeded data layer, and switches to the live path the moment the
matching environment variables appear. `feature_report()` is what
`GET /api/health` surfaces, so the running app always tells you which mode
each subsystem is in.
"""
from __future__ import annotations

import os
import pathlib

from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parents[2]
# `override=False` so a variable already set in the environment wins over
# .env — that is what lets the test suite neutralise local settings, and
# what lets a deployment override the file it ships with.
load_dotenv(ROOT / ".env", override=False)


def _flag(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_flag(name) or default)
    except ValueError:
        return default


# ----------------------------------------------------------------- database
DATABASE_URL = _flag("DATABASE_URL")
DB_ECHO = _flag("DB_ECHO").lower() in ("1", "true", "yes")

# ------------------------------------------------------------- AI assistant
#: Read here rather than in assistant.py: this module is what calls
#: load_dotenv(), and main.py imports `assistant` before anything that pulls
#: config in. Reading os.environ directly from assistant.py therefore ran
#: before .env was loaded and the key always came back empty.
GEMINI_KEY = _flag("GEMINI_API_KEY")
GEMINI_MODEL = _flag("GEMINI_MODEL", "gemini-3.6-flash")
#: Gemini 3.x models spend tokens on internal reasoning before emitting any
#: text. Left unbounded they can exhaust the output budget and return a
#: candidate with no parts at all, which reads as "the model failed".
GEMINI_THINKING = _flag("GEMINI_THINKING_LEVEL", "low")
GEMINI_MAX_TOKENS = _int("GEMINI_MAX_OUTPUT_TOKENS", 2048)

# ------------------------------------------------------------------ sources
OPENWEATHER_KEY = _flag("OPENWEATHER_API_KEY")
POLL_ENABLED = _flag("POLL_ENABLED", "1").lower() in ("1", "true", "yes")
POLL_WEATHER_MIN = _int("POLL_WEATHER_MINUTES", 20)
POLL_HAZARD_MIN = _int("POLL_HAZARD_MINUTES", 30)
POLL_ROAD_MIN = _int("POLL_ROAD_MINUTES", 15)
NHA_URL = _flag("NHA_URL", "https://nha.gov.pk/en/road-conditions/")
SOURCE_USER_AGENT = _flag(
    "SOURCE_USER_AGENT",
    "NorthernTrails/1.0 (+https://github.com/northern-trails; conditions poller)",
)

# ------------------------------------------------------- photos and places
#: unsplash.com/developers — optional. Without it photos come from Wikimedia
#: Commons, which needs no key.
UNSPLASH_KEY = _flag("UNSPLASH_ACCESS_KEY")
#: Google Places API (New) — optional. Without it restaurants come from
#: OpenStreetMap through the Overpass API, which needs no key.
GOOGLE_PLACES_KEY = _flag("GOOGLE_PLACES_API_KEY")
#: Comma-separated Overpass endpoints, tried in order. The public servers
#: rate-limit bursts, so a second mirror keeps lookups working.
OVERPASS_URLS = [u.strip() for u in _flag(
    "OVERPASS_URLS",
    "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter",
).split(",") if u.strip()]
#: Set to 0 to stop the photo and restaurant services calling out at all
#: (the test suite does this). They then return empty results.
LOOKUPS_ENABLED = _flag("LOOKUPS_ENABLED", "1").lower() in ("1", "true", "yes")

# -------------------------------------------------------------------- admin
#: Shared secret for the package admin screen. Unset = admin is switched off
#: and every /api/admin route answers 503, so a fresh deploy is never open.
ADMIN_TOKEN = _flag("ADMIN_TOKEN")

# --------------------------------------------------------------------- auth
FIREBASE_PROJECT_ID = _flag("FIREBASE_PROJECT_ID")
AUTH_REQUIRED = _flag("AUTH_REQUIRED").lower() in ("1", "true", "yes")
#: Standard Firebase variable. When set, the Auth emulator is in use and its
#: ID tokens are unsigned, so signature verification is skipped — claims are
#: still checked. Never set this in production.
FIREBASE_AUTH_EMULATOR_HOST = _flag("FIREBASE_AUTH_EMULATOR_HOST")

# --------------------------------------------------------------------- push
FCM_SERVICE_ACCOUNT = _flag("FCM_SERVICE_ACCOUNT_JSON")   # path OR raw JSON

# ----------------------------------------------------------------- payments
PAYMENTS_PROVIDER = _flag("PAYMENTS_PROVIDER", "mock").lower()
PAYMENTS_RETURN_URL = _flag("PAYMENTS_RETURN_URL", "http://localhost:5173/pay/return")

JAZZCASH_MERCHANT_ID = _flag("JAZZCASH_MERCHANT_ID")
JAZZCASH_PASSWORD = _flag("JAZZCASH_PASSWORD")
JAZZCASH_INTEGRITY_SALT = _flag("JAZZCASH_INTEGRITY_SALT")
JAZZCASH_POST_URL = _flag(
    "JAZZCASH_POST_URL",
    "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform",
)

EASYPAISA_STORE_ID = _flag("EASYPAISA_STORE_ID")
EASYPAISA_HASH_KEY = _flag("EASYPAISA_HASH_KEY")
EASYPAISA_POST_URL = _flag(
    "EASYPAISA_POST_URL",
    "https://easypaystg.easypaisa.com.pk/easypay/Index.jsf",
)


def payments_configured(provider: str) -> bool:
    if provider == "jazzcash":
        return bool(JAZZCASH_MERCHANT_ID and JAZZCASH_PASSWORD and JAZZCASH_INTEGRITY_SALT)
    if provider == "easypaisa":
        return bool(EASYPAISA_STORE_ID and EASYPAISA_HASH_KEY)
    return provider == "mock"


def feature_report() -> dict:
    """Live/fallback status for every integration, surfaced on /api/health."""
    return {
        "assistant": "gemini:" + GEMINI_MODEL if GEMINI_KEY else "grounded-offline",
        "database": "postgis" if DATABASE_URL else "in-memory",
        "weather": ("open-meteo+openweathermap" if (POLL_ENABLED and OPENWEATHER_KEY)
                    else "open-meteo" if POLL_ENABLED else "seeded"),
        "hazards": "gdacs+usgs" if POLL_ENABLED else "seeded",
        "roads": "nha+pmd" if POLL_ENABLED else "seeded",
        "routing": "osrm" if POLL_ENABLED else "estimate",
        "auth": ("firebase-emulator" if (FIREBASE_PROJECT_ID and FIREBASE_AUTH_EMULATOR_HOST)
                 else "firebase" if FIREBASE_PROJECT_ID else "disabled"),
        "push": "fcm" if FCM_SERVICE_ACCOUNT else "disabled",
        "photos": "unsplash+wikimedia" if UNSPLASH_KEY else "wikimedia",
        "restaurants": "google-places" if GOOGLE_PLACES_KEY else "openstreetmap",
        "admin": "enabled" if ADMIN_TOKEN else "disabled",
        "payments": {
            "provider": PAYMENTS_PROVIDER,
            "mode": "live" if payments_configured(PAYMENTS_PROVIDER) and PAYMENTS_PROVIDER != "mock" else "sandbox/mock",
            "available": [p for p in ("jazzcash", "easypaisa", "mock") if payments_configured(p)],
        },
    }
