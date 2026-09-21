"""Live-conditions adapters: parsing, grading and graceful degradation."""
import asyncio

import pytest

from app.sources import gdacs, nha, openmeteo, pmd
from app.sources.base import Source, SourceResult

NHA_SAMPLE = """
<html><body><table>
<tr><th>Highway</th><th>Status</th><th>Remarks</th></tr>
<tr><td>N-35 Gilgit to Hunza</td><td>Open</td><td>Traffic flow normal via Karimabad.</td></tr>
<tr><td>Khunjerab Pass (Sost)</td><td>Restricted</td><td>Convoy timings 09:00-16:00, 4x4 only.</td></tr>
<tr><td>Skardu Road S-1 at Thowar</td><td>Caution</td><td>Rockfall diversion, single lane.</td></tr>
</table>
<ul><li>Shandur Pass at Langar is closed; causeway washed away.</li>
<li>Unrelated: M-2 Lahore-Islamabad open.</li></ul>
</body></html>
"""


# ------------------------------------------------------------------- NHA
def test_nha_parser_extracts_each_tracked_route():
    rows = {r["id"]: r for r in nha.parse(NHA_SAMPLE)}
    assert rows["kkh-gilgit-hunza"]["status"] == "open"
    assert rows["kkh-hunza-khunjerab"]["status"] == "restricted"
    assert rows["shandur-chitral"]["status"] == "closed"


def test_nha_parser_ignores_roads_outside_the_north():
    """A motorway in Punjab must not be attributed to a northern route."""
    assert all("M-2" not in r["status_note"] for r in nha.parse(NHA_SAMPLE))


def test_explicit_status_column_beats_keyword_inference():
    """Regression: 'single lane' in the remarks promoted an authority's
    'Caution' to 'restricted'. The stated status must win."""
    rows = {r["id"]: r for r in nha.parse(NHA_SAMPLE)}
    assert rows["skardu-road"]["status"] == "caution"


@pytest.mark.parametrize("text,expected", [
    ("Shandur Pass blocked by snow", "closed"),
    ("Convoy released every 30 minutes", "restricted"),
    ("Rockfall clearance, expect delay", "caution"),
    ("Carriageway clear, traffic flow normal", "open"),
])
def test_status_classification(text, expected):
    assert nha.classify(text) == expected


def test_unclassifiable_text_returns_none():
    assert nha.classify("The weather is pleasant today") is None


# ------------------------------------------------------------------- PMD
@pytest.mark.parametrize("text,expected", [
    ("Heavy snowfall expected in Hunza", "high"),
    ("Rain-wind/thunderstorm expected in Chitral", "medium"),
    ("Partly cloudy over most tourist places", "low"),
])
def test_pmd_severity_grading(text, expected):
    assert pmd._severity(text) == expected


# -------------------------------------------------------------- Open-Meteo
@pytest.mark.parametrize("code,icon", [
    (0, "sun"), (2, "cloud-sun"), (3, "cloud"), (45, "fog"),
    (63, "rain"), (75, "snow"), (95, "storm"),
])
def test_wmo_code_mapping(code, icon):
    assert openmeteo.describe(code)[1] == icon


def test_snow_and_freezing_codes_flag_a_driving_hazard():
    assert 75 in openmeteo.HAZARDOUS      # heavy snow
    assert 67 in openmeteo.HAZARDOUS      # freezing rain
    assert 0 not in openmeteo.HAZARDOUS   # clear sky


# ------------------------------------------------------------------ GDACS
def test_gdacs_severity_mapping():
    assert gdacs.SEVERITY["Red"] == "high"
    assert gdacs.SEVERITY["Orange"] == "medium"
    assert gdacs.SEVERITY["Green"] == "low"


# ------------------------------------------------ degradation guarantees
class _Boom(Source):
    name = "boom"

    async def _fetch(self, client):
        raise RuntimeError("upstream exploded")


class _Empty(Source):
    name = "empty"

    async def _fetch(self, client):
        return []


class _EmptyAllowed(Source):
    name = "empty-ok"
    allow_empty = True

    async def _fetch(self, client):
        return []


def test_a_failing_source_degrades_instead_of_raising():
    res = asyncio.run(_Boom().run())
    assert res.mode == "fallback" and not res.ok
    assert "upstream exploded" in res.error


def test_empty_is_a_failure_for_sources_that_must_return_rows():
    assert asyncio.run(_Empty().run()).mode == "fallback"


def test_empty_is_valid_for_hazard_feeds():
    """A quiet region is a real answer, not an outage."""
    res = asyncio.run(_EmptyAllowed().run())
    assert res.mode == "live" and res.items == []


def test_unconfigured_source_reports_disabled():
    class NoKey(Source):
        name = "nokey"

        def configured(self):
            return False

    assert asyncio.run(NoKey().run()).mode == "disabled"


def test_source_result_summary_is_serialisable():
    s = SourceResult("x", "live", items=[{"a": 1}]).summary()
    assert set(s) == {"name", "mode", "count", "error", "fetched_at", "source_url"}
    assert s["count"] == 1
