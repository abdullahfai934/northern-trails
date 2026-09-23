"""Trip planning, destination comparison and the Travel Condition Score.

Two things live here:

**The Travel Condition Score** — a 0-100 *concern* figure for travelling to a
destination right now. It is deliberately not a black box: four named
components, fixed published weights, and every component returns the records
it was computed from so the UI can show the reading, its source and its
timestamp underneath the number.

    weather conditions   30%
    road status          30%
    recent incidents     20%
    route accessibility  20%

Higher means more concern. The score is reported as a band
(LOW / MODERATE / HIGH / SEVERE CONCERN) because a bare number invites false
precision — the inputs are advisories and forecasts, not measurements.

**The planner** — takes what a traveler actually enters (budget, days, group
size, starting city, interests, travel month) and compares every destination
against it, returning for each one *why it does or does not fit* rather than a
single ranked "best". A destination that is out of season or behind a closed
road is still returned, with the reason attached; hiding it would leave the
traveler to rediscover the closure on the road.

Nothing here invents a fact. Weather, road status and incidents all come from
the live-conditions layer, and every returned component carries `sources`
with the record ids and update times behind it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from . import data

# ------------------------------------------------------------------ weights
#: Published weights for the Travel Condition Score. They sum to 1.0 and are
#: surfaced on /api/plan/methodology so the score can be audited rather than
#: taken on trust.
WEIGHTS = {
    "weather": 0.30,
    "road_status": 0.30,
    "incidents": 0.20,
    "accessibility": 0.20,
}

#: Concern contributed by each road status. A corridor is only as passable as
#: its worst segment, so these are combined with max(), not an average.
ROAD_STATUS_CONCERN = {
    "open": 0,
    "caution": 40,
    "seasonal": 55,
    "restricted": 70,
    "closed": 100,
}

#: Concern contributed by an incident at each severity, before age decay.
SEVERITY_CONCERN = {"high": 100, "medium": 60, "low": 30}

#: An incident stops counting after this many hours. Road incidents in the
#: north are cleared or escalated well inside three days; anything older is
#: history, not a current condition.
INCIDENT_WINDOW_H = 72

#: Alert kinds deliberately NOT counted as incidents, because another
#: component already prices them in and counting them twice inflates the
#: total. A closure notice is the reason a segment reads `closed`, and a
#: weather advisory is the forecast the weather component already scored.
#: Matched as substrings, case-insensitively, against the alert `kind`.
DOUBLE_COUNTED_KINDS = ("weather", "closure", "closed", "road status", "advisory")

BANDS = [
    (25, "LOW CONCERN"),
    (50, "MODERATE CONCERN"),
    (75, "HIGH CONCERN"),
    (101, "SEVERE CONCERN"),
]


def band_for(score: float) -> str:
    return next(label for ceiling, label in BANDS if score < ceiling)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _age_hours(iso_ts: str) -> float:
    """Hours since `iso_ts`, or a large number if it cannot be parsed."""
    try:
        ts = datetime.fromisoformat(iso_ts)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return max(0.0, (_now() - ts).total_seconds() / 3600)
    except (TypeError, ValueError):
        return 1e6


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


# --------------------------------------------------------------- components
def score_weather(dest: dict, weather: List[dict]) -> Dict[str, Any]:
    """Concern from the destination's own weather station.

    Driven by what actually delays or endangers mountain travel: precipitation
    type, how far you can see, wind, and whether the next few nights drop below
    freezing (which is what turns a wet road into an icy one).
    """
    wx = next((w for w in weather if w["city"] == dest["weather_city"]), None)
    if not wx:
        return {
            "score": 35.0, "notes": ["No weather station reading for this destination — "
                                     "scored as unknown rather than clear."],
            "sources": [], "unknown": True,
        }

    notes: List[str] = []
    score = 0.0
    cond = (wx.get("condition") or "").lower()

    if any(k in cond for k in ("thunder", "storm")):
        score += 70; notes.append(f"{wx['condition']} reported at {wx['city']}.")
    elif "snow" in cond:
        score += 60; notes.append(f"Snow reported at {wx['city']} — expect traction loss and delays.")
    elif "rain" in cond or "drizzle" in cond or "shower" in cond:
        score += 40; notes.append(f"{wx['condition']} at {wx['city']} — rain on these slopes brings rockfall.")
    elif "cloud" in cond or "overcast" in cond or "mist" in cond or "fog" in cond:
        score += 15; notes.append(f"{wx['condition']} at {wx['city']}.")
    else:
        notes.append(f"{wx['condition']} at {wx['city']}.")

    vis = wx.get("visibility_km")
    if vis is not None:
        if vis < 2:
            score += 30; notes.append(f"Visibility {vis} km — mountain driving is unsafe below 2 km.")
        elif vis < 5:
            score += 18; notes.append(f"Visibility reduced to {vis} km.")
        elif vis < 10:
            score += 8; notes.append(f"Visibility {vis} km.")

    wind = wx.get("wind_kmh") or 0
    if wind >= 50:
        score += 20; notes.append(f"Wind {wind} km/h — high-sided vehicles affected.")
    elif wind >= 30:
        score += 10; notes.append(f"Wind {wind} km/h.")

    # Overnight freezing is what makes the following morning's road icy.
    lows = [day[2] for day in (wx.get("forecast") or []) if len(day) > 2]
    if lows and min(lows) <= 0:
        score += 15
        notes.append(f"Overnight lows reach {min(lows)}°C in the forecast — ice on early starts.")

    # Altitude amplifies every one of the above.
    if dest["elevation_m"] >= 4000 and score > 0:
        score *= 1.15
        notes.append(f"Scored up for altitude — {dest['name']} sits at {dest['elevation_m']} m.")

    return {
        "score": _clamp(score),
        "notes": notes,
        "sources": [{"id": f"wx-{wx['city']}", "label": f"Weather · {wx['city']}",
                     "source": wx.get("source", "Open-Meteo / OpenWeatherMap"),
                     "updated_at": wx.get("updated_at")}],
        "reading": {"temp_c": wx.get("temp_c"), "condition": wx.get("condition"),
                    "wind_kmh": wind, "visibility_km": vis,
                    "forecast": wx.get("forecast", [])},
    }


def score_road_status(routes: List[dict]) -> Dict[str, Any]:
    """Concern from the worst road segment on the way in."""
    if not routes:
        return {"score": 35.0, "notes": ["No tracked road segment for this destination."],
                "sources": [], "unknown": True}

    notes, sources, per_route = [], [], []
    for r in routes:
        concern = ROAD_STATUS_CONCERN.get(r["status"], 35)
        per_route.append(concern)
        notes.append(f"{r['name']} — {r['status']}: {r['status_note']}")
        sources.append({"id": r["id"], "label": r["name"], "source": r.get("source"),
                        "url": r.get("source_url"), "updated_at": r.get("updated_at")})

    score = max(per_route)
    worst = routes[per_route.index(score)]
    if score >= 100:
        notes.insert(0, f"{worst['name']} is closed — this destination is not reachable on this route today.")

    # Stale advisories are less trustworthy than fresh ones, but staleness is
    # uncertainty, not safety: it can only raise a clear road part-way, never
    # lower a bad one.
    stalest = max(_age_hours(r.get("updated_at", "")) for r in routes)
    if stalest > 24 and score < 40:
        score = max(score, 30)
        notes.append(f"Road advisory is {int(stalest)} h old — treated as unconfirmed.")

    return {"score": _clamp(score), "notes": notes, "sources": sources}


def score_incidents(routes: List[dict], alerts: List[dict]) -> Dict[str, Any]:
    """Concern from incidents reported on those segments in the last 72 h."""
    ids = {r["id"] for r in routes}
    notes, sources = [], []
    score = 0.0

    skipped = []
    for a in alerts:
        if not (set(a.get("routes") or []) & ids):
            continue
        age = _age_hours(a.get("issued_at", ""))
        if age > INCIDENT_WINDOW_H:
            continue
        kind = (a.get("kind") or "").lower()
        if any(k in kind for k in DOUBLE_COUNTED_KINDS):
            # Counted by road_status or weather instead — recorded here so the
            # UI can still show it, without it scoring twice.
            skipped.append({"id": a["id"], "title": a["title"], "kind": a.get("kind"),
                            "counted_under": "weather" if "weather" in kind or "advisory" in kind
                                             else "road_status"})
            continue
        # Linear decay across the window: a two-hour-old closure is current,
        # a 70-hour-old one is nearly spent.
        base = SEVERITY_CONCERN.get(a.get("severity", "low"), 30)
        decayed = base * (1 - age / INCIDENT_WINDOW_H)
        # Concurrent incidents compound but must not run away, so each further
        # incident contributes against the headroom that is left.
        score = score + decayed * (1 - score / 100)
        notes.append(f"{a['title']} ({a.get('kind', 'incident')}, {a.get('severity', 'low')} severity, "
                     f"{int(age)} h ago)")
        sources.append({"id": a["id"], "label": a["title"], "source": a.get("source"),
                        "updated_at": a.get("issued_at")})

    if not notes:
        notes.append(f"No incidents reported on these segments in the last {INCIDENT_WINDOW_H} h.")
    for sk in skipped:
        notes.append(f"{sk['title']} — counted under {sk['counted_under'].replace('_', ' ')}, "
                     "not added again here.")

    return {"score": _clamp(score), "notes": notes, "sources": sources,
            "also_reported": skipped}


def score_accessibility(dest: dict, routes: List[dict], start_city: str | None,
                        month: int | None) -> Dict[str, Any]:
    """Concern from how hard the place is to reach, season included.

    This is the structural component: permits, terrain hazards, altitude,
    driving time and whether the destination is in season at all. Unlike the
    other three it barely moves day to day — which is the point, it is what
    makes Deosai in January different from Deosai in July.
    """
    notes: List[str] = []
    score = 0.0

    permits = [p for r in routes for p in (r.get("permits") or [])]
    if permits:
        score += 10 * min(len(permits), 2)
        notes.append("Permits required: " + "; ".join(permits))

    hazards = [h for r in routes for h in (r.get("hazards") or [])]
    if hazards:
        score += min(25, 6 * len(hazards))
        notes.append("Known hazards on route: " + "; ".join(hazards))

    if dest["elevation_m"] >= 4000:
        score += 20
        notes.append(f"{dest['name']} is at {dest['elevation_m']} m — altitude sickness is a real risk "
                     "without a night acclimatising lower.")
    elif dest["elevation_m"] >= 3000:
        score += 10
        notes.append(f"{dest['name']} is at {dest['elevation_m']} m.")

    hours = (dest.get("drive_hours_from") or {}).get(start_city)
    if hours is None:
        hours = sum(r.get("drive_hours", 0) for r in routes)
    if hours >= 18:
        score += 20; notes.append(f"About {hours:g} h of driving from {start_city or 'the KKH'} — two days on the road each way.")
    elif hours >= 10:
        score += 12; notes.append(f"About {hours:g} h of driving from {start_city or 'the KKH'}.")
    elif hours:
        notes.append(f"About {hours:g} h of driving from {start_city or 'the KKH'}.")

    if month and month not in dest["best_months"]:
        score += 30
        notes.append(f"Month {month} is outside {dest['name']}'s usual season "
                     f"({_months_label(dest['best_months'])}).")

    return {
        "score": _clamp(score),
        "notes": notes,
        "sources": [{"id": r["id"], "label": r["name"], "source": r.get("source"),
                     "updated_at": r.get("updated_at")} for r in routes],
        "drive_hours": hours,
    }


_MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _months_label(months: List[int]) -> str:
    if not months:
        return "—"
    return f"{_MONTH[min(months)]}–{_MONTH[max(months)]}"


# --------------------------------------------------------- composite score
def travel_condition(dest: dict, *, start_city: str | None = None,
                     month: int | None = None,
                     routes: List[dict] | None = None,
                     alerts: List[dict] | None = None,
                     weather: List[dict] | None = None) -> Dict[str, Any]:
    """The Travel Condition Score for one destination, with its working shown."""
    ridx = data.route_index()
    dest_routes = routes if routes is not None else [ridx[r] for r in dest["routes"] if r in ridx]
    alerts = data.ALERTS if alerts is None else alerts
    weather = data.WEATHER if weather is None else weather

    components = {
        "weather": score_weather(dest, weather),
        "road_status": score_road_status(dest_routes),
        "incidents": score_incidents(dest_routes, alerts),
        "accessibility": score_accessibility(dest, dest_routes, start_city, month),
    }

    score = sum(components[k]["score"] * WEIGHTS[k] for k in WEIGHTS)
    score = round(score, 1)

    # One blocked segment governs the headline regardless of the arithmetic: a
    # closed road cannot average out to "low concern" because the weather is
    # nice. The number stays honest; the band does not understate it.
    blocked = any(r["status"] == "closed" for r in dest_routes)
    label = band_for(score)
    if blocked and label in ("LOW CONCERN", "MODERATE CONCERN"):
        label = "HIGH CONCERN"

    return {
        "score": score,
        "band": label,
        "blocked": blocked,
        "weights": WEIGHTS,
        "components": {
            k: {
                "score": round(components[k]["score"], 1),
                "weight": WEIGHTS[k],
                "contribution": round(components[k]["score"] * WEIGHTS[k], 1),
                "notes": components[k]["notes"],
                "sources": components[k]["sources"],
                **({"reading": components[k]["reading"]} if "reading" in components[k] else {}),
                **({"unknown": True} if components[k].get("unknown") else {}),
                **({"also_reported": components[k]["also_reported"]}
                   if components[k].get("also_reported") else {}),
            }
            for k in WEIGHTS
        },
        "computed_at": _now().replace(microsecond=0).isoformat(),
    }


# ------------------------------------------------------------------ planner
def _fit(dest: dict, cond: Dict[str, Any], *, budget_pkr: int, days: int,
         people: int, interests: List[str], month: int | None,
         packages: List[dict]) -> Dict[str, Any]:
    """Why this destination does or does not match what was asked for."""
    fits: List[str] = []
    against: List[str] = []

    # --- budget, from real package prices where we have them, else day rate
    per_person = [p["price_pkr"] for p in packages]
    if per_person:
        cheapest = min(per_person)
        basis = "cheapest listed package"
    else:
        cheapest = dest["daily_cost_pkr"] * max(1, days)
        basis = "typical ground cost for the region"
    total = cheapest * max(1, people)

    if budget_pkr:
        if total <= budget_pkr:
            fits.append(f"Fits the budget: {_pkr(total)} for {people} "
                        f"({basis}) against {_pkr(budget_pkr)}.")
        else:
            over = total - budget_pkr
            against.append(f"Over budget by {_pkr(over)} — {_pkr(total)} for {people} "
                           f"({basis}) against {_pkr(budget_pkr)}.")

    # --- duration
    if days:
        durations = sorted({p["days"] for p in packages})
        if durations and any(abs(d - days) <= 1 for d in durations):
            fits.append(f"{days} days matches listed trips of {', '.join(str(d) for d in durations)} days.")
        elif durations and min(durations) > days:
            against.append(f"Shortest listed trip here is {min(durations)} days — longer than "
                           f"the {days} you have.")
        elif not durations:
            drive = (cond["components"]["accessibility"].get("drive_hours") or 0)
            if drive and days and drive * 2 > days * 10:
                against.append(f"{drive:g} h each way leaves little of a {days}-day trip "
                               "for the destination itself.")

    # --- interests
    if interests:
        matched = [i for i in interests if i in dest["interests"]]
        missed = [i for i in interests if i not in dest["interests"]]
        if matched:
            fits.append("Matches your interests: " + ", ".join(matched) + ".")
        if missed:
            against.append("Not what this destination is known for: " + ", ".join(missed) + ".")

    # --- season
    if month:
        if month in dest["best_months"]:
            fits.append(f"{_MONTH[month]} is in season here ({_months_label(dest['best_months'])}).")
        else:
            against.append(f"{_MONTH[month]} is out of season ({_months_label(dest['best_months'])} "
                           "is the usual window).")

    # --- current conditions, stated as a reason not a verdict
    if cond["blocked"]:
        against.append("A road segment on the way in is currently reported closed.")
    elif cond["band"] != "LOW CONCERN":
        against.append(f"Current travel condition is {cond['band'].lower()}.")
    else:
        fits.append("Current travel conditions on the route are low concern.")

    return {
        "fits": fits,
        "against": against,
        "estimated_total_pkr": total,
        "estimated_basis": basis,
        "within_budget": bool(budget_pkr) and total <= budget_pkr,
    }


def _pkr(n: int) -> str:
    return f"PKR {int(n):,}"


def plan(*, destination: str = "", start_city: str = "", budget_pkr: int = 0,
         days: int = 0, people: int = 1, interests: List[str] | None = None,
         travel_date: str = "") -> Dict[str, Any]:
    """Compare destinations against one traveler's stated requirements."""
    interests = interests or []
    month = _month_of(travel_date)
    ridx = data.route_index()

    candidates = data.DESTINATIONS
    if destination:
        picked = data.destination_by_name(destination)
        if picked:
            candidates = [picked]

    results = []
    for dest in candidates:
        routes = [ridx[r] for r in dest["routes"] if r in ridx]
        cond = travel_condition(dest, start_city=start_city, month=month, routes=routes)

        pkgs = [data.package_with_operator(p) for p in data.PACKAGES
                if p["destination"] == dest["name"]]
        if days:
            pkgs.sort(key=lambda p: (abs(p["days"] - days), p["price_pkr"]))
        else:
            pkgs.sort(key=lambda p: p["price_pkr"])

        fit = _fit(dest, cond, budget_pkr=budget_pkr, days=days, people=people,
                   interests=interests, month=month, packages=pkgs)

        results.append({
            "destination": {k: dest[k] for k in
                            ("id", "name", "valley", "elevation_m", "attractions",
                             "blurb", "interests", "best_months")},
            "travel_condition": cond,
            "fit": fit,
            "packages": pkgs[:3],
            "routes": routes,
        })

    # Rank by how well it matches first, then by how settled the conditions
    # are. A destination that fits perfectly but sits behind a closed road
    # should not lead, so `blocked` sorts last outright.
    results.sort(key=lambda r: (
        r["travel_condition"]["blocked"],
        -len(r["fit"]["fits"]),
        len(r["fit"]["against"]),
        r["travel_condition"]["score"],
    ))

    return {
        "query": {
            "destination": destination, "start_city": start_city,
            "budget_pkr": budget_pkr, "days": days, "people": people,
            "interests": interests, "travel_date": travel_date, "month": month,
        },
        "results": results,
        "methodology": methodology(),
    }


