"""Travel Condition Score and trip planner.

The score is the part of the system most likely to be challenged — "how did
you calculate this?" — so these tests pin the published behaviour: the weights
sum to one, each component responds to the input it claims to read, nothing is
counted twice, and the documented overrides actually fire.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import data, planner
from app.main import app

client = TestClient(app)


def iso(dt):
    return dt.replace(microsecond=0).isoformat()


def ago(hours):
    return iso(datetime.now(timezone.utc) - timedelta(hours=hours))


def route(**kw):
    base = {"id": "r1", "name": "Test segment", "status": "open", "status_note": "Clear.",
            "source": "NHA", "source_url": "", "updated_at": ago(1),
            "permits": [], "hazards": [], "drive_hours": 3, "distance_km": 100}
    base.update(kw)
    return base


def dest(**kw):
    base = {"id": "d1", "name": "Testville", "valley": "Test", "weather_city": "Testville",
            "routes": ["r1"], "elevation_m": 2400, "interests": ["Mountains"],
            "best_months": [6, 7, 8], "daily_cost_pkr": 10000,
            "drive_hours_from": {"Islamabad": 12.0}, "attractions": [], "blurb": ""}
    base.update(kw)
    return base


def wx(**kw):
    base = {"city": "Testville", "temp_c": 18, "condition": "Clear sky", "wind_kmh": 5,
            "visibility_km": 20, "humidity": 30, "forecast": [["Mon", 18, 6, "sun"]]}
    base.update(kw)
    return base


# ----------------------------------------------------------------- weights
def test_weights_are_the_published_ones_and_sum_to_one():
    assert planner.WEIGHTS == {"weather": 0.30, "road_status": 0.30,
                               "incidents": 0.20, "accessibility": 0.20}
    assert sum(planner.WEIGHTS.values()) == pytest.approx(1.0)


def test_bands_partition_the_whole_range():
    assert planner.band_for(0) == "LOW CONCERN"
    assert planner.band_for(24.9) == "LOW CONCERN"
    assert planner.band_for(25) == "MODERATE CONCERN"
    assert planner.band_for(49.9) == "MODERATE CONCERN"
    assert planner.band_for(50) == "HIGH CONCERN"
    assert planner.band_for(74.9) == "HIGH CONCERN"
    assert planner.band_for(75) == "SEVERE CONCERN"
    assert planner.band_for(100) == "SEVERE CONCERN"


# ----------------------------------------------------------------- weather
def test_clear_weather_scores_zero_concern():
    assert planner.score_weather(dest(), [wx()])["score"] == 0


def test_snow_scores_higher_than_rain_which_scores_higher_than_cloud():
    d = dest()
    snow = planner.score_weather(d, [wx(condition="Snow")])["score"]
    rain = planner.score_weather(d, [wx(condition="Light rain")])["score"]
    cloud = planner.score_weather(d, [wx(condition="Partly cloudy")])["score"]
    assert snow > rain > cloud > 0


def test_poor_visibility_and_high_wind_both_add_concern():
    d = dest()
    base = planner.score_weather(d, [wx()])["score"]
    assert planner.score_weather(d, [wx(visibility_km=1)])["score"] > base
    assert planner.score_weather(d, [wx(wind_kmh=60)])["score"] > base


def test_sub_zero_forecast_lows_add_ice_concern():
    d = dest()
    mild = planner.score_weather(d, [wx(forecast=[["Mon", 12, 4, "sun"]])])["score"]
    freezing = planner.score_weather(d, [wx(forecast=[["Mon", 4, -3, "sun"]])])["score"]
    assert freezing > mild


def test_altitude_amplifies_bad_weather_but_cannot_invent_it():
    low, high = dest(elevation_m=2000), dest(elevation_m=4500)
    bad = wx(condition="Snow")
    assert planner.score_weather(high, [bad])["score"] > planner.score_weather(low, [bad])["score"]
    # Clear weather at altitude is still clear weather.
    assert planner.score_weather(high, [wx()])["score"] == 0


def test_missing_station_is_scored_as_unknown_not_as_clear():
    out = planner.score_weather(dest(), [])
    assert out["unknown"] is True
    assert out["score"] > 0


# ------------------------------------------------------------- road status
def test_road_status_maps_to_the_published_concern_values():
    for status, expected in planner.ROAD_STATUS_CONCERN.items():
        assert planner.score_road_status([route(status=status)])["score"] == expected


def test_worst_segment_governs_rather_than_the_average():
    out = planner.score_road_status([
        route(id="a", status="open"),
        route(id="b", status="closed"),
    ])
    assert out["score"] == 100, "a corridor is only as passable as its worst segment"


def test_stale_advisory_cannot_report_a_clear_road():
    fresh = planner.score_road_status([route(status="open", updated_at=ago(1))])
    stale = planner.score_road_status([route(status="open", updated_at=ago(48))])
    assert fresh["score"] == 0
    assert stale["score"] == 30
    assert any("unconfirmed" in n for n in stale["notes"])


def test_staleness_never_improves_a_bad_road():
    assert planner.score_road_status([route(status="closed", updated_at=ago(96))])["score"] == 100


# --------------------------------------------------------------- incidents
def alert(**kw):
    base = {"id": "a1", "title": "Landslide at km 12", "kind": "Landslide",
            "severity": "high", "routes": ["r1"], "source": "NHA", "issued_at": ago(2)}
    base.update(kw)
    return base


def test_no_incidents_scores_zero():
    assert planner.score_incidents([route()], [])["score"] == 0


def test_severity_orders_the_score():
    r = [route()]
    high = planner.score_incidents(r, [alert(severity="high")])["score"]
    med = planner.score_incidents(r, [alert(severity="medium")])["score"]
    low = planner.score_incidents(r, [alert(severity="low")])["score"]
    assert high > med > low > 0


def test_older_incidents_count_for_less_and_expire_entirely():
    r = [route()]
    recent = planner.score_incidents(r, [alert(issued_at=ago(1))])["score"]
    old = planner.score_incidents(r, [alert(issued_at=ago(60))])["score"]
    expired = planner.score_incidents(r, [alert(issued_at=ago(planner.INCIDENT_WINDOW_H + 1))])
    assert recent > old > 0
    assert expired["score"] == 0


def test_incidents_on_other_routes_are_ignored():
    out = planner.score_incidents([route(id="r1")], [alert(routes=["somewhere-else"])])
    assert out["score"] == 0


def test_concurrent_incidents_compound_without_exceeding_the_scale():
    out = planner.score_incidents([route()], [
        alert(id="a1", severity="high"),
        alert(id="a2", severity="high"),
        alert(id="a3", severity="high"),
    ])
    assert 0 < out["score"] <= 100


def test_closure_and_weather_alerts_are_not_counted_twice():
    """Road status and weather already score these; incidents must not re-add them."""
    r = [route(status="closed")]
    out = planner.score_incidents(r, [
        alert(id="c1", kind="Road closure", severity="high"),
        alert(id="w1", kind="Weather advisory", severity="medium"),
    ])
    assert out["score"] == 0
    counted = {x["counted_under"] for x in out["also_reported"]}
    assert counted == {"road_status", "weather"}
    # They are still reported, just not scored here.
    assert len(out["also_reported"]) == 2


# ----------------------------------------------------------- accessibility
def test_permits_hazards_and_altitude_each_add_concern():
    base = planner.score_accessibility(dest(), [route()], "Islamabad", 7)["score"]
    assert planner.score_accessibility(
        dest(), [route(permits=["Park fee"])], "Islamabad", 7)["score"] > base
    assert planner.score_accessibility(
        dest(), [route(hazards=["Rockfall"])], "Islamabad", 7)["score"] > base
    assert planner.score_accessibility(
        dest(elevation_m=4500), [route()], "Islamabad", 7)["score"] > base


def test_out_of_season_month_adds_concern():
    d = dest(best_months=[6, 7, 8])
    in_season = planner.score_accessibility(d, [route()], "Islamabad", 7)["score"]
    out_season = planner.score_accessibility(d, [route()], "Islamabad", 1)["score"]
    assert out_season > in_season


def test_longer_drives_add_concern():
    d = dest(drive_hours_from={"Near": 4.0, "Far": 22.0})
    near = planner.score_accessibility(d, [route()], "Near", 7)["score"]
    far = planner.score_accessibility(d, [route()], "Far", 7)["score"]
    assert far > near


# ------------------------------------------------------------- composite
def test_composite_is_the_weighted_sum_of_its_components():
    out = planner.travel_condition(dest(), start_city="Islamabad", month=7,
                                   routes=[route(status="caution")],
                                   alerts=[], weather=[wx()])
    expected = sum(c["score"] * c["weight"] for c in out["components"].values())
    assert out["score"] == pytest.approx(round(expected, 1))
    assert out["components"].keys() == planner.WEIGHTS.keys()


def test_every_component_shows_the_records_behind_it():
    out = planner.travel_condition(dest(), start_city="Islamabad", month=7,
                                   routes=[route()], alerts=[alert()], weather=[wx()])
    for name, comp in out["components"].items():
        assert "notes" in comp and comp["notes"], f"{name} explains nothing"
        assert "sources" in comp, f"{name} cites nothing"


def test_a_closed_road_is_never_reported_below_high_concern():
    """The documented override: good weather must not average out a closure."""
    out = planner.travel_condition(dest(), start_city="Islamabad", month=7,
                                   routes=[route(status="closed")],
                                   alerts=[], weather=[wx()])
    assert out["blocked"] is True
    assert out["band"] == "HIGH CONCERN"
    # The arithmetic itself stays honest — only the band is floored.
    assert out["score"] < 50


def test_perfect_conditions_are_low_concern():
    out = planner.travel_condition(dest(elevation_m=2000, best_months=list(range(1, 13))),
                                   start_city="Islamabad", month=7,
                                   routes=[route(status="open")], alerts=[], weather=[wx()])
    assert out["band"] == "LOW CONCERN"
    assert out["blocked"] is False


# ----------------------------------------------------------------- planner
def test_plan_returns_every_destination_with_reasons_both_ways():
    out = planner.plan(start_city="Islamabad", budget_pkr=150000, days=5, people=2,
                       interests=["Mountains"], travel_date="2026-07-15")
    assert len(out["results"]) == len(data.DESTINATIONS)
    for r in out["results"]:
        assert "travel_condition" in r
        assert isinstance(r["fit"]["fits"], list)
        assert isinstance(r["fit"]["against"], list)
        # every destination is explained one way or the other
        assert r["fit"]["fits"] or r["fit"]["against"]


def test_plan_can_be_narrowed_to_one_destination():
    out = planner.plan(destination="Hunza", days=5, people=2)
    assert [r["destination"]["name"] for r in out["results"]] == ["Hunza"]


def test_blocked_destinations_rank_last():
    out = planner.plan(start_city="Islamabad", budget_pkr=200000, days=5, people=2,
                       interests=["Mountains"], travel_date="2026-07-15")
    blocked = [i for i, r in enumerate(out["results"]) if r["travel_condition"]["blocked"]]
    if blocked:
        assert min(blocked) == len(out["results"]) - len(blocked), \
            "a destination behind a closed road must not outrank a reachable one"


def test_budget_verdict_matches_the_estimate():
    out = planner.plan(budget_pkr=1000, days=5, people=4)
    for r in out["results"]:
        assert r["fit"]["within_budget"] is False
        assert any("Over budget" in a for a in r["fit"]["against"])


def test_out_of_season_destination_says_so():
    # Deosai's season is Jun-Sep; January must be flagged against it.
    out = planner.plan(destination="Deosai", travel_date="2026-01-10", days=4, people=2)
    against = out["results"][0]["fit"]["against"]
    assert any("out of season" in a for a in against)


# --------------------------------------------------------------- endpoints
def test_plan_endpoint_returns_results_and_methodology():
    res = client.post("/api/plan", json={
        "start_city": "Islamabad", "budget_pkr": 150000, "days": 5,
        "people": 4, "interests": ["Mountains"], "travel_date": "2026-07-15",
    })
    assert res.status_code == 200
    body = res.json()
    assert body["results"]
    assert body["methodology"]["weights"] == planner.WEIGHTS


def test_methodology_endpoint_documents_weights_bands_and_limits():
    body = client.get("/api/plan/methodology").json()
    assert body["weights"] == planner.WEIGHTS
    assert len(body["bands"]) == len(planner.BANDS)
    assert set(body["components"]) == set(planner.WEIGHTS)
    assert body["overrides"] and body["limits"]


def test_destinations_endpoints():
    items = client.get("/api/destinations").json()["items"]
    assert len(items) == len(data.DESTINATIONS)
    assert all("travel_condition" in d for d in items)

    one = client.get(f"/api/destinations/{items[0]['id']}")
    assert one.status_code == 200
    assert "routes" in one.json() and "packages" in one.json()

    assert client.get("/api/destinations/nope").status_code == 404


def test_bootstrap_carries_destinations():
    assert client.get("/api/bootstrap").json()["destinations"]
