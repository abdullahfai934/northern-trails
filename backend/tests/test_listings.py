"""Photos, restaurants, package admin, booking validation and the assistant's
use of them. Everything external is served by an httpx MockTransport."""
import asyncio
from datetime import date, timedelta

import httpx
import pytest

from app import admin, assistant, data, photos, places

ADMIN = {"X-Admin-Token": "test-admin-token"}


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ photos
def _commons_payload():
    def page(i, title, w, h, mime="image/jpeg"):
        return {"pageid": i, "index": i, "title": title, "imageinfo": [{
            "url": f"https://upload.example/{i}.jpg", "width": w, "height": h, "mime": mime,
            "thumburl": f"https://upload.example/thumb/{i}.jpg/1280px-{i}.jpg",
            "thumbwidth": 1280, "thumbheight": 800,
            "descriptionurl": f"https://commons.example/File:{i}",
            "extmetadata": {"Artist": {"value": "<a href='x'>Jane Doe</a>"},
                            "LicenseShortName": {"value": "CC BY-SA 4.0"}},
        }]}
    return {"query": {"pages": [
        page(1, "File:Hunza Valley.jpg", 4000, 2600),
        page(2, "File:Hunza map.jpg", 4000, 2600),         # a map, rejected
        page(3, "File:Hunza portrait.jpg", 2000, 3000),    # portrait, rejected
        page(4, "File:Tiny.jpg", 600, 400),                # too small, rejected
        page(5, "File:Hunza diagram.svg", 4000, 2600, "image/svg+xml"),
        page(6, "File:Attabad Lake.jpg", 3000, 2000),
    ]}}


def test_photos_filter_to_credited_landscape_images():
    photos._cache.clear()
    seen = []

    def handler(req):
        seen.append(req.url.host)
        return httpx.Response(200, json=_commons_payload())

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await photos.search("Hunza Valley", 6, client=c)

    r = run(go())
    assert r["source"] == "wikimedia"
    assert [i["id"] for i in r["items"]] == ["wm-1", "wm-6"]
    first = r["items"][0]
    assert first["credit"] == "Jane Doe"            # HTML stripped
    assert first["license"] == "CC BY-SA 4.0"
    assert "/960px-" in first["thumb"]
    assert seen[0] == "commons.wikimedia.org"


def test_photos_fall_back_to_the_second_wikimedia_host():
    photos._cache.clear()

    def handler(req):
        if req.url.host == "commons.wikimedia.org":
            raise httpx.ConnectTimeout("blocked")
        return httpx.Response(200, json=_commons_payload())

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await photos.search("Skardu", 2, client=c)

    assert len(run(go())["items"]) == 2


def test_photos_return_empty_not_error_when_all_sources_fail():
    photos._cache.clear()

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda req: httpx.Response(500))) as c:
            return await photos.search("Nowhere", 3, client=c)

    r = run(go())
    assert r["items"] == [] and r["source"] == "none"


def test_photo_endpoint_validates_query(client):
    assert client.get("/api/photos?q=a").status_code == 422
    r = client.get("/api/photos?q=Hunza")
    assert r.status_code == 200 and r.json()["items"] == []   # lookups off in tests


# ------------------------------------------------------------- restaurants
def _overpass_payload(n=3):
    els = [{"type": "node", "id": i, "lat": 36.3167 + i * 0.001, "lon": 74.6589,
            "tags": {"amenity": "restaurant", "name": f"Place {i}", "cuisine": "pakistani;bbq"}}
           for i in range(n, 0, -1)]
    els.append({"type": "node", "id": 99, "lat": 36.3, "lon": 74.6, "tags": {"amenity": "cafe"}})
    els.append({"type": "way", "id": 7, "center": {"lat": 36.318, "lon": 74.66},
                "tags": {"amenity": "cafe", "name": "Way Café"}})
    return {"elements": els}


def test_restaurants_sorted_by_distance_with_directions():
    places._cache.clear()

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda req: httpx.Response(200, json=_overpass_payload()))) as c:
            return await places.nearby("Hunza", client=c)

    r = run(go())
    assert r["ok"] and r["source"] == "openstreetmap" and r["radius_m"] == places.RADII[0]
    names = [i["name"] for i in r["items"]]
    assert "Place 1" == names[0] and "Way Café" in names
    assert all(i["name"] for i in r["items"])                 # unnamed node dropped
    assert r["items"][0]["cuisine"] == "Pakistani, Bbq"
    d = [i["distance_km"] for i in r["items"]]
    assert d == sorted(d)
    assert r["items"][0]["directions_url"].startswith("https://www.google.com/maps/dir/?api=1&destination=")


