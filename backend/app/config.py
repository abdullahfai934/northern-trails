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
load_dotenv(ROOT / ".env")


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
        "database": "postgis" if DATABASE_URL else "in-memory",
        "weather": ("open-meteo+openweathermap" if (POLL_ENABLED and OPENWEATHER_KEY)
                    else "open-meteo" if POLL_ENABLED else "seeded"),
        "hazards": "gdacs+usgs" if POLL_ENABLED else "seeded",
        "roads": "nha+pmd" if POLL_ENABLED else "seeded",
        "routing": "osrm" if POLL_ENABLED else "estimate",
        "auth": ("firebase-emulator" if (FIREBASE_PROJECT_ID and FIREBASE_AUTH_EMULATOR_HOST)
                 else "firebase" if FIREBASE_PROJECT_ID else "disabled"),
        "push": "fcm" if FCM_SERVICE_ACCOUNT else "disabled",
        "payments": {
            "provider": PAYMENTS_PROVIDER,
            "mode": "live" if payments_configured(PAYMENTS_PROVIDER) and PAYMENTS_PROVIDER != "mock" else "sandbox/mock",
            "available": [p for p in ("jazzcash", "easypaisa", "mock") if payments_configured(p)],
        },
    }
