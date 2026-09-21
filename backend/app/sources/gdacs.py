"""GDACS hazard feed.

GDACS (Global Disaster Alert and Coordination System, JRC/UN) publishes a
worldwide RSS feed of active natural-hazard events with geo coordinates.
We pull it, keep only events inside the Gilgit-Baltistan / Chitral bounding
box, and map each one onto the routes it plausibly affects.

This is the closest thing to a real GLOF/flood feed that is actually
reachable from a server — the provincial disaster authority publishes no
machine-readable equivalent.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from ..geo import in_region, nearest_routes
from .base import Source

FEED = "https://www.gdacs.org/xml/rss.xml"

NS = {
    "gdacs": "http://www.gdacs.org",
    "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#",
}

# GDACS event codes -> the `kind` label the UI and assistant already use.
KIND = {
    "FL": "Flood", "EQ": "Earthquake", "TC": "Cyclone", "DR": "Drought",
    "VO": "Volcano", "WF": "Wildfire", "TS": "Tsunami",
}
SEVERITY = {"Red": "high", "Orange": "medium", "Green": "low"}


def _text(item: ET.Element, path: str, ns: dict | None = None) -> str:
    el = item.find(path, ns or {})
    return (el.text or "").strip() if el is not None and el.text else ""


def _iso(raw: str) -> str:
    if not raw:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    try:
        return parsedate_to_datetime(raw).astimezone(timezone.utc).replace(microsecond=0).isoformat()
    except (TypeError, ValueError):
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class GdacsSource(Source):
    name = "gdacs"
    source_url = FEED
    # A quiet region is a real answer, not a failure.
    allow_empty = True

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        resp = await client.get(FEED)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)

        out: list[dict] = []
        for item in root.iter("item"):
            lat_s = _text(item, "geo:Point/geo:lat", NS) or _text(item, "geo:lat", NS)
            lon_s = _text(item, "geo:Point/geo:long", NS) or _text(item, "geo:long", NS)
            if not lat_s or not lon_s:
                continue
            try:
                lat, lon = float(lat_s), float(lon_s)
            except ValueError:
                continue
            if not in_region(lat, lon):
                continue
            if _text(item, "gdacs:iscurrent", NS).lower() == "false":
                continue

            etype = _text(item, "gdacs:eventtype", NS).upper()
            level = _text(item, "gdacs:alertlevel", NS).capitalize()
            eid = _text(item, "guid") or f"{etype}{_text(item, 'gdacs:eventid', NS)}"

            out.append({
                "id": f"gdacs-{eid.lower()}",
                "severity": SEVERITY.get(level, "low"),
                "kind": KIND.get(etype, etype or "Hazard"),
                "title": _text(item, "title") or f"{KIND.get(etype, 'Hazard')} alert",
                "body": _text(item, "description"),
                "routes": nearest_routes(lat, lon, limit=2),
                "source": f"GDACS ({level or 'unrated'} alert)",
                "source_url": _text(item, "link") or FEED,
                "issued_at": _iso(_text(item, "pubDate")),
                "lat": lat,
                "lon": lon,
            })
        return out
