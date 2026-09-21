"""Operator console API.

The console is the operator-facing half of the marketplace, so these
guard two things: that a caller must be a real operator, and that an
operator only ever sees work actually offered to them.
"""
import pytest


def test_operator_list_is_public(client):
    d = client.get("/api/operators").json()
    assert d["items"] and all(o.get("verified") is not None for o in d["items"])


@pytest.mark.parametrize("path", [
    "/api/operators/not-a-real-operator/jobs",
    "/api/operators/not-a-real-operator",
])
def test_unknown_operator_is_a_404(client, path):
    """Regression: any string used to return a job list."""
    r = client.get(path)
    assert r.status_code == 404
    assert "No verified operator" in r.json()["detail"]


def test_unknown_operator_cannot_set_availability(client):
    """Regression: a phantom id could write into the dispatcher's state."""
    r = client.post("/api/operators/ghost-operator/availability",
                    json={"available": True})
    assert r.status_code == 404


def test_operator_jobs_payload_shape(client):
    j = client.get("/api/operators/op-karakoram/jobs").json()
    for key in ("operator_id", "operator", "available", "open",
                "awaiting", "active", "stats", "response_window_sec"):
        assert key in j, f"jobs payload should include {key}"
    for key in ("offered", "bids", "won", "completed", "earnings_pkr", "win_rate"):
        assert key in j["stats"]


def test_availability_round_trips(client):
    off = client.post("/api/operators/op-karakoram/availability",
                      json={"available": False}).json()
    assert off["available"] is False
    assert client.get("/api/operators/op-karakoram/jobs").json()["available"] is False

    client.post("/api/operators/op-karakoram/availability", json={"available": True})
    assert client.get("/api/operators/op-karakoram/jobs").json()["available"] is True


def test_operator_detail_includes_verification_and_packages(client):
    d = client.get("/api/operators/op-karakoram").json()
    assert d["verification"]["tourism_dept_reg"]
    assert isinstance(d["packages"], list)


def test_a_job_is_only_offered_to_nearby_operators(client):
    """A Hunza pickup must not appear in a Chitral operator's queue."""
    client.post("/api/trips/request", json={
        "traveler_id": "trv-scope-test", "service": "jeep",
        "pickup": "Karimabad (Hunza)", "dropoff": "Passu", "passengers": 2})

    far = client.get("/api/operators/op-chitral/jobs").json()
    assert far["open"] == [], "a Chitral operator should not see a Hunza job"
