"""USGS earthquake feed — a real hazard signal for Northern Pakistan.

Gilgit-Baltistan sits on the India–Eurasia collision zone. Quakes matter to
this product not for their own sake but because they trigger the rockfall
and landslides that shut the KKH, so a recent tremor near a route is a
reason to treat that road with caution.

Keyless and worldwide, filtered to the Northern Pakistan bounding box.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from ..geo import REGION_BBOX, nearest_routes
from .base import Source

ENDPOINT = "https://earthquake.usgs.gov/fdsnws/event/1/query"

#: Below this, a quake is not a driving hazard worth surfacing.
MIN_MAGNITUDE = 4.0
LOOKBACK_DAYS = 10


def severity_for(magnitude: float) -> str:
    if magnitude >= 5.5:
        return "high"
    if magnitude >= 4.5:
        return "medium"
    return "low"


class UsgsSource(Source):
    name = "usgs"
    source_url = "https://earthquake.usgs.gov"
    # A quiet fortnight is the normal, welcome case.
    allow_empty = True
    #: quakes inside the region but too far from any road to attach
    regional_count = 0

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
        resp = await client.get(ENDPOINT, params={
            "format": "geojson",
            "minlatitude": REGION_BBOX["min_lat"], "maxlatitude": REGION_BBOX["max_lat"],
            "minlongitude": REGION_BBOX["min_lon"], "maxlongitude": REGION_BBOX["max_lon"],
            "starttime": since.strftime("%Y-%m-%d"),
            "minmagnitude": MIN_MAGNITUDE,
            "orderby": "time",
        })
        resp.raise_for_status()

        out, regional = [], 0
        for feature in resp.json().get("features", []):
            props = feature.get("properties") or {}
            coords = (feature.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
            depth = float(coords[2]) if len(coords) > 2 else 0.0
            mag = props.get("mag")
            if mag is None:
                continue
            regional += 1
            routes = nearest_routes(lat, lon, limit=2)
            if not routes:
                continue          # in the region, but too far from any road we track
            when = datetime.fromtimestamp(props["time"] / 1000, tz=timezone.utc)
            place = props.get("place") or "Northern Pakistan"
            out.append({
                "id": "usgs-" + str(feature.get("id", "")),
                "severity": severity_for(float(mag)),
                "kind": "Earthquake",
                "title": f"M{mag} earthquake — {place}",
                "body": (f"Magnitude {mag} at {depth:.0f} km depth, {place}. "
                         "Recent seismic activity raises rockfall and landslide risk on "
                         "nearby mountain roads — check the road status before travelling."),
                "routes": routes,
                "source": "USGS Earthquake Hazards Program",
                "source_url": props.get("url") or self.source_url,
                "issued_at": when.replace(microsecond=0).isoformat(),
                "lat": lat,
                "lon": lon,
                "magnitude": float(mag),
                "depth_km": round(depth, 1),
            })
        self.regional_count = regional
        return out
