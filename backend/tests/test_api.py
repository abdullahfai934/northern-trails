"""End-to-end API behaviour, with no database and no network."""
import pytest

from app.payments.mock import sign


def test_health_reports_every_subsystem(client):
    f = client.get("/api/health").json()["features"]
    for key in ("database", "weather", "hazards", "roads", "routing",
                "auth", "push", "payments"):
        assert key in f, f"/api/health should report {key}"


def test_bootstrap_returns_everything_the_spa_needs(client):
    d = client.get("/api/bootstrap").json()
    for key in ("packages", "operators", "routes", "alerts", "weather",
                "services", "cities", "suggestions"):
        assert d[key], f"{key} should not be empty"


def test_every_package_carries_its_operator(client):
    """The SPA dereferences pkg.operator.name; a missing join blanked the
    whole site once."""
    for p in client.get("/api/bootstrap").json()["packages"]:
        assert p.get("operator", {}).get("name")


# ------------------------------------------------------------ region guard
@pytest.mark.parametrize("pickup,dropoff", [
    ("Lahore", "Skardu"),
    ("Skardu", "Karachi"),
    ("Islamabad", "Gilgit"),
])
def test_trips_outside_the_north_are_refused(client, pickup, dropoff):
    r = client.get("/api/trips/quote", params={
        "service": "jeep", "pickup": pickup, "dropoff": dropoff})
    assert r.status_code == 400
    assert "Gilgit-Baltistan" in r.json()["detail"]


def test_same_pickup_and_dropoff_is_refused(client):
    r = client.get("/api/trips/quote", params={
        "service": "jeep", "pickup": "Gilgit", "dropoff": "Gilgit"})
    assert r.status_code == 400


def test_sources_endpoint_precedes_the_route_id_parameter(client):
    """/api/conditions/sources must not be swallowed by
    /api/conditions/{route_id}."""
    r = client.get("/api/conditions/sources")
    assert r.status_code == 200
    assert "sources" in r.json() and "coverage" in r.json()


def test_unknown_route_id_is_a_404(client):
    assert client.get("/api/conditions/not-a-real-route").status_code == 404


# --------------------------------------------------------- booking + pay
def _book(client, package_id="pkg-fairy-meadows-3", travelers=2):
    r = client.post("/api/bookings", json={
        "package_id": package_id, "traveler_name": "Test", "travelers": travelers})
    assert r.status_code == 200
    return r.json()


def test_booking_starts_unpaid_and_prices_per_traveller(client):
    b = _book(client, travelers=2)
    assert b["status"] == "pending_payment"
    assert b["travelers"] == 2
    one = _book(client, travelers=1)
    assert b["total_pkr"] == one["total_pkr"] * 2


def test_booking_an_unknown_package_is_a_404(client):
    assert client.post("/api/bookings", json={
        "package_id": "pkg-does-not-exist", "traveler_name": "Test User"}).status_code == 404


def test_payment_confirms_only_with_a_valid_signature(client):
    b = _book(client)
    co = client.post("/api/payments/start", json={"booking_id": b["booking_id"]}).json()

    fields = dict(co["fields"])
    fields.update({"code": "000", "message": "Approved"})
    fields.pop("signature", None)
    fields["signature"] = sign(fields)

    r = client.post("/api/payments/callback?provider=mock", data=fields)
    assert r.json()["paid"] and r.json()["verified"]
    assert client.get(f"/api/bookings/{b['booking_id']}").json()["status"] == "confirmed"


def test_forged_callback_never_confirms_a_booking(client):
    """The attack: POST a success callback without a valid signature."""
    b = _book(client)
    co = client.post("/api/payments/start", json={"booking_id": b["booking_id"]}).json()

    forged = dict(co["fields"])
    forged.update({"code": "000", "message": "Approved", "signature": "deadbeef"})

    r = client.post("/api/payments/callback?provider=mock", data=forged).json()
    assert not r["paid"] and not r["verified"]
    assert client.get(f"/api/bookings/{b['booking_id']}").json()["status"] == "payment_failed"


def test_a_confirmed_booking_cannot_be_paid_twice(client):
    b = _book(client)
    co = client.post("/api/payments/start", json={"booking_id": b["booking_id"]}).json()
    fields = dict(co["fields"])
    fields.update({"code": "000", "message": "Approved"})
    fields.pop("signature", None)
    fields["signature"] = sign(fields)
    client.post("/api/payments/callback?provider=mock", data=fields)

    again = client.post("/api/payments/start", json={"booking_id": b["booking_id"]})
    assert again.status_code == 409


def test_payment_for_an_unknown_booking_is_refused(client):
    assert client.post("/api/payments/start",
                       json={"booking_id": "NT-NOPE-000000"}).status_code == 404


# --------------------------------------------------------------- assistant
def test_assistant_refuses_an_empty_question(client):
    assert client.post("/api/assistant/chat", json={"message": "  "}).status_code == 400


def test_assistant_answers_with_citations(client):
    r = client.post("/api/assistant/chat",
                    json={"message": "Is the road to Skardu open?"}).json()
    assert r["answer"].strip()
    assert r["citations"], "a grounded answer must cite the records it used"
