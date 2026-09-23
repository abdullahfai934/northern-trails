"""Shared fixtures.

Tests run entirely offline: no database, no Firebase, no network. Anything
that would reach out is either stubbed or covered by a test that is
explicitly marked `network`.
"""
import os
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# Neutralise the developer's .env before any app module is imported.
#
# app.config reads .env at import time, so a local DATABASE_URL or Firebase
# project silently leaked into the suite: tests passed or failed depending
# on whether a Postgres container happened to be running. Clearing these
# here makes every run hermetic and identical to CI, which has no .env.
for _leaky in ("DATABASE_URL", "FIREBASE_PROJECT_ID", "FIREBASE_AUTH_EMULATOR_HOST",
               "FCM_SERVICE_ACCOUNT_JSON", "GEMINI_API_KEY", "OPENWEATHER_API_KEY",
               "JAZZCASH_MERCHANT_ID", "EASYPAISA_STORE_ID", "UNSPLASH_ACCESS_KEY",
               "GOOGLE_PLACES_API_KEY"):
    os.environ[_leaky] = ""
os.environ.setdefault("POLL_ENABLED", "0")      # no network from tests
os.environ.setdefault("LOOKUPS_ENABLED", "0")   # photos/restaurants stubbed per test
os.environ["ADMIN_TOKEN"] = "test-admin-token"
# Lookup caches persist to disk; a developer's cached photos must not leak in.
import tempfile  # noqa: E402
os.environ["NT_CACHE_DIR"] = tempfile.mkdtemp(prefix="nt-cache-")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "network: needs internet; deselect with -m 'not network'")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
