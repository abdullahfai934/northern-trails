#!/usr/bin/env python3
"""Regenerate frontend/src/lib/demo-data.json from the backend's data layer.

The SPA paints from this bundled snapshot while the API is waking up (a free
container host can take most of a minute), then swaps in the live answer.
Generating it from backend/app/data.py keeps the two from drifting apart:
run this after changing packages, routes or destinations.

    backend/.venv/bin/python scripts/snapshot.py
"""
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["POLL_ENABLED"] = "0"
os.environ["DATABASE_URL"] = ""

from app import assistant, data  # noqa: E402
from app.geo import ROUTE_ENDPOINTS  # noqa: E402

snapshot = {
    "routes": [{**r, "endpoints": ROUTE_ENDPOINTS.get(r["id"])} for r in data.ROUTES],
    "alerts": data.ALERTS,
    "weather": data.WEATHER,
    "operators": data.OPERATORS,
    # Only seeded packages: ones added in the admin screen live in the database.
    "packages": [p for p in data.PACKAGES if p.get("source", "seed") == "seed"],
    "services": data.SERVICE_TYPES,
    "cities": data.CITIES,
    "suggestions": assistant.SUGGESTIONS,
    "destinations": data.DESTINATIONS,
}
out = ROOT / "frontend" / "src" / "lib" / "demo-data.json"
out.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out.relative_to(ROOT)} ({len(snapshot['packages'])} packages)")
