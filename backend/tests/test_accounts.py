"""Accounts, roles, reviews, the developer API, safety score, smart alerts,
the AI trip planner and the admin dashboard."""
import asyncio
from datetime import date, timedelta

import pytest

from app import alerts, data, devapi, profiles, safety, tripai
from app.db import records


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clean():
    """Each test starts with empty in-memory accounts data and pristine routes."""
    snapshot = [dict(r) for r in data.ROUTES]
    alerts_snapshot = list(data.ALERTS)
    for k in records._MEM:
        records._MEM[k].clear()
    from app.db import repo
    repo._MEM_BOOKINGS.clear()
    profiles._MEM.clear()
    profiles._CACHE.clear()
    yield
    data.ROUTES[:] = snapshot
    data.ALERTS[:] = alerts_snapshot


def backdate(booking_id, days_ago):
    """Simulate time passing: the API rightly refuses a start date in the past."""
    from app.db import repo
    repo._MEM_BOOKINGS[booking_id]["start_date"] = (date.today() - timedelta(days=days_ago)).isoformat()


def book(client, pkg="pkg-hunza-short-3", start=None, name="Sara Ali"):
    start = start or (date.today() + timedelta(days=10)).isoformat()
    r = client.post("/api/bookings", json={"package_id": pkg, "traveler_name": name,
                                           "phone": "+92 300 1234567", "start_date": start})
    assert r.status_code == 200, r.text
    return r.json()["booking_id"]


# ------------------------------------------------------------------ auth
def test_booking_requires_sign_in(client, as_user):
    as_user("guest")
    r = client.post("/api/bookings", json={"package_id": "pkg-hunza-short-3", "traveler_name": "Ali Raza"})
    assert r.status_code == 401


def test_booking_readable_only_by_owner_or_staff(client, as_user):
    as_user("tourist", uid="alice")
    bid = book(client)
    assert client.get(f"/api/bookings/{bid}").status_code == 200
    as_user("tourist", uid="mallory")
    assert client.get(f"/api/bookings/{bid}").status_code == 404
    as_user("admin")
    assert client.get(f"/api/bookings/{bid}").status_code == 200


def test_profile_and_wishlist(client, as_user):
    as_user("tourist", uid="u1")
    me = client.get("/api/me").json()
    assert me["role"] == "tourist" and me["uid"] == "u1"
    r = client.patch("/api/me", json={"name": "  Sara   Ali ", "emergency_contact": {"name": "Ahmed", "phone": "+92 321 7654321"}})
    assert r.status_code == 200
    assert client.patch("/api/me", json={"emergency_contact": {"phone": "abc"}}).status_code == 422
    r = client.put("/api/me/wishlist", json={"ids": ["pkg-hunza-short-3", "pkg-nope", "pkg-hunza-short-3"]})
    assert r.json()["ids"] == ["pkg-hunza-short-3"]


def test_my_bookings_are_scoped(client, as_user):
    as_user("tourist", uid="a")
    book(client)
    as_user("tourist", uid="b")
    assert client.get("/api/me/bookings").json()["items"] == []
    as_user("tourist", uid="a")
    assert len(client.get("/api/me/bookings").json()["items"]) == 1


def test_admin_email_needs_verification(monkeypatch):
    monkeypatch.setattr(profiles.config, "ADMIN_EMAILS", {"boss@example.com"})
    assert run(profiles.get_or_create("x1", email="boss@example.com", email_verified=False))["role"] == "tourist"
    profiles._CACHE.clear()
    assert run(profiles.get_or_create("x1", email="boss@example.com", email_verified=True))["role"] == "admin"


def test_roles_can_only_be_set_by_admin(client, as_user):
    as_user("tourist", uid="t1")
    client.get("/api/me")
    assert client.patch("/api/admin/users/t1", json={"role": "admin"}).status_code == 403
    as_user("admin", uid="boss")
    assert client.patch("/api/admin/users/t1", json={"role": "operator"}).status_code == 422
    r = client.patch("/api/admin/users/t1", json={"role": "operator", "operator_id": "op-baltistan"})
    assert r.status_code == 200 and r.json()["operator_id"] == "op-baltistan"
    assert client.patch("/api/admin/users/boss", json={"role": "tourist"}).status_code == 409


def test_operator_console_is_scoped(client, as_user):
    as_user("tourist")
    assert client.get("/api/operators/op-baltistan/jobs").status_code == 403
    as_user("operator", operator_id="op-karakoram")
    assert client.get("/api/operators/op-baltistan/jobs").status_code == 403
    assert client.get("/api/operators/op-karakoram/jobs").status_code == 200


