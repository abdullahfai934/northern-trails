"""Grounded AI assistant.

Pipeline: retrieve -> build a typed context pack -> answer -> attach citations.
The model is never asked to recall facts about roads, weather or permits; it is
only allowed to phrase what the context pack contains. If GEMINI_API_KEY is set
the phrasing goes through Gemini under a strict system instruction; otherwise a
deterministic composer produces the same grounded answer offline.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List

import httpx

from . import data

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

SYSTEM_INSTRUCTION = """You are the Northern Trails live-conditions assistant for Northern Pakistan
(Gilgit-Baltistan, Hunza, Skardu, Chitral).

HARD RULES:
1. Answer ONLY from the CONTEXT block. It is fetched live from road authorities,
   weather APIs, permit records and verified operator listings.
2. If the context does not cover the question, say exactly what is missing and
   which live source would have it. Never invent a road status, permit, price or date.
3. Every factual claim must map to a context item id. End with SOURCES: [id, id].
4. Be concise and practical. Lead with the answer, then the caveat.
5. Timings, closures and hazards are safety-critical — state them plainly.
"""

STOP = set("a an the is are was were do does did can could should would will i my me we our you your to of in on at for from with about and or if it this that there how what when where which who whats whens please tell need want get got go going best good".split())


# ---------------------------------------------------------------- retrieval
def _tokens(q: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", q.lower()) if t not in STOP and len(t) > 2]


def _hits(text: str, toks: List[str]) -> int:
    """How many query tokens appear as whole words in this record's own words.

    Whole-word matching matters: 'safe' must not match 'unsafe', and a substring
    test would let 'today' match a record that only says 'day'.
    """
    words = set(re.findall(r"[a-z0-9]+", text.lower()))
    return sum(1 for t in toks if t in words)


# Ordered by which one should lead the answer when a question triggers several.
INTENTS = (
    ("permit",   ("permit", "permits", "noc", "visa", "document", "documents", "papers",
                  "entry", "fee", "fees", "border")),
    ("road",     ("road", "roads", "open", "closed", "closure", "status", "drive", "driving",
                  "route", "reach", "block", "blocked", "highway", "kkh", "convoy", "diversion")),
    ("safety",   ("safe", "safety", "danger", "dangerous", "risk", "risky", "hazard", "hazards",
                  "glof", "flood", "alert", "alerts", "warning", "avalanche", "landslide")),
    ("weather",  ("weather", "temperature", "cold", "hot", "rain", "snow", "forecast",
                  "pack", "packing", "wear", "clothes", "layers")),
    ("package",  ("tour", "tours", "package", "packages", "trip", "trips", "itinerary",
                  "book", "booking", "cost", "price", "budget", "cheap", "under",
                  "recommend", "suggest", "nights")),
    ("operator", ("operator", "operators", "guide", "guides", "driver", "drivers", "verified",
                  "trust", "trusted", "scam", "legit", "company", "agency")),
)


def detect_intents(q: str) -> List[str]:
    """Whole-word intent detection, returned in lead-priority order."""
    words = set(re.findall(r"[a-z0-9]+", q.lower()))
    return [name for name, keys in INTENTS if words & set(keys)]


def parse_budget(q: str) -> int | None:
    """'under 40,000' / 'under 40k' / 'PKR 80000' -> 40000."""
    m = re.search(r"(\d[\d,]{2,})\s*(?:pkr|rs|rupees)?", q.lower())
    if m:
        return int(m.group(1).replace(",", ""))
    m = re.search(r"(\d{1,3})\s*k\b", q.lower())
    if m:
        return int(m.group(1)) * 1000
    return None


def parse_days(q: str) -> int | None:
    m = re.search(r"(\d{1,2})[\s-]*day", q.lower())
    return int(m.group(1)) if m else None


def retrieve(question: str) -> Dict[str, Any]:
    """Name matches come first. A topic keyword only pulls in defaults when the
    question named nothing of that kind — so 'permits for Khunjerab' never drags
    in an unrelated closure, and an off-topic question retrieves nothing."""
    toks = _tokens(question)
    intents = detect_intents(question)
    ops = data.operator_index()

    def named(records, blob):
        scored = [(_hits(blob(r), toks), r) for r in records]
        scored = [(s, r) for s, r in scored if s > 0]
        scored.sort(key=lambda x: -x[0])
        return [r for _, r in scored]

    routes = named(data.ROUTES, lambda r: f"{r['name']} {r['valley']} {' '.join(r['permits'])} {' '.join(r['hazards'])}")
    alerts = named(data.ALERTS, lambda a: f"{a['title']} {a['body']} {a['kind']}")
    weather = named(data.WEATHER, lambda w: f"{w['city']} {w['condition']}")
    packages = named(data.PACKAGES, lambda p: f"{p['title']} {p['destination']} {p['pickup']} {' '.join(p['tags'])} {p['difficulty']} {ops[p['operator_id']]['name']}")
    operators = named(data.OPERATORS, lambda o: f"{o['name']} {o['base']} {' '.join(o['languages'])} {' '.join(o['vehicles'])}")

    matched_anything = any([routes, alerts, weather, packages, operators])

    # A route named in the question drags in the alerts and weather attached to it,
    # and drops alerts about other corridors that only matched on a stray word.
    if routes:
        rids = {r["id"] for r in routes}
        alerts = [a for a in alerts if set(a["routes"]) & rids]
        for a in data.ALERTS:
            if set(a["routes"]) & rids and a not in alerts:
                alerts.append(a)
        valleys = {r["valley"].lower() for r in routes}
        for w in data.WEATHER:
            if any(v in w["city"].lower() for v in valleys) and w not in weather:
                weather.append(w)

    # Topic fallbacks — only where the question named nothing of that kind.
    if not routes and ("road" in intents or "safety" in intents):
        routes = sorted(data.ROUTES, key=lambda r: r["status"] == "open")[:4]
    if not alerts and "safety" in intents:
        alerts = sorted(data.ALERTS, key=lambda a: a["severity"] != "high")[:2]
    if not weather and "weather" in intents:
        weather = data.WEATHER[:3]
    if not operators and "operator" in intents:
        operators = sorted(data.OPERATORS, key=lambda o: -o["rating"])[:3]

    if "package" in intents:
        pool = packages or data.PACKAGES
        budget = parse_budget(question)
        days = parse_days(question)
        if budget:
            affordable = [p for p in pool if p["price_pkr"] <= budget]
            pool = affordable or pool
        if days:
            pool = sorted(pool, key=lambda p: (abs(p["days"] - days), p["price_pkr"]))
        else:
            pool = sorted(pool, key=lambda p: (-p["rating"], p["price_pkr"]))
        packages = pool
    elif not packages:
        packages = []

    # Nothing named and no topic we cover -> the assistant should decline.
    out_of_scope = not matched_anything and not intents

    return {
        "routes": routes[:4],
        "weather": weather[:3],
        "alerts": alerts[:3],
        "packages": packages[:3],
        "operators": operators[:3],
        "permits": [r for r in routes if r["permits"]][:3],
        "intents": intents,
        "out_of_scope": out_of_scope,
        "budget": parse_budget(question),
        "days": parse_days(question),
    }


# ------------------------------------------------------------- context pack
def build_context(ctx: Dict[str, Any]) -> tuple[str, List[dict]]:
    lines: List[str] = []
    cites: List[dict] = []

    for r in ctx["routes"]:
        lines.append(
            f"[{r['id']}] ROAD | {r['name']} | status={r['status'].upper()} | {r['status_note']} | "
            f"{r['distance_km']} km, ~{r['drive_hours']} h, max elevation {r['elevation_m']} m | "
            f"permits={r['permits'] or 'none'} | hazards={r['hazards'] or 'none'} | "
            f"source={r['source']} | updated={r['updated_at']} | confidence={r['confidence']}"
        )
        cites.append({"id": r["id"], "kind": "road", "label": r["name"],
                      "source": r["source"], "updated_at": r["updated_at"]})

    for a in ctx["alerts"]:
        lines.append(f"[{a['id']}] ALERT | severity={a['severity']} | {a['kind']} | {a['title']} | {a['body']} | source={a['source']} | issued={a['issued_at']}")
        cites.append({"id": a["id"], "kind": "alert", "label": a["title"],
                      "source": a["source"], "updated_at": a["issued_at"]})

    for w in ctx["weather"]:
        fc = "; ".join(f"{d} {hi}/{lo}C {c}" for d, hi, lo, c in w["forecast"])
        wid = "wx-" + re.sub(r"[^a-z]+", "", w["city"].lower())[:12]
        lines.append(f"[{wid}] WEATHER | {w['city']} | now {w['temp_c']}C (feels {w['feels_c']}C), {w['condition']}, wind {w['wind_kmh']} km/h, visibility {w['visibility_km']} km | forecast: {fc} | source=OpenWeatherMap")
        cites.append({"id": wid, "kind": "weather", "label": w["city"],
                      "source": "OpenWeatherMap", "updated_at": ""})

    ops = data.operator_index()
    for p in ctx["packages"]:
        o = ops[p["operator_id"]]
        lines.append(f"[{p['id']}] PACKAGE | {p['title']} | {p['days']} days | PKR {p['price_pkr']:,} | pickup {p['pickup']} → {p['destination']} | {p['difficulty']} | operator {o['name']} (rated {o['rating']}, {'verified' if o['verified'] else 'unverified'}) | includes: {', '.join(p['includes'])}")
        cites.append({"id": p["id"], "kind": "package", "label": p["title"],
                      "source": "Northern Trails marketplace", "updated_at": ""})

    for o in ctx["operators"]:
        v = o["verification"]
        lines.append(f"[{o['id']}] OPERATOR | {o['name']} | base {o['base']} | rating {o['rating']} over {o['trips']} trips | reg {v['tourism_dept_reg']} verified {v['verified_on']} | checks: {', '.join(v['checks'])} | languages {', '.join(o['languages'])}")
        cites.append({"id": o["id"], "kind": "operator", "label": o["name"],
                      "source": f"Tourism Dept. reg {v['tourism_dept_reg']}", "updated_at": v["verified_on"]})

    return "\n".join(lines) if lines else "(no matching live records)", cites


# ------------------------------------------------------- deterministic answer
REFUSAL = (
    "I don't have a live record covering that. I only answer from the road-status feed "
    "(NHA and the district administrations), the weather poller, permit records and the verified "
    "operator listings — so I'd rather say nothing than guess. Name a route, a valley, or the kind "
    "of trip you want and I'll pull what's current."
)


def _route_line(r: dict) -> str:
    label = {
        "open": "is open",
        "caution": "is open but needs care",
        "restricted": "is open with restrictions",
        "seasonal": "is seasonally open",
        "closed": "is closed right now",
    }[r["status"]]
    return f"**{r['name']} {label}.** {r['status_note']}"


def compose_offline(question: str, ctx: Dict[str, Any]) -> str:
    if ctx["out_of_scope"] or not any(ctx[k] for k in ("routes", "alerts", "weather", "packages", "operators")):
        return REFUSAL

    intents = ctx["intents"]
    ops = data.operator_index()
    B: Dict[str, List[str]] = {}

    # ---- permits
    permits = [(r, p) for r in ctx["routes"] for p in r["permits"]]
    if "permit" in intents:
        if permits:
            B["permit"] = ["You'll be asked for the following on that route:\n\n" +
                           "\n".join(f"· **{p}** — for {r['name']}" for r, p in permits)]
        elif ctx["routes"]:
            B["permit"] = [f"No permit is recorded for {ctx['routes'][0]['name']} — only the standard "
                           f"CNIC/passport check at the security posts along the way."]

    # ---- packages
    if "package" in intents and ctx["packages"]:
        p0 = ctx["packages"][0]
        o = ops[p0["operator_id"]]
        head = (f"**{p0['title']}** is the closest fit — {p0['days']} days, PKR {p0['price_pkr']:,} per person, "
                f"{p0['pickup']} → {p0['destination']}, run by {o['name']} "
                f"(rated {o['rating']}, verified under {o['verification']['tourism_dept_reg']}).")
        if ctx["budget"]:
            head += (f" That is within your PKR {ctx['budget']:,} ceiling."
                     if p0["price_pkr"] <= ctx["budget"]
                     else f" Nothing in the catalogue comes in under PKR {ctx['budget']:,}, so this is the nearest option.")
        block = [head]
        alts = ctx["packages"][1:3]
        if alts:
            block.append("Also worth comparing:\n\n" + "\n".join(
                f"· {a['title']} — {a['days']} days, PKR {a['price_pkr']:,} ({ops[a['operator_id']]['name']})"
                for a in alts))
        B["package"] = block

    # ---- operators
    if "operator" in intents and ctx["operators"]:
        o = ctx["operators"][0]
        v = o["verification"]
        B["operator"] = [f"**{o['name']}** ({o['base']}) is verified: registration {v['tourism_dept_reg']}, "
                         f"last checked {v['verified_on']}, rated {o['rating']} across {o['trips']} trips. "
                         f"Checks on file: {', '.join(v['checks'])}."]

    # ---- safety / alerts
    high = [a for a in ctx["alerts"] if a["severity"] == "high"] or ctx["alerts"]
    if high:
        B["safety"] = [f"⚠️ **{a['title']}** — {a['body']} ({a['source']})" for a in high[:1]]

    # ---- road status
    if ctx["routes"]:
        order = ["closed", "restricted", "caution", "seasonal", "open"]
        ordered = sorted(ctx["routes"], key=lambda r: order.index(r["status"]))
        block = [_route_line(ordered[0])]
        rest = ordered[1:3]
        if rest and ("road" in intents or "safety" in intents or not intents):
            block.append("On the rest of your corridor:\n\n" + "\n".join(
                f"· {r['name']} — {r['status']}: {r['status_note']}" for r in rest))
        hazards = list(dict.fromkeys(h for r in ctx["routes"] for h in r["hazards"]))
        if hazards and ("road" in intents or "safety" in intents or not intents):
            block.append("Watch for: " + "; ".join(hazards) + ".")
        B["road"] = block

    # ---- weather
    if ctx["weather"] and ("weather" in intents or "road" in intents or "package" in intents or not intents):
        w = ctx["weather"][0]
        fc = ", ".join(f"{d} {hi}°/{lo}°" for d, hi, lo, _ in w["forecast"])
        line = (f"Weather at {w['city']}: {w['temp_c']}°C, {w['condition'].lower()}, wind {w['wind_kmh']} km/h, "
                f"visibility {w['visibility_km']} km. Next three days: {fc}.")
        if "weather" in intents and w["temp_c"] < 5:
            line += " Pack for sub-zero nights — insulated layers, gloves and a windproof shell."
        B["weather"] = [line]

    # The intent the traveler actually asked about leads; the rest follows in a
    # fixed order so the answer reads the same way every time.
    default_order = ["permit", "road", "safety", "package", "operator", "weather"]
    lead = intents[0] if intents else "road"
    order = [lead] + [k for k in default_order if k != lead]

    out: List[str] = []
    for key in order:
        out.extend(B.get(key, []))
    return "\n\n".join(out) if out else REFUSAL


# ---------------------------------------------------------------- Gemini leg
async def compose_gemini(question: str, context: str, history: List[dict]) -> str | None:
    if not GEMINI_KEY:
        return None
    contents = []
    for turn in history[-6:]:
        contents.append({"role": "user" if turn["role"] == "user" else "model",
                         "parts": [{"text": turn["content"]}]})
    contents.append({"role": "user", "parts": [{"text": f"CONTEXT:\n{context}\n\nQUESTION: {question}"}]})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 700},
    }
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post(url, params={"key": GEMINI_KEY}, json=body)
            resp.raise_for_status()
            payload = resp.json()
            return payload["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception:
        return None


async def answer(question: str, history: List[dict] | None = None) -> dict:
    history = history or []
    ctx = retrieve(question)
    context, cites = build_context(ctx)

    text = await compose_gemini(question, context, history)
    engine = "gemini"
    if not text:
        text = compose_offline(question, ctx)
        engine = "grounded-offline"

    text = re.sub(r"\n?SOURCES:.*$", "", text, flags=re.S).strip()
    return {
        "answer": text,
        "citations": cites,
        "engine": engine,
        "grounded_records": len(cites),
    }


SUGGESTIONS = [
    "Is the road to Skardu open today?",
    "Can I still cross Shandur Pass to Chitral?",
    "What permits do I need for Khunjerab Pass?",
    "Is it safe near Hassanabad right now?",
    "Find me a 3-day Hunza trip under PKR 40,000",
    "What should I pack for Deosai this week?",
]
