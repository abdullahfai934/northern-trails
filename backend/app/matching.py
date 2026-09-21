"""Real-time request-and-match engine.

A traveler posts an on-demand trip request. The dispatcher fans it out to the
nearest available operators over WebSocket, holds the request open for a
response window, and the first operator to accept wins the job. Everything is
broadcast back to the traveler's socket so the UI can animate live.
"""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Set

from . import data
from .routing import road_route

log = logging.getLogger("northern_trails.matching")

RESPONSE_WINDOW_SEC = 45          # how long the request stays open
OFFER_STAGGER_SEC = 1.6           # delay between fan-out waves


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Hub:
    """Tracks every open socket and every in-flight trip request."""

    def __init__(self) -> None:
        self.traveler_sockets: Dict[str, Set[Any]] = {}
        self.operator_sockets: Dict[str, Set[Any]] = {}
        self.requests: Dict[str, dict] = {}
        self.availability: Dict[str, bool] = {o["id"]: True for o in data.OPERATORS}
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------------- sockets
    async def join(self, kind: str, key: str, ws) -> None:
        table = self.traveler_sockets if kind == "traveler" else self.operator_sockets
        table.setdefault(key, set()).add(ws)

    async def leave(self, kind: str, key: str, ws) -> None:
        table = self.traveler_sockets if kind == "traveler" else self.operator_sockets
        if key in table:
            table[key].discard(ws)
            if not table[key]:
                table.pop(key, None)

    async def _send(self, sockets: Set[Any], payload: dict) -> None:
        dead = []
        for ws in list(sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            sockets.discard(ws)

    async def to_traveler(self, traveler_id: str, payload: dict) -> None:
        await self._send(self.traveler_sockets.get(traveler_id, set()), payload)

    async def to_operator(self, operator_id: str, payload: dict) -> None:
        await self._send(self.operator_sockets.get(operator_id, set()), payload)

    async def to_all_operators(self, payload: dict) -> None:
        for op_id in list(self.operator_sockets):
            await self.to_operator(op_id, payload)

    # --------------------------------------------------------------- matching
    def _candidates(self, req: dict) -> List[dict]:
        """Fallback ranking used when no database is configured.

        A hand-maintained adjacency table: correct, but it needs a new
        entry for every town and operator. `_candidates_async` prefers
        the PostGIS query, which needs none.
        """
        near = {
            "Gilgit": ["op-karakoram", "op-hunza-guides", "op-nanga"],
            "Karimabad (Hunza)": ["op-hunza-guides", "op-karakoram"],
            "Passu": ["op-hunza-guides", "op-karakoram"],
            "Attabad Lake": ["op-hunza-guides", "op-karakoram"],
            "Skardu": ["op-baltistan", "op-karakoram"],
            "Khaplu": ["op-baltistan"],
            "Deosai": ["op-baltistan"],
            "Chilas": ["op-nanga", "op-karakoram"],
            "Raikot Bridge": ["op-nanga"],
            "Astore": ["op-nanga", "op-baltistan"],
            "Chitral": ["op-chitral"],
            "Naltar": ["op-karakoram", "op-hunza-guides"],
        }
        ids = near.get(req["pickup"], [o["id"] for o in data.OPERATORS])
        pool = [o for o in data.OPERATORS if o["id"] in ids and self.availability.get(o["id"], True)]
        if len(pool) < 2:  # widen the radius rather than leave the traveler stranded
            extra = [o for o in data.OPERATORS
                     if o["id"] not in {p["id"] for p in pool} and self.availability.get(o["id"], True)]
            pool += extra[: 3 - len(pool)]
        pool.sort(key=lambda o: (-o["rating"], o["response_min"]))
        return pool[:3]

    async def _candidates_async(self, req: dict) -> List[dict]:
        """Rank operators by true distance when PostGIS is available.

        Falls back to the adjacency table if there is no database, the
        pickup point has no coordinates, or the query errors — dispatch
        must never fail because of the storage layer.
        """
        available = {oid for oid, ok in self.availability.items() if ok}
        if not available:
            available = {o["id"] for o in data.OPERATORS}
        try:
            from .db import repo
            spatial = await repo.nearest_operators(req["pickup"], available, limit=3)
        except Exception:
            spatial = None
        if spatial:
            return spatial
        return self._candidates(req)

    @staticmethod
    def _price(svc: dict, km: float, passengers: int) -> int:
        price = svc["base_pkr"] + svc["per_km"] * km
        if passengers > 4:
            price = int(price * 1.25)
        return int(round(price / 500.0) * 500)

    async def quote(self, req: dict) -> dict:
        """Price a trip from the real road distance between the two towns.

        Returns the fare plus the routing evidence behind it, so the UI can
        show *why* a number is what it is instead of asserting it.
        """
        svc = next((s for s in data.SERVICE_TYPES if s["id"] == req["service"]),
                   data.SERVICE_TYPES[0])
        route = await road_route(req["pickup"], req["dropoff"])

        # Guides and porters are day-rate, not distance-based.
        distance_priced = svc["per_km"] > 0
        km = route["distance_km"]
        if km is None:
            km = req.get("distance_km") or 60
            route = {**route, "method": "fallback",
                     "note": "Unknown route — priced on a nominal distance."}

        return {
            "estimate_pkr": self._price(svc, km if distance_priced else 0,
                                        req.get("passengers", 1)),
            "distance_km": route["distance_km"],
            "duration_min": route["duration_min"],
            "route_method": route["method"],
            "route_note": route["note"],
            "priced_on": "distance" if distance_priced else "day-rate",
        }

    async def create_request(self, req: dict) -> dict:
        rid = "req-" + uuid.uuid4().hex[:8]
        quote = await self.quote(req)
        record = {
            "id": rid,
            "status": "searching",
            "created_at": now_iso(),
            "expires_in": RESPONSE_WINDOW_SEC,
            "offers": [],
            "accepted_by": None,
            **req,
            **quote,
        }
        async with self._lock:
            self.requests[rid] = record
        await self._persist(record)
        asyncio.create_task(self._dispatch(rid))
        return record

    @staticmethod
    async def _persist(req: dict, **changes) -> None:
        """Mirror a trip into the database so rides are real, queryable records."""
        try:
            from .db import repo
            await repo.save_trip({**req, **changes})
        except Exception:
            log.exception("could not persist trip %s", req.get("id"))

    async def _dispatch(self, rid: str) -> None:
        req = self.requests.get(rid)
        if not req:
            return
        candidates = await self._candidates_async(req)
        await self.to_traveler(req["traveler_id"], {
            "type": "search.started",
            "request": self._public(req),
            "candidate_count": len(candidates),
        })

        for i, op in enumerate(candidates):
            await asyncio.sleep(OFFER_STAGGER_SEC)
            if self.requests.get(rid, {}).get("status") != "searching":
                return
            await self.to_operator(op["id"], {
                "type": "job.offered",
                "request": self._public(req),
                "expires_in": RESPONSE_WINDOW_SEC,
            })
            await self.to_traveler(req["traveler_id"], {
                "type": "search.notified",
                "operator": self._op_card(op),
                "index": i,
            })
            # Simulated operator-side behaviour so the demo is self-driving.
            # With real operator apps connected this task is a no-op.
            asyncio.create_task(self._simulate(rid, op))

        await asyncio.sleep(RESPONSE_WINDOW_SEC)
        req = self.requests.get(rid)
        if req and req["status"] == "searching":
            req["status"] = "expired"
            await self._persist(req)
            await self.to_traveler(req["traveler_id"], {"type": "search.expired", "request": self._public(req)})

    async def _simulate(self, rid: str, op: dict) -> None:
        """Stand-in for an operator who has no app open.

        There is no way to conjure a real driver, so an operator with no
        live socket answers automatically — otherwise a solo demo would
        just time out. Every offer it produces is flagged `simulated: True`
        and the UI labels it, so a stand-in is never mistaken for a real
        driver. The moment a real operator connects a socket, this returns
        immediately and that operator answers for themselves.
        """
        if self.operator_sockets.get(op["id"]):
            return
        await asyncio.sleep(random.uniform(3.0, 9.0))
        req = self.requests.get(rid)
        if not req or req["status"] != "searching":
            return

        # ETA is derived from the real road route, not invented.
        base_eta = max(5, round((req.get("duration_min") or 45) * 0.25))
        if random.random() < 0.25:
            await self.reject(rid, op["id"], reason="Vehicle already booked")
        else:
            bump = random.choice([-2000, -1000, 0, 0, 1500, 3000])
            await self.offer(
                rid, op["id"],
                price_pkr=max(3000, req["estimate_pkr"] + bump),
                eta_min=base_eta + random.randint(0, 12),
                message=random.choice([
                    "Can pick you up from the hotel lobby.",
                    "Land Cruiser with chains fitted, ready now.",
                    "I know the diversion timing, we will clear it in daylight.",
                    "English-speaking driver available.",
                ]),
                simulated=True,
            )

    # ------------------------------------------------------------ operator ops
    async def offer(self, rid: str, operator_id: str, price_pkr: int, eta_min: int,
                    message: str = "", simulated: bool = False) -> dict | None:
        req = self.requests.get(rid)
        if not req or req["status"] != "searching":
            return None
        op = data.operator_index()[operator_id]
        offer = {
            "id": "off-" + uuid.uuid4().hex[:6],
            "operator": self._op_card(op),
            "price_pkr": price_pkr,
            "eta_min": eta_min,
            "message": message,
            #: True when no real operator app answered — the UI says so.
            "simulated": simulated,
            "created_at": now_iso(),
        }
        req["offers"].append(offer)
        await self._persist(req)
        await self.to_traveler(req["traveler_id"], {"type": "offer.received", "request_id": rid, "offer": offer})
        return offer

    async def reject(self, rid: str, operator_id: str, reason: str = "") -> None:
        req = self.requests.get(rid)
        if not req:
            return
        op = data.operator_index()[operator_id]
        await self.to_traveler(req["traveler_id"], {
            "type": "offer.declined",
            "request_id": rid,
            "operator": self._op_card(op),
            "reason": reason,
        })

    async def accept_offer(self, rid: str, offer_id: str) -> dict | None:
        req = self.requests.get(rid)
        if not req or req["status"] != "searching":
            return None
        offer = next((o for o in req["offers"] if o["id"] == offer_id), None)
        if not offer:
            return None
        req["status"] = "confirmed"
        req["accepted_by"] = offer
        await self._persist(req)
        op_id = offer["operator"]["id"]
        await self.to_operator(op_id, {"type": "job.confirmed", "request": self._public(req)})
        await self.to_all_operators({"type": "job.taken", "request_id": rid})
        await self.to_traveler(req["traveler_id"], {"type": "trip.confirmed", "request": self._public(req)})
        asyncio.create_task(self._track(rid))
        return req

    async def _track(self, rid: str) -> None:
        """Live trip tracking: driver approaching → arrived → en route → done."""
        stages = [
            (4, "driver_enroute", "Driver is on the way to your pickup point"),
            (8, "arrived", "Driver has arrived at the pickup point"),
            (6, "in_progress", "Trip started — live location sharing is on"),
            (12, "completed", "Trip completed. Rate your operator."),
        ]
        for delay, stage, note in stages:
            await asyncio.sleep(delay)
            req = self.requests.get(rid)
            if not req or req["status"] == "cancelled":
                return
            req["stage"] = stage
            if stage == "completed":
                req["status"] = "completed"
            await self._persist(req)
            await self.to_traveler(req["traveler_id"], {
                "type": "trip.update", "request_id": rid, "stage": stage, "note": note,
                "at": now_iso(),
            })

    # ------------------------------------------------------------------ utils
    def _op_card(self, op: dict) -> dict:
        return {k: op[k] for k in ("id", "name", "base", "rating", "trips", "verified", "vehicles", "avatar_hue", "languages")}

    def _public(self, req: dict) -> dict:
        return {k: v for k, v in req.items() if k != "_internal"}

    def set_availability(self, operator_id: str, available: bool) -> None:
        self.availability[operator_id] = available

    def open_jobs(self) -> List[dict]:
        return [self._public(r) for r in self.requests.values() if r["status"] == "searching"]


hub = Hub()
