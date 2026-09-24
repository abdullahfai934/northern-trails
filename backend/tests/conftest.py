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
               "GOOGLE_PLACES_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "SMTP_HOST", "ADMIN_EMAILS"):
    os.environ[_leaky] = ""
os.environ.setdefault("POLL_ENABLED", "0")      # no network from tests
os.environ.setdefault("LOOKUPS_ENABLED", "0")   # photos/restaurants stubbed per test
os.environ["ADMIN_TOKEN"] = "test-admin-token"
os.environ["ALERTS_ENABLED"] = "0"            # the scheduler is exercised directly
# Lookup caches persist to disk; a developer's cached photos must not leak in.
import tempfile  # noqa: E402
os.environ["NT_CACHE_DIR"] = tempfile.mkdtemp(prefix="nt-cache-")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "network: needs internet; deselect with -m 'not network'")


def identity(role="admin", uid=None, operator_id="", email="test@example.com"):
    """A signed-in caller, without Firebase: tests swap it in for the auth
    dependency. `role="guest"` means signed out."""
    from app import auth
    if role == "guest":
        return auth.Identity()
    return auth.Identity(uid=uid or f"test-{role}", anonymous=False, email=email,
                         claims={"email_verified": True},
                         profile={"role": role, "operator_id": operator_id, "name": f"Test {role}"})


@pytest.fixture
def client():
    """A test client whose caller is a signed-in admin, so older tests that
    predate accounts exercise every route. Use `as_user` to change who."""
    from fastapi.testclient import TestClient
    from app import auth
    from app.devapi import reset_limits
    from app.main import app
    reset_limits()
    app.dependency_overrides[auth.current_user] = lambda: identity("admin")
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def as_user():
    """as_user("tourist", uid="u1") — switch the caller for the rest of a test."""
    from app import auth
    from app.main import app

    def switch(role="tourist", **kw):
        who = identity(role, **kw)
        app.dependency_overrides[auth.current_user] = lambda: who
        return who
    return switch
