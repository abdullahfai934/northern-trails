"""Pakistan Meteorological Department — tourist-region advisory.

PMD publishes a narrative forecast for tourist destinations at
weather.gov.pk/nwfc/tourist that names regions directly ("rain-wind/
thunderstorm is expected at a few places in ... Chitral, Gilgit and Hunza").
There is no API, so we parse the page, pull the advisory paragraph, and
attach it to whichever of our routes the named regions touch.

This produces a route-level *advisory*, not a road status: PMD does not
say whether a road is open. Road status stays with the NHA adapter.
"""
from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from .base import Source

URL = "https://weather.gov.pk/nwfc/tourist"

# Region names PMD uses -> the routes they affect.
REGION_ROUTES: dict[str, list[str]] = {
    "hunza": ["kkh-gilgit-hunza", "kkh-hunza-khunjerab"],
    "gilgit": ["kkh-gilgit-hunza", "skardu-road", "shandur-chitral"],
    "chitral": ["shandur-chitral"],
    "skardu": ["skardu-road", "deosai-plains"],
    "astore": ["deosai-plains"],
    "naran": ["fairy-meadows"],
    "kaghan": ["fairy-meadows"],
}

# Phrases that imply travel friction, used to grade the advisory.
SEVERE = ("heavy", "flash flood", "landslide", "glof", "cloudburst", "avalanche", "snowfall")
MODERATE = ("rain", "thunderstorm", "wind", "showers", "snow")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _severity(text: str) -> str:
    low = text.lower()
    if any(w in low for w in SEVERE):
        return "high"
    if any(w in low for w in MODERATE):
        return "medium"
    return "low"


class PmdSource(Source):
    name = "pmd"
    source_url = URL
    # A calm forecast naming none of our regions is a valid live answer.
    allow_empty = True

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        resp = await client.get(URL)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        for junk in soup(["script", "style", "nav", "header", "footer"]):
            junk.decompose()

        # The advisory is the longest block that forecasts weather over
        # named places; anchor on the verb rather than a brittle CSS path.
        best = ""
        for node in soup.find_all(["p", "div", "td", "li"]):
            txt = _clean(node.get_text(" "))
            if not (60 <= len(txt) <= 800):
                continue
            low = txt.lower()
            if "expected" in low and any(r in low for r in REGION_ROUTES):
                if len(txt) > len(best):
                    best = txt
        if not best:
            return []

        low = best.lower()
        hit = sorted({r for region, rs in REGION_ROUTES.items()
                      if re.search(rf"\b{region}\b", low) for r in rs})
        if not hit:
            return []

        return [{
            "id": "pmd-tourist-advisory",
            "severity": _severity(best),
            "kind": "Weather advisory",
            "title": "PMD tourist-region weather advisory",
            "body": best,
            "routes": hit,
            "source": "Pakistan Meteorological Department (NWFC tourist forecast)",
            "source_url": URL,
        }]
