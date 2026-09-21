"""Common contract for every live-conditions source adapter.

Each adapter answers one question ("what is the weather", "what hazards are
active", "which roads are shut") and returns a `SourceResult`. An adapter
never raises into the poller and never mutates the data layer itself: it
reports what it found plus how it found it, and the poller decides whether
that is good enough to replace the seeded rows.

`mode` is the honesty field. "live" means the numbers came off the wire;
"fallback" means the source was unreachable or unconfigured and the seeded
rows still stand. It is surfaced all the way to /api/health and the UI.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import SOURCE_USER_AGENT

log = logging.getLogger("northern_trails.sources")

Mode = str  # "live" | "fallback" | "disabled"


@dataclass
class SourceResult:
    name: str
    mode: Mode
    items: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""
    fetched_at: str = ""
    source_url: str = ""

    def __post_init__(self) -> None:
        if not self.fetched_at:
            self.fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @property
    def ok(self) -> bool:
        return self.mode == "live"

    def summary(self) -> dict:
        return {
            "name": self.name,
            "mode": self.mode,
            "count": len(self.items),
            "error": self.error,
            "fetched_at": self.fetched_at,
            "source_url": self.source_url,
        }


class Source:
    """Base adapter. Subclasses implement `_fetch`; `run` guarantees no raise."""

    name = "source"
    source_url = ""
    #: A hazard feed legitimately returns nothing when the region is quiet.
    #: A weather feed returning nothing means it failed. Adapters declare which.
    allow_empty = False

    def configured(self) -> bool:
        return True

    async def _fetch(self, client: httpx.AsyncClient) -> list[dict]:
        raise NotImplementedError

    async def run(self) -> SourceResult:
        if not self.configured():
            return SourceResult(self.name, "disabled", error="not configured",
                                source_url=self.source_url)
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(15.0),
                headers={"User-Agent": SOURCE_USER_AGENT},
                follow_redirects=True,
            ) as client:
                items = await self._fetch(client)
            if not items and not self.allow_empty:
                return SourceResult(self.name, "fallback", error="source returned no usable rows",
                                    source_url=self.source_url)
            return SourceResult(self.name, "live", items=items, source_url=self.source_url)
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            hint = {401: " (credentials rejected — check the API key)",
                    403: " (blocked — the site refuses automated requests)",
                    429: " (rate limited)"}.get(code, "")
            log.warning("%s: HTTP %s%s", self.name, code, hint)
            return SourceResult(self.name, "fallback", error=f"HTTP {code}{hint}",
                                source_url=self.source_url)
        except Exception as exc:  # network, parse, malformed payload
            log.warning("%s: %s: %s", self.name, type(exc).__name__, exc)
            return SourceResult(self.name, "fallback",
                                error=f"{type(exc).__name__}: {exc}",
                                source_url=self.source_url)
