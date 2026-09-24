"""Firebase Cloud Messaging (HTTP v1).

Carries the two notifications the product actually promises: a mid-trip
condition change on a route the traveler is watching, and job events for
operators.

Auth uses a service account through google-auth, which handles the OAuth2
exchange and token refresh. With no FCM_SERVICE_ACCOUNT_JSON the module is
inert: `send()` reports `disabled` and callers carry on. Nothing in the
request path depends on a push succeeding.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from . import gcp

log = logging.getLogger("northern_trails.push")


def enabled() -> bool:
    return gcp.enabled()


def _access_token() -> tuple[str, str]:
    return gcp.access_token(), gcp.project_id()


async def send(tokens: list[str], title: str, body: str,
               payload: dict | None = None) -> dict:
    """Fan a notification out to device tokens. Never raises."""
    tokens = [t for t in dict.fromkeys(tokens) if t]
    if not tokens:
        return {"sent": 0, "status": "no-recipients"}
    if not enabled():
        log.info("push suppressed (FCM not configured): %s", title)
        return {"sent": 0, "status": "disabled", "would_notify": len(tokens)}

    try:
        token, project = await asyncio.to_thread(_access_token)
    except Exception:
        log.exception("could not mint an FCM access token")
        return {"sent": 0, "status": "auth-failed"}
    if not token or not project:
        return {"sent": 0, "status": "auth-failed"}

    url = f"https://fcm.googleapis.com/v1/projects/{project}/messages:send"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = {k: str(v) for k, v in (payload or {}).items()}

    sent, failed = 0, []
    async with httpx.AsyncClient(timeout=15) as client:
        async def one(device: str):
            nonlocal sent
            message = {"message": {"token": device,
                                   "notification": {"title": title, "body": body},
                                   "data": data,
                                   "webpush": {"fcm_options": {"link": "/conditions"}}}}
            try:
                resp = await client.post(url, headers=headers, json=message)
                if resp.status_code == 200:
                    sent += 1
                else:
                    failed.append({"token": device[:12] + "…",
                                   "code": resp.status_code,
                                   "error": resp.text[:180]})
            except Exception as exc:
                failed.append({"token": device[:12] + "…", "error": str(exc)[:180]})

        await asyncio.gather(*(one(t) for t in tokens))

    if failed:
        log.warning("FCM: %d sent, %d failed (%s)", sent, len(failed), failed[:2])
    return {"sent": sent, "failed": len(failed), "status": "ok", "errors": failed[:5]}


# ------------------------------------------------------------- app events
SEVERITY_PREFIX = {"closed": "🚧", "restricted": "⚠️", "caution": "⚠️", "open": "✅"}


async def notify_condition_change(route: dict, previous: str, current: str) -> dict:
    """Tell everyone watching a route that its status moved."""
    from .db import repo
    tokens = await repo.tokens_for_routes([route["id"]])
    icon = SEVERITY_PREFIX.get(current, "ℹ️")
    title = f"{icon} {route['name']}: {previous} → {current}"
    body = route.get("status_note", "")[:240] or "Conditions on this route have changed."
    result = await send(tokens, title, body, {
        "type": "condition.change", "route_id": route["id"],
        "previous": previous, "current": current,
    })
    log.info("condition change %s %s->%s: %s", route["id"], previous, current, result)
    return result


async def notify_job_offer(operator_id: str, request: dict) -> dict:
    from .db import repo
    tokens = await repo.tokens_for_routes([])       # blanket watchers
    return await send(
        tokens,
        "New job request nearby",
        f"{request.get('service', 'Trip')}: {request.get('pickup')} → {request.get('dropoff')}",
        {"type": "job.offered", "request_id": request.get("id", ""),
         "operator_id": operator_id},
    )
