"""National Highway Authority — road status.

NHA publishes road advisories as HTML at nha.gov.pk. The site sits behind a
WAF that answers automated requests with HTTP 403 regardless of user agent,
so in practice this adapter reports `fallback` and the seeded road statuses
stand. The parser below is the real one: point `NHA_URL` at a reachable
mirror, a district-administration page with the same shape, or a saved
snapshot, and it produces live rows.

Matching is deliberately conservative. A road row is only accepted when the
text names a highway or place we already track, because a generic
"road closed" line with no location cannot be attached to a route safely.
"""
from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from ..config import NHA_URL
from .base import Source

# Text we might see -> the route it refers to.
ROUTE_PATTERNS: dict[str, list[str]] = {
    "kkh-gilgit-hunza": [r"\bgilgit\b.*\bhunza\b", r"\bkarimabad\b", r"\battabad\b", r"\bnagar\b"],
    "kkh-hunza-khunjerab": [r"\bkhunjerab\b", r"\bsost\b", r"\bpassu\b", r"\bgulmit\b"],
    "skardu-road": [r"\bskardu\b\s*road", r"\bs-?1\b", r"\bthowar\b", r"\bjaglot\b.*\bskardu\b"],
    "deosai-plains": [r"\bdeosai\b", r"\bsadpara\b", r"\bastore\b"],
    "shandur-chitral": [r"\bshandur\b", r"\blowari\b", r"\bchitral\b", r"\blangar\b"],
    "fairy-meadows": [r"\bfairy\s*meadow", r"\braikot\b", r"\btato\b"],
}

# Status keywords, most severe first — the first hit wins.
STATUS_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("closed", ("closed", "blocked", "suspended", "washed away", "closure")),
    ("restricted", ("restricted", "one-way", "convoy", "timings", "partially", "4x4 only", "single lane")),
    ("caution", ("caution", "slippery", "landslide", "rockfall", "diversion", "delay", "repair", "under repair")),
    ("open", ("open", "clear", "restored", "traffic flow normal", "through traffic")),
]


def classify(text: str) -> str | None:
    """Grade a road line.

    An explicit status word beats inference: when the page has a status
    column reading "Caution", that is the authority's own call and must not
    be overridden by an incidental phrase like "single lane" elsewhere in
    the row. Only when no canonical word appears do we infer from keywords.
    """
    low = text.lower()
    for status, _ in STATUS_RULES:                      # severe -> mild
        if re.search(rf"\b{status}\b", low):
            return status
    for status, words in STATUS_RULES:
        if any(w in low for w in words):
            return status
    return None


def match_route(text: str) -> str | None:
    low = text.lower()
    for rid, patterns in ROUTE_PATTERNS.items():
        if any(re.search(p, low) for p in patterns):
            return rid
    return None


def parse(html: str, source_url: str = NHA_URL) -> list[dict]:
    """Pull road-status rows out of an NHA-style page. Importable for tests."""
    soup = BeautifulSoup(html, "lxml")
    for junk in soup(["script", "style", "nav", "header", "footer"]):
        junk.decompose()

    # Table rows first (NHA's usual layout), then list/paragraph fallbacks.
    candidates: list[str] = []
    for tr in soup.find_all("tr"):
        cells = [re.sub(r"\s+", " ", td.get_text(" ")).strip() for td in tr.find_all(["td", "th"])]
        cells = [c for c in cells if c]
        if len(cells) >= 2:
            candidates.append(". ".join(cells))
    for node in soup.find_all(["li", "p"]):
        txt = re.sub(r"\s+", " ", node.get_text(" ")).strip()
        if 15 <= len(txt) <= 400:
            candidates.append(txt)

    rows: dict[str, dict] = {}
    for text in candidates:
        rid = match_route(text)
        if not rid:
            continue
        status = classify(text)
        if not status:
            continue
        # Keep the most detailed line seen for a given route.
        prev = rows.get(rid)
        if prev and len(prev["status_note"]) >= len(text):
            continue
        rows[rid] = {
            "id": rid,
            "status": status,
            "status_note": text,
            "source": "NHA Road Advisory",
            "source_url": source_url,
        }
    return list(rows.values())


class NhaSource(Source):
    name = "nha"
    source_url = NHA_URL

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        resp = await client.get(NHA_URL)
        resp.raise_for_status()
        return parse(resp.text, NHA_URL)