def _month_of(travel_date: str) -> int | None:
    if not travel_date:
        return None
    try:
        return datetime.fromisoformat(travel_date.strip()).month
    except ValueError:
        return None


def methodology() -> Dict[str, Any]:
    """What the score is, in the form an examiner will ask for it."""
    return {
        "name": "Travel Condition Score",
        "range": "0-100, higher means more concern",
        "weights": WEIGHTS,
        "bands": [{"upto": c, "label": l} for c, l in BANDS],
        "components": {
            "weather": "Precipitation type, visibility, wind and forecast overnight lows at the "
                       "destination's own weather station, scaled up above 4,000 m.",
            "road_status": "Worst reported status across every tracked segment on the way in "
                           "(open 0 · caution 40 · seasonal 55 · restricted 70 · closed 100). "
                           "Combined with max(), not an average: a corridor is only as passable "
                           "as its worst segment.",
            "incidents": f"Incidents on those segments in the last {INCIDENT_WINDOW_H} h, weighted "
                         "by severity and decayed linearly by age; concurrent incidents compound "
                         "against the remaining headroom. Closure notices and weather advisories "
                         "are excluded here because road status and weather already score them — "
                         "they are still listed, marked with the component that counted them.",
            "accessibility": "Permits, known terrain hazards, altitude, driving hours from the "
                             "traveler's starting city, and whether the travel month is in season.",
        },
        "overrides": [
            "A destination with any segment reported closed is never shown below HIGH CONCERN, "
            "whatever the weighted total comes to.",
            "A road advisory older than 24 h cannot score better than 30 on road status — "
            "staleness is uncertainty, and uncertainty is not the same as a clear road.",
            "No alert is counted by more than one component. An alert whose kind is a closure "
            "notice or a weather advisory scores under road status or weather respectively, and "
            "is shown under incidents only for reference.",
        ],
        "limits": "Inputs are advisories and forecasts, not measurements. The score is reported "
                  "as a band because the underlying data does not support finer precision, and "
                  "every component carries the records and timestamps it was computed from.",
    }
