"""Shared fixtures.

Tests run entirely offline: no database, no Firebase, no network. Anything
that would reach out is either stubbed or covered by a test that is
explicitly marked `network`.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "network: needs internet; deselect with -m 'not network'")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
