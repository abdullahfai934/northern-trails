"""Geography and hazard-to-route attribution."""
import pytest

from app import data, geo


def test_every_tracked_route_has_coordinates():
    missing = {r["id"] for r in data.ROUTES} - set(geo.ROUTE_ENDPOINTS)
    assert not missing, f"routes without coordinates: {missing}"


def test_every_weather_city_and_operator_base_has_coordinates():
    assert all(w["city"] in geo.CITY_COORDS for w in data.WEATHER)
    assert all(o["base"] in geo.CITY_COORDS for o in data.OPERATORS)
    assert all(c in geo.CITY_COORDS for c in data.CITIES)


def test_haversine_matches_known_distance():
    # Gilgit -> Skardu is ~138 km straight line (road is far longer).
    km = geo.haversine_km((35.9208, 74.3144), (35.2971, 75.6333))
    assert 130 < km < 145


@pytest.mark.parametrize("lat,lon,expected", [
    (36.33, 74.62, "kkh-gilgit-hunza"),      # Hassanabad / Shishper
    (35.2971, 75.6333, "skardu-road"),        # Skardu town
])
def test_local_hazard_attaches_to_the_right_road(lat, lon, expected):
    assert expected in geo.nearest_routes(lat, lon, limit=2)


@pytest.mark.parametrize("lat,lon,place", [
    (17.1053, 98.9954, "Thailand"),
    (23.84, 76.23, "central India"),
    (34.0, 77.5, "Ladakh, edge of the bounding box"),
])
def test_distant_events_attach_to_no_route(lat, lon, place):
    """Regression: a flood in Thailand was once pinned to a Deosai road.

    `nearest_routes` returned the closest route regardless of distance, so
    any event anywhere got attributed to a Karakoram highway. The fix was a
    max_km ceiling.
    """
    assert geo.nearest_routes(lat, lon, limit=2) == [], f"{place} should not map to a route"


def test_region_box_covers_gilgit_baltistan_and_chitral():
    assert geo.in_region(35.9208, 74.3144)    # Gilgit
    assert geo.in_region(35.8511, 71.7864)    # Chitral
    assert geo.in_region(36.8508, 75.4269)    # Khunjerab
    assert not geo.in_region(31.5204, 74.3587)  # Lahore
    assert not geo.in_region(24.8607, 67.0011)  # Karachi
