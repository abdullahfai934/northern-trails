"""A small async Firestore REST client — just what user profiles need.

Firestore's REST API wants every value wrapped in a type tag
({"stringValue": ...}); `encode`/`decode` translate plain dicts to and from
that. The official SDK would pull in grpc and a large dependency tree for
three calls.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from . import gcp

BASE = "https://firestore.googleapis.com/v1"


def encode(v: Any) -> dict:
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, datetime):
        return {"timestampValue": v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [encode(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: encode(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def decode(v: dict) -> Any:
    if "nullValue" in v:
        return None
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "arrayValue" in v:
        return [decode(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def _doc_url(path: str) -> str:
    return f"{BASE}/projects/{gcp.project_id()}/databases/(default)/documents/{path}"


async def _headers() -> dict:
    token = await asyncio.to_thread(gcp.access_token)
    return {"Authorization": f"Bearer {token}"}


async def get(path: str) -> dict | None:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(_doc_url(path), headers=await _headers())
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return {k: decode(v) for k, v in r.json().get("fields", {}).items()}


async def set_fields(path: str, fields: dict) -> dict:
    """Create the document, or update just these fields of it."""
    params = [("updateMask.fieldPaths", k) for k in fields]
    body = {"fields": {k: encode(v) for k, v in fields.items()}}
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.patch(_doc_url(path), params=params, json=body, headers=await _headers())
    r.raise_for_status()
    return {k: decode(v) for k, v in r.json().get("fields", {}).items()}


async def list_docs(collection: str, page_size: int = 300) -> list[dict]:
    out, token = [], ""
    async with httpx.AsyncClient(timeout=15) as c:
        while True:
            params = {"pageSize": page_size, **({"pageToken": token} if token else {})}
            r = await c.get(_doc_url(collection), params=params, headers=await _headers())
            r.raise_for_status()
            body = r.json()
            for d in body.get("documents", []):
                out.append({"_id": d["name"].rsplit("/", 1)[-1],
                            **{k: decode(v) for k, v in d.get("fields", {}).items()}})
            token = body.get("nextPageToken", "")
            if not token:
                return out
