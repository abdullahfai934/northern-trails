"""User profiles and roles, kept in Firestore at `users/{uid}`.

Roles:
    tourist   everyone, on first sign-in
    operator  promoted by an admin, and linked to one `operator_id`
    admin     emails listed in ADMIN_EMAILS, or promoted by another admin

Only the backend writes these documents (with the service account, which
bypasses security rules); the rules in firestore.rules let a signed-in user
read their own document and nothing else. That keeps the role field
tamper-proof: a client cannot promote itself.

Without a service account the same API is served from memory, so the app and
the test suite run with no Google credentials at all.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from . import config, firestore, gcp

log = logging.getLogger("northern_trails.profiles")

ROLES = ("tourist", "operator", "admin")
#: Fields a user may change about themselves.
EDITABLE = ("name", "emergency_contact", "language", "wishlist", "notify_email", "notify_push")

_MEM: dict[str, dict] = {}
_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_SEC = 60


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _is_admin_email(email: str, verified: bool) -> bool:
    return bool(email) and verified and email.lower() in config.ADMIN_EMAILS


def _defaults(uid: str, email: str, phone: str, name: str, verified: bool = False) -> dict:
    role = "admin" if _is_admin_email(email, verified) else "tourist"
    return {
        "uid": uid, "email": email, "phone": phone, "name": name or "",
        "role": role, "operator_id": "", "emergency_contact": {"name": "", "phone": ""},
        "wishlist": [], "language": "en", "notify_email": True, "notify_push": True,
        "created_at": _now(), "updated_at": _now(),
    }


def _normalize(doc: dict) -> dict:
    doc = dict(doc)
    if doc.get("role") not in ROLES:
        doc["role"] = "tourist"
    doc.setdefault("wishlist", [])
    doc.setdefault("emergency_contact", {"name": "", "phone": ""})
    doc.setdefault("operator_id", "")
    return doc


async def _read(uid: str) -> dict | None:
    if not gcp.enabled():
        return _MEM.get(uid)
    return await firestore.get(f"users/{uid}")


async def _write(uid: str, fields: dict) -> dict:
    if not gcp.enabled():
        _MEM[uid] = {**_MEM.get(uid, {}), **fields}
        return _MEM[uid]
    return await firestore.set_fields(f"users/{uid}", fields)


async def get_or_create(uid: str, email: str = "", phone: str = "", name: str = "",
                        email_verified: bool = False) -> dict:
    """The caller's profile, creating it on first sign-in. Cached briefly."""
    hit = _CACHE.get(uid)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return hit[1]
    try:
        doc = await _read(uid)
        if doc is None:
            doc = await _write(uid, _defaults(uid, email, phone, name, email_verified))
        else:
            patch = {}
            # Keep contact details in step with the auth provider, and let an
            # address added to ADMIN_EMAILS later take effect on next sign-in.
            if email and doc.get("email") != email:
                patch["email"] = email
            if phone and doc.get("phone") != phone:
                patch["phone"] = phone
            if _is_admin_email(email, email_verified) and doc.get("role") != "admin":
                patch["role"] = "admin"
            if patch:
                patch["updated_at"] = _now()
                doc = {**doc, **(await _write(uid, patch))}
    except Exception:
        # A Firestore hiccup must not lock people out: treat them as a
        # tourist for this request, and do not cache the guess.
        log.exception("profile lookup failed for %s", uid)
        return _normalize(_defaults(uid, email, phone, name) | {"role": "tourist"})
    # Always key the profile by the uid from the verified token.
    doc["uid"] = uid
    doc = _normalize(doc)
    _CACHE[uid] = (time.time(), doc)
    return doc


async def update(uid: str, fields: dict) -> dict:
    clean = {k: v for k, v in fields.items() if k in EDITABLE}
    clean["updated_at"] = _now()
    await _write(uid, clean)
    _CACHE.pop(uid, None)
    return _normalize(await _read(uid) or {})


async def set_role(uid: str, role: str, operator_id: str = "") -> dict:
    if role not in ROLES:
        raise ValueError(f"role must be one of {', '.join(ROLES)}")
    await _write(uid, {"role": role, "operator_id": operator_id if role == "operator" else "",
                       "updated_at": _now()})
    _CACHE.pop(uid, None)
    return _normalize(await _read(uid) or {})


async def list_all() -> list[dict]:
    if not gcp.enabled():
        return [_normalize(d) for d in _MEM.values()]
    return [_normalize({**d, "uid": d.get("uid") or d["_id"]}) for d in await firestore.list_docs("users")]


def forget(uid: str) -> None:
    _CACHE.pop(uid, None)