# --------------------------------------------------------------- reviews
def test_review_lifecycle(client, as_user):
    as_user("tourist", uid="rev")
    bid = book(client)
    backdate(bid, 10)
    # Not reviewable while unpaid.
    assert client.post("/api/reviews", json={"booking_id": bid, "rating": 5}).status_code == 409
    as_user("admin")
    assert client.patch(f"/api/admin/bookings/{bid}", json={"status": "completed"}).status_code == 200
    as_user("tourist", uid="rev")
    assert client.get("/api/me/bookings").json()["items"][0]["can_review"] is True
    r = client.post("/api/reviews", json={"booking_id": bid, "rating": 1, "guide_rating": 2, "text": "Rough"})
    assert r.status_code == 201 and r.json()["status"] == "pending"
    assert client.post("/api/reviews", json={"booking_id": bid, "rating": 5}).status_code == 409
    assert client.get("/api/packages/pkg-hunza-short-3/reviews").json()["count"] == 0
    before = data.package_index()["pkg-hunza-short-3"]["reviews"]
    as_user("admin")
    rid = client.get("/api/admin/reviews?status=pending").json()["items"][0]["id"]
    assert client.patch(f"/api/admin/reviews/{rid}", json={"status": "approved"}).status_code == 200
    pub = client.get("/api/packages/pkg-hunza-short-3/reviews").json()
    assert pub["count"] == 1 and "uid" not in pub["items"][0]
    assert data.package_index()["pkg-hunza-short-3"]["reviews"] == before + 1
    # Rejecting it restores the rating the package had.
    client.patch(f"/api/admin/reviews/{rid}", json={"status": "rejected"})
    assert data.package_index()["pkg-hunza-short-3"]["reviews"] == before


def test_review_rejects_someone_elses_booking(client, as_user):
    as_user("tourist", uid="owner")
    bid = book(client)
    as_user("tourist", uid="other")
    assert client.post("/api/reviews", json={"booking_id": bid, "rating": 4}).status_code == 404


def test_review_photos_must_be_uploads(client, as_user):
    as_user("tourist", uid="p")
    r = client.post("/api/reviews", json={"booking_id": "x", "rating": 4, "photos": ["https://evil.example/x.jpg"]})
    assert r.status_code == 422


# ---------------------------------------------------------- developer API
def test_api_keys_for_operators_only(client, as_user):
    as_user("tourist")
    assert client.post("/api/developer/keys", json={"label": "x"}).status_code == 403
    as_user("operator", uid="op1", operator_id="op-karakoram")
    r = client.post("/api/developer/keys", json={"label": "Booking widget"})
    assert r.status_code == 201
    key = r.json()["key"]
    assert key.startswith("nt_") and "key" not in client.get("/api/developer/keys").json()["items"][0]
    got = client.get("/api/packages", headers={"X-API-Key": key})
    assert got.status_code == 200 and got.headers["X-RateLimit-Limit"] == str(devapi.LIMIT_KEY)
    assert client.get("/api/developer/keys").json()["items"][0]["requests"] == 1
    kid = r.json()["id"]
    assert client.delete(f"/api/developer/keys/{kid}").status_code == 200
    assert client.get("/api/packages", headers={"X-API-Key": key}).status_code == 401


