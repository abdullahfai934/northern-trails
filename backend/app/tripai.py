"""AI trip planner: a day-by-day itinerary built only from real records.

1. The existing planner ranks every destination against the brief (budget,
   days, group, interests, month, live conditions) and the best one or two
   are chosen.
2. Their real packages, attractions, restaurants (OpenStreetMap / Google),
   weather and safety score become the context.
3. Gemini writes the itinerary as JSON under rules that forbid anything not
   in that context. Without Gemini — or if its answer does not validate —
   a deterministic builder produces the plan from the same records.
4. The answer is checked, not trusted: a package id that does not exist is
   dropped, a restaurant not in the list is dropped, and every cost is
   recomputed here from catalogue prices and the published daily ground
   costs. The model never sets a price.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any, Dict, List

import httpx

from . import data, places, planner, safety
from .config import GEMINI_KEY, GEMINI_MODEL

log = logging.getLogger("northern_trails.tripai")

SYSTEM = """You plan trips in Gilgit-Baltistan and Chitral for Northern Trails.
Return ONLY JSON matching the schema you are given.
Rules:
- Use only destinations, attractions, packages (by id) and restaurants (by
  name) that appear in the CONTEXT. Never invent a place, business or price.
- Do not write any prices or costs; the app calculates them.
- One entry per day, exactly the number of days asked for, in travel order,
  including the drive in and out.
- If a package fits, you may base consecutive days on it (set package_id on
  those days). Otherwise leave package_id null.
- Mention closures or cautions from the CONTEXT in `tips`.
"""

SCHEMA_HINT = {
    "title": "string", "summary": "string (2 sentences)",
    "days": [{"day": 1, "title": "string", "location": "one destination or town from CONTEXT",
              "activities": ["string"], "restaurant": "exact restaurant name from CONTEXT or null",
              "package_id": "package id from CONTEXT or null"}],
    "tips": ["string"],
}


def _pkr(n: int) -> str:
    return "PKR " + f"{int(n):,}"


async def _context(brief: dict) -> Dict[str, Any]:
    ranked = planner.plan(destination=brief.get("destination", ""), start_city=brief.get("start_city", ""),
                          budget_pkr=brief.get("budget_pkr", 0), days=brief["days"],
                          people=brief["people"], interests=brief.get("interests", []),
                          travel_date=brief.get("travel_date", ""))["results"]
    # A long trip can take in a second destination; a short one should not.
    chosen = [r for r in ranked if not r["travel_condition"]["blocked"]][: (2 if brief["days"] >= 7 else 1)]
    if not chosen:
        chosen = ranked[:1]
    dests = []
    for r in chosen:
        d = data.destination_by_name(r["destination"]["name"])
        try:
            rest = await places.nearby(d["name"])
            rest_items = rest.get("items", [])[:6]
        except Exception as exc:
            log.warning("restaurants for %s: %s", d["name"], exc)
            rest_items = []
        dests.append({"dest": d, "fit": r["fit"], "packages": r["packages"], "restaurants": rest_items,
                      "safety": safety.score(d)})
    return {"dests": dests}


def _context_text(ctx: Dict[str, Any], brief: dict) -> str:
    lines = [f"BRIEF: {brief['days']} days, {brief['people']} people, budget {_pkr(brief.get('budget_pkr') or 0)} total, "
             f"starting from {brief.get('start_city') or 'Islamabad'}, interests: {', '.join(brief.get('interests') or []) or 'any'}."]
    for x in ctx["dests"]:
        d, s = x["dest"], x["safety"]
        lines.append(f"DESTINATION {d['name']} | {d['elevation_m']} m | safety {s['score']}/100 ({s['label']}): {s['summary']} | "
                     f"attractions: {', '.join(d['attractions'])} | drive hours from start: "
                     f"{d.get('drive_hours_from', {}).get(brief.get('start_city') or 'Islamabad', 'unknown')}")
        for p in x["packages"]:
            days = "; ".join(f"{a}: {b}" for a, b, _ in p["itinerary"])
            lines.append(f"PACKAGE id={p['id']} | {p['title']} | {p['days']} days | {days}")
        for r in x["restaurants"]:
            lines.append(f"RESTAURANT {r['name']} | {r['cuisine']} | {r['distance_km']} km from {d['name']}")
        for part in ("road", "weather"):
            lines.append(f"CONDITION {d['name']} {part}: {s['parts'][part]['note']}")
    return "\n".join(lines)


async def _gemini(prompt: str) -> dict | None:
    if not GEMINI_KEY:
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096,
                             "responseMimeType": "application/json",
                             "thinkingConfig": {"thinkingLevel": "low"}},
    }
    try:
        async with httpx.AsyncClient(timeout=45) as c:
            for attempt in range(3):
                resp = await c.post(url, headers={"x-goog-api-key": GEMINI_KEY}, json=body)
                if resp.status_code not in (429, 503) or attempt == 2:
                    break
                await asyncio.sleep(1.5 * (attempt + 1))
        if resp.status_code >= 400:
            log.warning("gemini planner HTTP %s %s", resp.status_code, resp.text[:200])
            return None
        parts = ((resp.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        text = re.sub(r"^```(?:json)?|```$", "", text).strip()
        return json.loads(text)
    except Exception as exc:
        log.warning("gemini planner failed: %s", exc)
        return None


def _fallback(ctx: Dict[str, Any], brief: dict) -> dict:
    """A plan built without AI: a fitting package's itinerary, else the
    destination's attractions spread over the days."""
    n, days = brief["days"], []
    first = ctx["dests"][0]
    pkg = next((p for p in sorted(first["packages"], key=lambda p: abs(p["days"] - n)) if p["days"] <= n), None)
    if pkg:
        for i, (_, title, body) in enumerate(pkg["itinerary"]):
            days.append({"day": i + 1, "title": title, "location": first["dest"]["name"],
                         "activities": [body], "package_id": pkg["id"], "restaurant": None})
    attractions = [(x["dest"], a) for x in ctx["dests"] for a in x["dest"]["attractions"]]
    k = 0
    while len(days) < n:
        i = len(days)
        if i == n - 1 and n > 1:
            days.append({"day": i + 1, "title": f"Return to {brief.get('start_city') or 'Islamabad'}",
                         "location": days[-1]["location"] if days else first["dest"]["name"],
                         "activities": ["Early start for the drive back."], "package_id": None, "restaurant": None})
            break
        dest, a = attractions[k % len(attractions)] if attractions else (first["dest"], "Explore the valley")
        k += 1
        days.append({"day": i + 1, "title": a, "location": dest["name"],
                     "activities": [f"Visit {a}."], "package_id": None, "restaurant": None})
    for d in days:
        x = next((x for x in ctx["dests"] if x["dest"]["name"] == d["location"]), first)
        if x["restaurants"] and not d["restaurant"]:
            d["restaurant"] = x["restaurants"][(d["day"] - 1) % len(x["restaurants"])]["name"]
    tips = [x["safety"]["summary"] for x in ctx["dests"]]
    return {"title": f"{n} days in {' & '.join(x['dest']['name'] for x in ctx['dests'])}",
            "summary": f"Built from {'the ' + pkg['title'] + ' itinerary' if pkg else 'the destination highlights'} "
                       f"and current conditions.", "days": days, "tips": tips}


