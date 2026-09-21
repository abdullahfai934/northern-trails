"""Scheduled refresh of the live-conditions layer.

Runs each adapter on its own interval and merges what comes back into the
in-memory data layer (and, when a database is configured, persists it).

Merge policy — the important part:

* Nothing live ever *deletes* a seeded row. The seeded rows are the
  demonstrable baseline; live rows enrich or override them. A source going
  dark degrades the app to seeded data rather than to an empty screen.
* Every row carries `origin`: "seed" until a live source touches it, then
  the adapter name. The Conditions UI and /api/conditions/sources expose
  this, so what is real is never ambiguous.
* Live hazards are keyed by id and re-synced each cycle, so an event that
  clears disappears — but only live ones, never the seeded set.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from .. import data
from ..config import (POLL_ENABLED, POLL_HAZARD_MIN, POLL_ROAD_MIN,
                      POLL_WEATHER_MIN)
from .base import SourceResult
from ..config import OPENWEATHER_KEY
from .gdacs import GdacsSource
from .nha import NhaSource
from .openmeteo import OpenMeteoSource
from .openweather import OpenWeatherSource
from .pmd import PmdSource
from .usgs import UsgsSource

log = logging.getLogger("northern_trails.poller")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


async def _persist(**kwargs) -> None:
    """Mirror a refresh into PostgreSQL when one is configured."""
    try:
        from ..db import repo
        await repo.save_conditions(**kwargs)
    except Exception:
        log.exception("persisting conditions failed — in-memory layer is still current")


class ConditionsPoller:
    def __init__(self) -> None:
        # Open-Meteo is the primary because it needs no key, so a fresh
        # clone has genuinely live weather. OpenWeatherMap runs alongside
        # it when a key is present: two independent providers measuring the
        # same place let the app say how much to trust the reading, rather
        # than asking the user to take one model's word for it.
        self.weather = OpenMeteoSource()
        self.weather_secondary = OpenWeatherSource() if OPENWEATHER_KEY else None
        self.gdacs = GdacsSource()
        self.usgs = UsgsSource()
        self.pmd = PmdSource()
        self.nha = NhaSource()
        self.results: dict[str, SourceResult] = {}
        #: set by the app; awaited whenever a road status actually moves
        self.on_route_change = None
        self._tasks: list[asyncio.Task] = []
        self._tag_seed()

    # ------------------------------------------------------------ provenance
    @staticmethod
    def _tag_seed() -> None:
        for row in data.ROUTES:
            row.setdefault("origin", "seed")
        for row in data.ALERTS:
            row.setdefault("origin", "seed")
        for row in data.WEATHER:
            row.setdefault("origin", "seed")

    # --------------------------------------------------------------- weather
    @staticmethod
    def _cross_check(primary: dict, secondary: dict | None) -> dict:
        """Compare two providers for the same city and score the agreement.

        Mountain weather models diverge most where terrain is steep, which
        is exactly where a traveller most needs to know the reading is
        uncertain. A wide gap lowers confidence rather than being hidden.
        """
        if not secondary:
            return {"confidence": 0.8, "sources_agree": None,
                    "cross_checked": False}
        gap = abs(primary["temp_c"] - secondary["temp_c"])
        agree = gap <= 3
        confidence = 0.95 if gap <= 1 else 0.88 if gap <= 3 else 0.62
        return {
            "confidence": confidence,
            "sources_agree": agree,
            "cross_checked": True,
            "temp_gap_c": gap,
            "second_opinion": {
                "source": "OpenWeatherMap",
                "temp_c": secondary["temp_c"],
                "condition": secondary["condition"],
            },
        }

    async def refresh_weather(self) -> SourceResult:
        """Open-Meteo is authoritative; OpenWeatherMap corroborates it."""
        if self.weather_secondary is not None:
            res, second = await asyncio.gather(
                self.weather.run(), self.weather_secondary.run())
            self.results["weather_2nd"] = second
        else:
            res, second = await self.weather.run(), None
        self.results["weather"] = res
        if not res.ok:
            return res

        by_city_2nd = {}
        if second is not None and second.ok:
            by_city_2nd = {w["city"]: w for w in second.items}
        for row in res.items:
            row.update(self._cross_check(row, by_city_2nd.get(row["city"])))
        by_city = {w["city"]: w for w in data.WEATHER}
        for row in res.items:
            row["origin"] = self.weather.name
            existing = by_city.get(row["city"])
            if existing:
                # Keep the seeded forecast if the live call could not supply one.
                if not row.get("forecast"):
                    row["forecast"] = existing.get("forecast", [])
                existing.update(row)
            else:
                data.WEATHER.append(row)
        await _persist(weather=res.items)
        log.info("weather: %d cities refreshed from OpenWeatherMap", len(res.items))
        return res

    # --------------------------------------------------------------- hazards
    async def refresh_hazards(self) -> SourceResult:
        """Two independent hazard feeds: GDACS events and USGS earthquakes."""
        gdacs_res, usgs_res = await asyncio.gather(self.gdacs.run(), self.usgs.run())
        self.results["hazards"] = gdacs_res
        self.results["seismic"] = usgs_res

        for origin, res in (("gdacs", gdacs_res), ("usgs", usgs_res)):
            if not res.ok:
                continue
            live_ids = {a["id"] for a in res.items}
            # Drop this source's rows from the previous cycle that have cleared.
            data.ALERTS[:] = [a for a in data.ALERTS
                              if a.get("origin") != origin or a["id"] in live_ids]
            existing = {a["id"]: a for a in data.ALERTS}
            for row in res.items:
                row["origin"] = origin
                if row["id"] in existing:
                    existing[row["id"]].update(row)
                else:
                    data.ALERTS.append(row)
            await _persist(alerts=res.items)
            log.info("hazards: %d active %s events near tracked routes",
                     len(res.items), origin.upper())
        return gdacs_res

    # ----------------------------------------------------------------- roads
    async def refresh_roads(self) -> SourceResult:
        """NHA sets road status; PMD contributes a weather advisory alert."""
        nha_res, pmd_res = await asyncio.gather(self.nha.run(), self.pmd.run())
        self.results["roads"] = nha_res
        self.results["advisory"] = pmd_res

        if nha_res.ok:
            ridx = data.route_index()
            changed: list[tuple[dict, str, str]] = []
            for row in nha_res.items:
                route = ridx.get(row["id"])
                if not route:
                    continue
                previous = route.get("status", "")
                if previous != row["status"]:
                    changed.append((route, previous, row["status"]))
                route.update({
                    "status": row["status"],
                    "status_note": row["status_note"],
                    "source": row["source"],
                    "source_url": row["source_url"],
                    "updated_at": _now(),
                    "confidence": 0.95,          # straight from the authority
                    "origin": "nha",
                })
            log.info("roads: %d route statuses refreshed from NHA", len(nha_res.items))
            for route, previous, current in changed:
                log.info("route %s changed: %s -> %s", route["id"], previous, current)
                if self.on_route_change:
                    try:
                        await self.on_route_change(route, previous, current)
                    except Exception:
                        log.exception("on_route_change handler failed")

        if pmd_res.ok and pmd_res.items:
            data.ALERTS[:] = [a for a in data.ALERTS if a.get("origin") != "pmd"]
            for row in pmd_res.items:
                row["origin"] = "pmd"
                row["issued_at"] = _now()
                data.ALERTS.append(row)
            log.info("advisory: PMD tourist advisory attached to %d routes",
                     len(pmd_res.items[0]["routes"]))
        await _persist(routes=[r for r in data.ROUTES if r.get("origin") == "nha"],
                       alerts=[a for a in data.ALERTS if a.get("origin") == "pmd"])
        return nha_res

    # ----------------------------------------------------------------- loops
    async def refresh_all(self) -> dict:
        await asyncio.gather(self.refresh_weather(), self.refresh_hazards(),
                             self.refresh_roads())
        return self.status()

    async def _loop(self, fn, minutes: int, label: str) -> None:
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:                     # a poller must never die
                log.exception("%s poll cycle failed", label)
            await asyncio.sleep(max(60, minutes * 60))

    def start(self) -> None:
        if not POLL_ENABLED:
            log.info("polling disabled (POLL_ENABLED=0) — serving seeded conditions")
            return
        loop = asyncio.get_event_loop()
        self._tasks = [
            loop.create_task(self._loop(self.refresh_weather, POLL_WEATHER_MIN, "weather")),
            loop.create_task(self._loop(self.refresh_hazards, POLL_HAZARD_MIN, "hazards")),
            loop.create_task(self._loop(self.refresh_roads, POLL_ROAD_MIN, "roads")),
        ]
        log.info("conditions poller started (weather %dm, hazards %dm, roads %dm)",
                 POLL_WEATHER_MIN, POLL_HAZARD_MIN, POLL_ROAD_MIN)

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    # ---------------------------------------------------------------- status
    def status(self) -> dict:
        counts = {
            "routes_live": sum(1 for r in data.ROUTES if r.get("origin") not in (None, "seed")),
            "routes_total": len(data.ROUTES),
            "alerts_live": sum(1 for a in data.ALERTS if a.get("origin") not in (None, "seed")),
            "alerts_total": len(data.ALERTS),
            "weather_live": sum(1 for w in data.WEATHER if w.get("origin") not in (None, "seed")),
            "weather_total": len(data.WEATHER),
        }
        return {"sources": {k: v.summary() for k, v in self.results.items()}, "coverage": counts}


poller = ConditionsPoller()