def test_anonymous_rate_limit(client, monkeypatch):
    monkeypatch.setattr(devapi, "LIMIT_ANON", 3)
    codes = [client.get("/api/destinations").status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r = client.get("/api/destinations")
    assert r.headers["Retry-After"] and r.headers["X-RateLimit-Remaining"] == "0"


def test_conditions_for_destination(client):
    r = client.get("/api/conditions/dest-chitral").json()
    assert r["destination"]["name"] == "Chitral"
    assert {"weather", "earthquakes", "roads", "safety"} <= set(r)
    assert client.get("/api/conditions/Fairy%20Meadows").status_code == 200
    assert client.get("/api/conditions/skardu-road").json()["id"] == "skardu-road"   # route ids still work
    assert client.get("/api/conditions/atlantis").status_code == 404


def test_restaurants_by_point(client):
    assert client.get("/api/restaurants?lat=36.3&lng=74.6").status_code == 200
    assert client.get("/api/restaurants?lat=200&lng=74.6").status_code == 422


# --------------------------------------------------------------- safety
def test_safety_score_parts_and_bands():
    dest = data.destination_by_name("Fairy Meadows")
    s = safety.score(dest)
    assert 0 <= s["score"] <= 100
    assert set(s["parts"]) == {"road", "weather", "earthquakes", "altitude"}
    assert sum(p["max"] for p in s["parts"].values()) == 100
    assert s["color"] in ("green", "yellow", "red")


def test_closed_road_caps_safety():
    chitral = data.destination_by_name("Chitral")
    assert data.route_index()["shandur-chitral"]["status"] == "closed"
    assert safety.score(chitral)["score"] <= 45


def test_nearby_earthquake_lowers_safety():
    hunza = data.destination_by_name("Hunza")
    base = safety.score(hunza)["parts"]["earthquakes"]["points"]
    data.ALERTS.append({"id": "usgs-t1", "kind": "Earthquake", "severity": "high", "title": "M5.8 earthquake",
                        "magnitude": 5.8, "lat": hunza["lat"] + 0.2, "lon": hunza["lon"], "routes": [],
                        "issued_at": date.today().isoformat() + "T00:00:00+00:00"})
    assert base == 20 and safety.score(hunza)["parts"]["earthquakes"]["points"] == 0


def test_recommendations_rank_every_destination(client):
    items = client.get("/api/recommendations").json()["items"]
    assert len(items) == len(data.DESTINATIONS)
    assert items == sorted(items, key=lambda x: -x["rank"])


# ----------------------------------------------------------- smart alerts
def test_alert_for_closed_route_is_sent_once(client, as_user):
    as_user("tourist", uid="traveler")
    bid = book(client, pkg="pkg-chitral-kalash-6")
    first = run(alerts.check_once())
    assert first["new_alerts"] >= 1
    assert run(alerts.check_once())["new_alerts"] == 0          # de-duplicated
    notes = client.get("/api/me/notifications").json()
    assert notes["unread"] >= 1 and any("closed" in n["title"] for n in notes["items"])
    client.post("/api/me/notifications/read")
    assert client.get("/api/me/notifications").json()["unread"] == 0
    assert bid


def test_no_alerts_for_past_or_anonymous_trips(client, as_user):
    as_user("tourist", uid="old")
    backdate(book(client, pkg="pkg-chitral-kalash-6"), 60)
    assert run(alerts.check_once())["new_alerts"] == 0


# ---------------------------------------------------------- road status
def test_operator_updates_road_status(client, as_user):
    as_user("tourist")
    assert client.patch("/api/admin/routes/skardu-road", json={"status": "closed", "status_note": "Rockfall"}).status_code == 403
    as_user("operator", operator_id="op-baltistan")
    r = client.patch("/api/admin/routes/skardu-road", json={"status": "closed", "status_note": "Rockfall at Thowar"})
    assert r.status_code == 200
    row = data.route_index()["skardu-road"]
    assert row["status"] == "closed" and row["origin"] == "manual" and row["updated_by"]
    assert "Baltistan" in row["source"]


# ------------------------------------------------------------ AI planner
def test_ai_planner_offline_uses_only_real_records(client, as_user, monkeypatch):
    monkeypatch.setattr(tripai, "GEMINI_KEY", "")
    as_user("guest")
    assert client.post("/api/plan/ai", json={"days": 3}).status_code == 401
    as_user("tourist", uid="planner")
    r = client.post("/api/plan/ai", json={"days": 4, "budget_pkr": 150000, "people": 2,
                                          "interests": ["Lakes"], "start_city": "Islamabad"})
    assert r.status_code == 200, r.text
    plan = r.json()
    assert len(plan["days"]) == 4 and plan["engine"] == "grounded-offline"
    pidx = data.package_index()
    for p in plan["packages"]:
        assert pidx[p["id"]]["price_pkr"] == p["price_pkr"]
    assert plan["costs"]["total_pkr"] == plan["costs"]["packages_pkr"] + plan["costs"]["ground_pkr"]
    saved = client.post("/api/me/plans", json={"title": plan["title"], "brief": {"days": 4}, "plan": plan})
    assert saved.status_code == 201
    assert len(client.get("/api/me/plans").json()["items"]) == 1
    as_user("tourist", uid="someone-else")
    assert client.delete(f"/api/me/plans/{saved.json()['id']}").status_code == 404


def test_ai_planner_drops_invented_records(monkeypatch):
    async def fake_gemini(prompt):
        return {"title": "T", "summary": "S", "tips": [], "days": [
            {"day": 1, "title": "Arrive", "location": "Atlantis", "activities": ["x"],
             "package_id": "pkg-made-up", "restaurant": "Imaginary Grill"},
            {"day": 2, "title": "Lake", "location": "Hunza", "activities": ["Attabad"],
             "package_id": None, "restaurant": None}]}
    monkeypatch.setattr(tripai, "_gemini", fake_gemini)
    plan = run(tripai.build({"days": 2, "people": 1, "budget_pkr": 0, "interests": ["Lakes"],
                             "start_city": "Gilgit", "destination": "Hunza"}))
    assert plan["engine"] == "gemini"
    assert all(d["package_id"] is None and d["restaurant"] is None for d in plan["days"])
    assert all(d["location"] in {x["name"] for x in plan["destinations"]} for d in plan["days"])


# -------------------------------------------------------------- dashboard
def test_admin_stats(client, as_user):
    as_user("tourist", uid="s1")
    book(client)
    as_user("tourist", uid="s2")
    bid = book(client, pkg="pkg-skardu-deosai-4")
    as_user("admin")
    client.patch(f"/api/admin/bookings/{bid}", json={"status": "confirmed"})
    st = client.get("/api/admin/stats").json()
    assert st["totals"]["bookings"] == 2 and st["totals"]["confirmed"] == 1
    assert st["totals"]["active_users"] == 2
    assert st["totals"]["revenue_pkr"] == data.package_index()["pkg-skardu-deosai-4"]["price_pkr"] * 2
    assert {d["destination"] for d in st["popular_destinations"]} == {"Hunza", "Deosai"}
    as_user("tourist")
    assert client.get("/api/admin/stats").status_code == 403
