"""Smart alerts for travelers with an upcoming booking.

Every ALERT_CHECK_HOURS (default 3) the checker looks at each upcoming or
in-progress booking that belongs to a signed-in user and raises an alert when:

    * a road on the package's route is closed or restricted
    * heavy rain, snow or a thunderstorm is forecast at the destination
    * an earthquake of magnitude 4.5 or more happened within 100 km

Each alert is stored as an in-app notification, sent as a browser push to the
user's registered devices (Firebase Cloud Messaging), and emailed when SMTP
is configured and the user has not turned email off. A de-duplication key per
(booking, cause) means the same closure is announced once, not every cycle.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from datetime import date, timedelta
from email.message import EmailMessage

from . import config, data, profiles, push, safety
from .db import records

log = logging.getLogger("northern_trails.alerts")

SEVERE_ICONS = {"storm": "thunderstorms", "snow": "snow"}


def _upcoming(b: dict) -> bool:
    if b["status"] not in ("pending_payment", "confirmed") or not b.get("uid"):
        return False
    try:
        start = date.fromisoformat(b.get("start_date") or "")
    except ValueError:
        return False
    pkg = data.package_index().get(b["package_id"]) or {}
    end = start + timedelta(days=pkg.get("days", 1))
    return date.today() - timedelta(days=1) <= end and start <= date.today() + timedelta(days=21)


def causes_for(b: dict) -> list[dict]:
    """What is worth telling this traveler about right now."""
    pkg = data.package_index().get(b["package_id"])
    if not pkg:
        return []
    dest = data.destination_by_name(pkg["destination"])
    ridx = data.route_index()
    out = []
    for rid in pkg["routes"]:
        r = ridx.get(rid)
        if r and r["status"] in ("closed", "restricted"):
            out.append({"key": f"road:{rid}:{r['status']}:{r.get('updated_at', '')[:10]}", "kind": "road",
                        "title": f"{r['name']} is {r['status']}",
                        "body": f"On the route of your {pkg['title']} trip ({b['start_date']}). {r.get('status_note', '')}"})
    if dest:
        w = next((x for x in data.WEATHER if x["city"] == dest.get("weather_city")), None)
        if w:
            bad = [(f[0], SEVERE_ICONS[f[3]]) for f in w.get("forecast", [])[:3] if f[3] in SEVERE_ICONS]
            heavy_rain = "heavy" in w.get("condition", "").lower() and w.get("icon") == "rain"
            if bad or heavy_rain:
                what = ", ".join(f"{k} on {d}" for d, k in bad) or w["condition"].lower()
                out.append({"key": f"weather:{dest['id']}:{what}", "kind": "weather",
                            "title": f"Severe weather forecast at {dest['name']}",
                            "body": f"Forecast: {what}. Check with {pkg['title']}'s operator before setting off."})
        for q in safety.quake_part(dest)["events"]:
            if q["magnitude"] >= 4.5:
                out.append({"key": f"quake:{q['id']}", "kind": "earthquake",
                            "title": f"M{q['magnitude']} earthquake {q['distance_km']} km from {dest['name']}",
                            "body": "Aftershocks can trigger rockfall on mountain roads. Check road status before driving."})
    return out


def _send_email(to: str, subject: str, body: str) -> bool:
    if not (config.SMTP_HOST and config.SMTP_USER and to):
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = config.SMTP_FROM, to, subject
    msg.set_content(f"{body}\n\nDetails: {config.SITE_URL}/profile\n\n— Northern Trails")
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
            s.starttls()
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as exc:
        log.warning("alert email to %s failed: %s", to, exc)
        return False


async def check_once() -> dict:
    sent = 0
    for b in await records.bookings():
        if not _upcoming(b):
            continue
        for c in causes_for(b):
            note = await records.add_notification({
                "uid": b["uid"], "key": f"{b['id']}:{c['key']}"[:200], "kind": c["kind"],
                "title": c["title"][:240], "body": c["body"], "link": "/profile", "channels": ["in-app"]})
            if not note:
                continue                 # already announced
            sent += 1
            prof = await profiles.get_or_create(b["uid"])
            if prof.get("notify_push", True):
                tokens = await records.device_tokens(b["uid"])
                if tokens:
                    await push.send(tokens, c["title"], c["body"][:240], {"type": "alert", "booking": b["id"]})
            to = prof.get("email") or b.get("email", "")
            if prof.get("notify_email", True) and to:
                await asyncio.to_thread(_send_email, to, c["title"], c["body"])
    if sent:
        log.info("smart alerts: %d new", sent)
    return {"new_alerts": sent}


async def loop() -> None:
    await asyncio.sleep(60)          # let the pollers fill in live data first
    while True:
        try:
            await check_once()
        except Exception:
            log.exception("smart alert check failed")
        await asyncio.sleep(max(0.25, config.ALERT_CHECK_HOURS) * 3600)