def _validate_and_cost(raw: dict, ctx: Dict[str, Any], brief: dict) -> dict:
    n, people = brief["days"], brief["people"]
    pidx = data.package_index()
    names = {x["dest"]["name"]: x for x in ctx["dests"]}
    allowed_pkgs = {p["id"] for x in ctx["dests"] for p in x["packages"]}
    first = ctx["dests"][0]
    days = []
    for i, d in enumerate((raw.get("days") or [])[:n]):
        loc = d.get("location") if d.get("location") in names else first["dest"]["name"]
        x = names[loc]
        rest_names = {r["name"]: r for r in x["restaurants"]}
        rest = rest_names.get(d.get("restaurant") or "")
        pid = d.get("package_id") if d.get("package_id") in allowed_pkgs else None
        days.append({
            "day": i + 1, "title": str(d.get("title") or f"Day {i + 1}")[:120], "location": loc,
            "activities": [str(a)[:240] for a in (d.get("activities") or [])][:5],
            "package_id": pid,
            "restaurant": ({k: rest[k] for k in ("name", "cuisine", "distance_km", "directions_url")} if rest else None),
        })
    if len(days) < n:           # the model returned too few days: do not guess
        raise ValueError("incomplete plan")

    # Costs: packages at catalogue price for the days they cover, the rest at
    # the destination's published daily ground cost. Per person × people.
    used = [pid for pid in dict.fromkeys(d["package_id"] for d in days) if pid]
    package_cost = sum(pidx[p]["price_pkr"] for p in used) * people
    covered = sum(pidx[p]["days"] for p in used)
    free_days = [d for d in days if not d["package_id"]][: max(0, n - covered)]
    ground = sum(names[d["location"]]["dest"]["daily_cost_pkr"] for d in free_days) * people
    for d in days:
        d["est_cost_pkr"] = (0 if d["package_id"] else names[d["location"]]["dest"]["daily_cost_pkr"] * people)
    total = package_cost + ground
    budget = brief.get("budget_pkr") or 0
    return {
        "title": str(raw.get("title") or "")[:120] or f"{n} days in {first['dest']['name']}",
        "summary": str(raw.get("summary") or "")[:400],
        "days": days,
        "tips": [str(t)[:240] for t in (raw.get("tips") or [])][:6],
        "packages": [{k: pidx[p][k] for k in ("id", "title", "days", "price_pkr", "operator_id")} for p in used],
        "destinations": [{"name": x["dest"]["name"], "safety": {k: x["safety"][k] for k in ("score", "label", "color")}}
                         for x in ctx["dests"]],
        "costs": {"packages_pkr": package_cost, "ground_pkr": ground, "total_pkr": total,
                  "budget_pkr": budget, "within_budget": (total <= budget) if budget else None,
                  "basis": "Package prices from the catalogue; other days at each destination's typical "
                           "per-person daily ground cost (hotel, food, local transport)."},
    }


async def build(brief: dict) -> dict:
    ctx = await _context(brief)
    raw = await _gemini(_context_text(ctx, brief) + "\n\nSchema:\n" + json.dumps(SCHEMA_HINT))
    engine = "gemini"
    try:
        if raw is None:
            raise ValueError("no model answer")
        plan = _validate_and_cost(raw, ctx, brief)
    except Exception as exc:
        log.info("planner fallback: %s", exc)
        plan = _validate_and_cost(_fallback(ctx, brief), ctx, brief)
        engine = "grounded-offline"
    return {**plan, "engine": engine, "id": "plan-" + uuid.uuid4().hex[:10]}
