"""Destination Safety Score and "best places to visit this week".

The Safety Score is out of 100, higher is safer, and is the sum of four
parts with fixed maximums so the number can be explained line by line:

    road status   35   worst segment on the way in (a destination is only as
                       reachable as its worst road)
    weather       30   now and the next three days: rain, snow, storms,
                       wind, cold, poor visibility
    earthquakes   20   USGS events within 100 km in the last 7 days
    altitude      15   the destination's elevation (acute mountain sickness
                       risk rises above 2,500 m)

Bands: 75+ good (green), 50-74 use caution (yellow), below 50 high risk
(red). Every part returns the readings it used, so the UI can show why.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from . import data

MAX = {"road": 35, "weather": 30, "earthquakes": 20, "altitude": 15}
ROAD_POINTS = {"open": 35, "caution": 24, "seasonal": 20, "restricted": 12, "closed": 0}
QUAKE_RADIUS_KM = 100
QUAKE_WINDOW = timedelta(days=7)


def _km(lat1, lon1, lat2, lon2) -> float:
    r, rad = 6371.0, math.radians
    dp, dl = rad(lat2 - lat1), rad(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _magnitude(alert: dict) -> float | None:
    if alert.get("magnitude") is not None:
        return float(alert["magnitude"])
    m = re.search(r"\bM\s?(\d+(?:\.\d+)?)", alert.get("title", ""))
    return float(m.group(1)) if m else None


def _age(iso_ts: str) -> timedelta:
    try:
        ts = datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - ts
    except Exception:
        return timedelta(days=365)


def band(score: float) -> Dict[str, str]:
    if score >= 75:
        return {"level": "good", "label": "Good to go", "color": "green"}
    if score >= 50:
        return {"level": "caution", "label": "Use caution", "color": "yellow"}
    return {"level": "risky", "label": "High risk", "color": "red"}


def road_part(dest: dict) -> Dict[str, Any]:
    ridx = data.route_index()
    routes = [ridx[r] for r in dest["routes"] if r in ridx]
    if not routes:
        return {"points": MAX["road"] * 0.6, "note": "No tracked road for this destination.", "routes": []}
    worst = min(routes, key=lambda r: ROAD_POINTS.get(r["status"], 20))
    pts = ROAD_POINTS.get(worst["status"], 20)
    note = ("All roads in are open." if worst["status"] == "open"
            else f"{worst['name']} is {worst['status']}: {worst.get('status_note', '')}".strip())
    return {"points": pts, "note": note, "routes": [
        {"id": r["id"], "name": r["name"], "status": r["status"], "updated_at": r.get("updated_at", "")}
        for r in routes]}


def weather_part(dest: dict) -> Dict[str, Any]:
    w = next((x for x in data.WEATHER if x["city"] == dest.get("weather_city")), None)
    if not w:
        return {"points": MAX["weather"] * 0.6, "note": "No weather reading for this destination.", "reading": None}
    pts, reasons = float(MAX["weather"]), []
    days = [(f[0], f[1], f[2], f[3]) for f in w.get("forecast", [])[:3]]
    icons = [w.get("icon", "")] + [d[3] for d in days]
    storms, snow, rain = icons.count("storm"), icons.count("snow"), icons.count("rain")
    if storms:
        pts -= 12; reasons.append("thunderstorms forecast")
    if snow:
        pts -= 4 + 3 * min(snow, 3); reasons.append(f"snow on {snow} of the next 4 days")
    if rain:
        pts -= 2 + 2 * min(rain, 3); reasons.append(f"rain on {rain} of the next 4 days")
    if w.get("wind_kmh", 0) >= 40:
        pts -= 6; reasons.append(f"strong wind ({w['wind_kmh']} km/h)")
    lows = [d[2] for d in days if isinstance(d[2], (int, float))]
    if lows and min(lows) <= -8:
        pts -= 5; reasons.append(f"nights down to {min(lows)}°C")
    if w.get("visibility_km", 10) < 2:
        pts -= 5; reasons.append(f"visibility {w['visibility_km']} km")
    pts = max(0.0, pts)
    note = ("Settled weather: " if not reasons else "Watch for ") + (
        ", ".join(reasons) if reasons else f"{w['temp_c']}°C, {w['condition'].lower()}.")
    return {"points": round(pts, 1), "note": note, "reading": {
        "city": w["city"], "temp_c": w["temp_c"], "condition": w["condition"],
        "wind_kmh": w.get("wind_kmh"), "forecast": w.get("forecast", [])[:3],
        "updated_at": w.get("updated_at", ""), "origin": w.get("origin", "")}}


def quake_part(dest: dict) -> Dict[str, Any]:
    near = []
    for a in data.ALERTS:
        if a.get("kind", "").lower() != "earthquake" or a.get("lat") is None:
            continue
        if _age(a.get("issued_at", "")) > QUAKE_WINDOW:
            continue
        d = _km(dest["lat"], dest["lon"], a["lat"], a["lon"])
        mag = _magnitude(a)
        if d <= QUAKE_RADIUS_KM and mag is not None:
            near.append({"id": a["id"], "magnitude": mag, "distance_km": round(d), "title": a["title"],
                         "issued_at": a.get("issued_at", "")})
    if not near:
        return {"points": MAX["earthquakes"], "note": "No earthquakes within 100 km this week.", "events": []}
    top = max(near, key=lambda e: e["magnitude"])
    pts = 0 if top["magnitude"] >= 5.5 else 8 if top["magnitude"] >= 4.5 else 15
    return {"points": pts, "events": sorted(near, key=lambda e: -e["magnitude"])[:5],
            "note": f"M{top['magnitude']} earthquake {top['distance_km']} km away this week — "
                    "rockfall risk on mountain roads is higher."}


def altitude_part(dest: dict) -> Dict[str, Any]:
    m = dest.get("elevation_m", 0)
    if m < 2500:
        pts, note = 15, "Below 2,500 m: altitude sickness is unlikely."
    elif m < 3500:
        pts, note = 11, "2,500–3,500 m: take it slow on the first day."
    elif m < 4500:
        pts, note = 7, "Above 3,500 m: acclimatise and watch for headaches or nausea."
    else:
        pts, note = 4, "Above 4,500 m: serious altitude — ascend gradually."
    return {"points": pts, "note": note, "elevation_m": m}


def score(dest: dict) -> Dict[str, Any]:
    parts = {"road": road_part(dest), "weather": weather_part(dest),
             "earthquakes": quake_part(dest), "altitude": altitude_part(dest)}
    total = round(sum(p["points"] for p in parts.values()))
    # A closed road caps the score: good weather cannot average it away.
    if any(r["status"] == "closed" for r in parts["road"]["routes"]):
        total = min(total, 45)
    worst = min(parts, key=lambda k: parts[k]["points"] / MAX[k])
    return {
        "destination_id": dest["id"], "destination": dest["name"],
        "score": total, **band(total),
        "summary": parts[worst]["note"] if parts[worst]["points"] < MAX[worst] else
                   "Roads open, settled weather and no recent earthquakes nearby.",
        "parts": {k: {**v, "max": MAX[k]} for k, v in parts.items()},
        "computed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def all_scores() -> List[Dict[str, Any]]:
    return [score(d) for d in data.DESTINATIONS]


def recommendations(month: int | None = None) -> List[Dict[str, Any]]:
    """Destinations ranked for the coming week: safety first, then season,
    then how many dry days the forecast shows."""
    month = month or datetime.now(timezone.utc).month
    out = []
    for d in data.DESTINATIONS:
        s = score(d)
        w = s["parts"]["weather"]["reading"] or {}
        fc = w.get("forecast") or []
        dry = sum(1 for f in fc if f[3] in ("sun", "cloud-sun", "cloud"))
        in_season = month in d.get("best_months", [])
        rank = s["score"] + (8 if in_season else -15) + dry * 3
        reason = []
        if in_season:
            reason.append("in season")
        else:
            reason.append("out of season")
        if dry:
            reason.append(f"{dry} dry day{'s' if dry != 1 else ''} ahead")
        reason.append(s["label"].lower())
        out.append({"destination": {k: d[k] for k in ("id", "name", "blurb", "photo_query", "lat", "lon",
                                                       "elevation_m") if k in d},
                    "safety": {k: s[k] for k in ("score", "level", "label", "color", "summary")},
                    "in_season": in_season, "dry_days": dry, "forecast": fc,
                    "reason": ", ".join(reason), "rank": rank,
                    "packages": [p["id"] for p in data.PACKAGES if p["destination"] == d["name"]]})
    return sorted(out, key=lambda x: -x["rank"])
