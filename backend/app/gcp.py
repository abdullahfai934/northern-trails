"""Google service-account credentials, shared by push (FCM) and Firestore.

GOOGLE_SERVICE_ACCOUNT_JSON (or the older FCM_SERVICE_ACCOUNT_JSON) may be a
file path or the raw JSON itself — hosts that only take string secrets get
the JSON pasted in. Without one, both FCM and Firestore report disabled and
their callers fall back (no push; profiles held in memory).
"""
from __future__ import annotations

import json
import logging
import pathlib
import threading

from . import config

log = logging.getLogger("northern_trails.gcp")

SCOPES = [
    "https://www.googleapis.com/auth/firebase.messaging",
    "https://www.googleapis.com/auth/datastore",
]

_lock = threading.Lock()
_creds = None
_info: dict | None = None


def service_account_info() -> dict | None:
    global _info
    if _info is not None:
        return _info or None
    raw = (config.GOOGLE_SERVICE_ACCOUNT or "").strip()
    info: dict = {}
    if raw.startswith("{"):
        info = json.loads(raw)
    elif raw:
        path = pathlib.Path(raw)
        if not path.is_absolute():
            path = config.ROOT / path
        if path.is_file():
            info = json.loads(path.read_text())
        else:
            log.error("service account file not found: %s", path)
    _info = info
    return info or None


def enabled() -> bool:
    return service_account_info() is not None


def project_id() -> str:
    info = service_account_info() or {}
    return info.get("project_id") or config.FIREBASE_PROJECT_ID


def access_token() -> str:
    """A fresh OAuth access token for the service account ('' when none)."""
    global _creds
    info = service_account_info()
    if not info:
        return ""
    with _lock:
        if _creds is None:
            from google.oauth2 import service_account
            _creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        if not _creds.valid:
            from google.auth.transport.requests import Request
            _creds.refresh(Request())
        return _creds.token