def test_restaurants_widen_radius_then_report_none():
    places._cache.clear()
    radii = []

    def handler(req):
        body = req.content.decode()
        radii.append(next(r for r in places.RADII if f"around%3A{r}%2C" in body or f"around:{r}," in body))
        return httpx.Response(200, json={"elements": []})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await places.nearby("Deosai", client=c)

    r = run(go())
    assert radii == list(places.RADII)
    assert r["ok"] and r["items"] == [] and "no restaurants" in r["note"]


def test_restaurants_retry_on_rate_limit(monkeypatch):
    places._cache.clear()
    calls = []

    async def no_sleep(_):
        return None
    monkeypatch.setattr(places.asyncio, "sleep", no_sleep)

    def handler(req):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429)
        return httpx.Response(200, json=_overpass_payload(1))

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await places.nearby("Chitral", client=c)

    r = run(go())
    assert len(calls) == 2 and r["ok"] and r["items"]


def test_restaurants_unknown_destination_is_404(client):
    assert client.get("/api/places/restaurants?destination=Atlantis").status_code == 404
    assert client.get("/api/places/restaurants?destination=Hunza").status_code == 200


# ------------------------------------------------------------------- admin
def _pkg_body(**over):
    body = {
        "title": "Hunza Autumn Colours", "destination": "Hunza", "operator_id": "op-hunza-guides",
        "pickup": "Gilgit", "price_pkr": 45000, "days": 2,
        "highlight": "Poplars turning gold along the KKH",
        "itinerary": [{"title": "Gilgit → Karimabad", "body": "Drive up the KKH."},
                      {"title": "Altit & back", "body": ""}],
        "includes": ["Transport", "Transport", " Guide "], "excludes": ["Flights"],
        "operator_url": "https://example.com/hunza-autumn",
        "whatsapp": "0300-1234567",
        "images": ["https://images.example.com/a.jpg"],
    }
    body.update(over)
    return body


