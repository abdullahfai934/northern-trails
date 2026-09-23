"""A small time-bounded cache for third-party lookups.

Photos and restaurants change on the scale of weeks, while the public APIs
behind them (Wikimedia, Overpass) rate-limit bursts. Caching by query keeps
a page full of cards from turning into a burst, and keeps a result available
when the upstream is briefly down.

Entries are kept in memory and mirrored to a JSON file so a restart does not
empty the cache. The file is best-effort: a read-only or ephemeral disk just
means the cache starts cold.
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import threading
import time
from typing import Any

log = logging.getLogger("northern_trails.cache")

CACHE_DIR = pathlib.Path(os.environ.get("NT_CACHE_DIR")
                         or pathlib.Path(__file__).resolve().parents[1] / ".cache")


class TTLCache:
    def __init__(self, name: str, ttl_sec: float, max_items: int = 500):
        self.ttl = ttl_sec
        self.max_items = max_items
        self._path = CACHE_DIR / f"{name}.json"
        self._lock = threading.Lock()
        self._items: dict[str, tuple[float, Any]] = {}
        self._load()

    def get(self, key: str, *, allow_stale: bool = False) -> Any | None:
        hit = self._items.get(key)
        if not hit:
            return None
        stored_at, value = hit
        if allow_stale or time.time() - stored_at < self.ttl:
            return value
        return None

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._items[key] = (time.time(), value)
            if len(self._items) > self.max_items:
                oldest = sorted(self._items, key=lambda k: self._items[k][0])
                for k in oldest[: len(self._items) - self.max_items]:
                    self._items.pop(k, None)
            self._save()

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text())
            self._items = {k: (float(v[0]), v[1]) for k, v in raw.items()}
        except FileNotFoundError:
            pass
        except Exception as exc:
            log.info("ignoring unreadable cache %s: %s", self._path.name, exc)

    def _save(self) -> None:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._items))
            tmp.replace(self._path)
        except Exception as exc:
            log.debug("cache %s not persisted: %s", self._path.name, exc)
