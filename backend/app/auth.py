"""Firebase phone-OTP authentication.

The OTP round trip happens entirely in the browser: Firebase sends the SMS
and hands the client an ID token. The backend's job is to verify that token
before trusting the uid or phone number in it.

Verification is done against Google's published x509 certificates rather
than with the Admin SDK, so the server needs no service-account key — only
the public project id. Certificates are cached until their `max-age`.

With no FIREBASE_PROJECT_ID the app runs unauthenticated: `current_user`
returns an anonymous identity and nothing is gated. Set AUTH_REQUIRED=1 to
make a valid token mandatory on protected routes.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx
import jwt
from fastapi import Depends, Header, HTTPException

from .config import (AUTH_REQUIRED, FIREBASE_AUTH_EMULATOR_HOST,
                     FIREBASE_PROJECT_ID)

log = logging.getLogger("northern_trails.auth")

CERT_URL = ("https://www.googleapis.com/robot/v1/metadata/x509/"
            "securetoken@system.gserviceaccount.com")

_certs: dict[str, str] = {}
_certs_expire_at: float = 0.0


def enabled() -> bool:
    return bool(FIREBASE_PROJECT_ID)


async def _public_certs() -> dict[str, str]:
    """Google's signing certificates, cached until the response says stale."""
    global _certs, _certs_expire_at
    if _certs and time.time() < _certs_expire_at:
        return _certs
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(CERT_URL)
        resp.raise_for_status()
        _certs = resp.json()
    max_age = 3600
    cache_control = resp.headers.get("cache-control", "")
    for part in cache_control.split(","):
        part = part.strip()
        if part.startswith("max-age="):
            try:
                max_age = int(part.split("=", 1)[1])
            except ValueError:
                pass
    _certs_expire_at = time.time() + max_age
    log.info("refreshed %d Firebase signing certs (max-age %ds)", len(_certs), max_age)
    return _certs


async def verify_id_token(token: str) -> dict:
    """Decode and fully verify a Firebase ID token. Raises on any problem."""
    if not FIREBASE_PROJECT_ID:
        raise ValueError("Firebase is not configured")

    if FIREBASE_AUTH_EMULATOR_HOST:
        # The Auth emulator issues deliberately unsigned tokens, so there is
        # no signature to check. Audience, issuer and expiry are still
        # enforced, which is what the rest of the app relies on. This branch
        # is unreachable unless FIREBASE_AUTH_EMULATOR_HOST is set.
        claims = jwt.decode(
            token, options={"verify_signature": False, "require": ["exp", "aud", "iss", "sub"]},
            audience=FIREBASE_PROJECT_ID,
            issuer=f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}",
            algorithms=["none", "RS256"],
        )
        if not claims.get("sub"):
            raise ValueError("token has no subject")
        return claims

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise ValueError("token has no key id")

    certs = await _public_certs()
    cert_pem = certs.get(kid)
    if not cert_pem:
        # Key rotated since we cached: force one refresh before giving up.
        globals()["_certs_expire_at"] = 0.0
        certs = await _public_certs()
        cert_pem = certs.get(kid)
    if not cert_pem:
        raise ValueError("token signed with an unknown key")

    from cryptography.x509 import load_pem_x509_certificate
    public_key = load_pem_x509_certificate(cert_pem.encode()).public_key()

    claims = jwt.decode(
        token, public_key, algorithms=["RS256"],
        audience=FIREBASE_PROJECT_ID,
        issuer=f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}",
        options={"require": ["exp", "iat", "aud", "iss", "sub"]},
    )
    if not claims.get("sub"):
        raise ValueError("token has no subject")
    return claims


class Identity:
    """Who is calling. `anonymous` when auth is off or no token was sent."""

    def __init__(self, uid: str = "", phone: str = "", anonymous: bool = True,
                 claims: Optional[dict] = None):
        self.uid = uid or "anon"
        self.phone = phone
        self.anonymous = anonymous
        self.claims = claims or {}

    def __repr__(self) -> str:
        return f"<Identity {self.uid}{' anon' if self.anonymous else ''}>"


async def current_user(authorization: str = Header(default="")) -> Identity:
    """FastAPI dependency: resolve the caller, without forcing a login."""
    token = ""
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if not token or not enabled():
        if AUTH_REQUIRED and enabled():
            raise HTTPException(401, "Authentication required")
        return Identity()

    try:
        claims = await verify_id_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired — sign in again")
    except Exception as exc:
        log.warning("token rejected: %s: %s", type(exc).__name__, exc)
        raise HTTPException(401, "Invalid authentication token")

    identity = Identity(
        uid=claims.get("user_id") or claims["sub"],
        phone=claims.get("phone_number", ""),
        anonymous=False,
        claims=claims,
    )
    # Keep a local row so bookings and device tokens can reference the user.
    try:
        from .db import repo
        await repo.upsert_user(identity.uid, identity.phone)
    except Exception:
        log.exception("could not persist user row")
    return identity


async def require_user(user: Identity = Depends(current_user)) -> Identity:
    """Stricter dependency for routes that genuinely need a real account."""
    if user.anonymous:
        raise HTTPException(401, "Sign in with your phone number to continue")
    return user