def test_admin_requires_token(client):
    assert client.post("/api/admin/packages", json=_pkg_body()).status_code == 401
    assert client.post("/api/admin/packages", json=_pkg_body(),
                       headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/api/admin/status").json()["enabled"] is True


def test_admin_verify_reports_match_without_erroring(client):
    assert client.post("/api/admin/verify", headers={"X-Admin-Token": "nope"}).json()["ok"] is False
    assert client.post("/api/admin/verify", headers=ADMIN).json()["ok"] is True


def test_admin_disabled_without_token(client, monkeypatch):
    monkeypatch.setattr(admin.config, "ADMIN_TOKEN", "")
    assert client.post("/api/admin/verify", headers=ADMIN).status_code == 503


def test_admin_creates_lists_and_deletes_a_package(client):
    before = len(data.PACKAGES)
    r = client.post("/api/admin/packages", json=_pkg_body(), headers=ADMIN)
    assert r.status_code == 201, r.text
    pkg = r.json()["package"]
    assert r.json()["persisted"] is False                 # no database in tests
    assert pkg["whatsapp"] == "923001234567"
    assert pkg["includes"] == ["Transport", "Guide"]
    assert pkg["itinerary"][1][0] == "Day 2"
    assert pkg["routes"] == data.destination_by_name("Hunza")["routes"]
    assert pkg["rating"] == 0 and pkg["reviews"] == 0
    assert pkg["source"] == "admin"

    listed = client.get("/api/packages").json()["items"]
    assert any(p["id"] == pkg["id"] for p in listed)
    assert client.get(f"/api/packages/{pkg['id']}").json()["destination_info"]["name"] == "Hunza"

    # A booking against it works like any other package.
    b = client.post("/api/bookings", json={"package_id": pkg["id"], "traveler_name": "Ayesha Khan",
                                           "phone": "+92 300 1234567", "travelers": 2})
    assert b.status_code == 200 and b.json()["total_pkr"] == 90000

    assert client.delete(f"/api/admin/packages/{pkg['id']}", headers=ADMIN).status_code == 200
    assert len(data.PACKAGES) == before


def test_admin_edits_but_cannot_delete_seed_package(client):
    seed = data.package_index()["pkg-hunza-short-3"]
    original = dict(seed)
    try:
        r = client.put("/api/admin/packages/pkg-hunza-short-3",
                       json=_pkg_body(title="Hunza Weekender (updated)", days=3,
                                      itinerary=[{"title": f"Day {i}"} for i in range(3)]),
                       headers=ADMIN)
        assert r.status_code == 200
        assert r.json()["package"]["title"] == "Hunza Weekender (updated)"
        assert r.json()["package"]["rating"] == original["rating"]   # traveler score kept
        assert client.delete("/api/admin/packages/pkg-hunza-short-3", headers=ADMIN).status_code == 403
    finally:
        admin._put(original)


@pytest.mark.parametrize("over, field", [
    ({"title": "ab"}, "title"),
    ({"destination": "Atlantis"}, "destination"),
    ({"operator_id": "op-nobody"}, "operator_id"),
    ({"price_pkr": 10}, "price_pkr"),
    ({"days": 0}, "days"),
    ({"itinerary": []}, "itinerary"),
    ({"operator_url": "not a url"}, "operator_url"),
    ({"whatsapp": "123"}, "whatsapp"),
    ({"images": ["javascript:alert(1)"]}, "images"),
])
def test_admin_rejects_invalid_package(client, over, field):
    r = client.post("/api/admin/packages", json=_pkg_body(**over), headers=ADMIN)
    assert r.status_code == 422
    assert any(field in err["loc"] for err in r.json()["detail"])


def test_admin_image_upload_checks_bytes(client):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    r = client.post("/api/admin/images", headers=ADMIN,
                    files={"file": ("x.png", png, "image/png")})
    assert r.status_code == 201
    url = r.json()["url"]
    got = client.get(url)
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert got.content == png

    fake = client.post("/api/admin/images", headers=ADMIN,
                       files={"file": ("x.jpg", b"<script>", "image/jpeg")})
    assert fake.status_code == 415
    assert client.get("/api/images/not-an-id").status_code == 404


# -------------------------------------------------------- booking validation
@pytest.mark.parametrize("over", [
    {"traveler_name": " "},
    {"email": "nope"},
    {"phone": "abc"},
    {"start_date": (date.today() - timedelta(days=1)).isoformat()},
    {"start_date": "31/12/2026"},
    {"travelers": 0},
])
def test_booking_rejects_invalid_input(client, over):
    body = {"package_id": "pkg-hunza-short-3", "traveler_name": "Ali Raza", **over}
    assert client.post("/api/bookings", json=body).status_code == 422


def test_booking_accepts_valid_input(client):
    r = client.post("/api/bookings", json={
        "package_id": "pkg-hunza-short-3", "traveler_name": "Ali Raza",
        "email": "ali@example.com", "phone": "+92 300 1234567",
        "start_date": (date.today() + timedelta(days=30)).isoformat(), "travelers": 3})
    assert r.status_code == 200 and r.json()["travelers"] == 3


# ---------------------------------------------------------------- assistant
@pytest.fixture
def offline_assistant(monkeypatch):
    monkeypatch.setattr(assistant, "GEMINI_KEY", "")


def test_assistant_says_uncovered_place_is_not_covered(offline_assistant):
    r = run(assistant.answer("Is the road to Naran open?"))
    assert "Naran" in r["answer"] and "covers Gilgit-Baltistan and Chitral only" in r["answer"]
    # No substitute road is presented as if it were the Naran road.
    assert not any(c["kind"] == "road" for c in r["citations"])


def test_assistant_suggests_reachable_alternatives_for_a_closed_road(offline_assistant):
    r = run(assistant.answer("Can I still cross Shandur Pass to Chitral?"))
    assert "closed" in r["answer"].lower()
    assert "Consider instead" in r["answer"]
    alts = [c for c in r["citations"] if c["id"].startswith("alt-")]
    assert alts and "alt-dest-chitral" not in {c["id"] for c in alts}
    # Every package it names is a real catalogue entry at its real price.
    for p in data.PACKAGES:
        if p["title"] in r["answer"]:
            assert f"PKR {p['price_pkr']:,}" in r["answer"]


def test_assistant_never_prices_a_package_that_does_not_exist(offline_assistant):
    r = run(assistant.answer("Any cheap package to Chitral under 20k?"))
    assert "Nothing in the catalogue comes in under PKR 20,000" in r["answer"]


def test_assistant_lists_restaurants_for_named_destination(offline_assistant, monkeypatch):
    async def fake_nearby(dest, *a, **k):
        return {"ok": True, "destination": dest, "source": "openstreetmap", "radius_m": 2500,
                "items": [{"id": "osm-node-1", "name": "Café de Hunza", "cuisine": "Regional",
                           "distance_km": 0.4, "source": "openstreetmap", "address": "",
                           "opening_hours": ""}]}
    monkeypatch.setattr(places, "nearby", fake_nearby)
    r = run(assistant.answer("Where can I eat near Karimabad in Hunza?"))
    assert "Café de Hunza" in r["answer"] and "0.4 km" in r["answer"]
    assert any(c["kind"] == "restaurant" for c in r["citations"])
    assert not any(c["kind"] == "road" for c in r["citations"])


def test_assistant_restaurant_failure_does_not_break_answer(offline_assistant, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("directory down")
    monkeypatch.setattr(places, "nearby", boom)
    r = run(assistant.answer("Where can I eat in Skardu?"))
    assert "could not be reached" in r["answer"]
