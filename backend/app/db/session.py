"""Async engine + session handling.

The whole database layer is optional. With no DATABASE_URL the app keeps
using the in-memory data layer, so a clone-and-run still works with zero
infrastructure — `enabled()` is the switch every caller checks.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (AsyncSession, async_sessionmaker,
                                    create_async_engine)
from sqlalchemy import text

from ..config import DATABASE_URL, DB_ECHO
from .models import Base

log = logging.getLogger("northern_trails.db")

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def normalized_url(url: str) -> str:
    """Accept the postgres:// URLs that Render/Railway hand out."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def enabled() -> bool:
    return bool(DATABASE_URL)


def engine():
    global _engine, _sessionmaker
    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        _engine = create_async_engine(normalized_url(DATABASE_URL), echo=DB_ECHO,
                                      pool_pre_ping=True, pool_size=5, max_overflow=5)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSession]:
    engine()
    assert _sessionmaker is not None
    async with _sessionmaker() as s:
        yield s


async def init_db() -> dict:
    """Create the PostGIS extension and every table. Safe to re-run."""
    eng = engine()
    async with eng.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.create_all)
    async with eng.connect() as conn:
        version = (await conn.execute(text("SELECT postgis_version()"))).scalar()
    log.info("database ready (PostGIS %s)", version)
    return {"postgis": version, "tables": sorted(Base.metadata.tables)}


async def dispose() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
        _engine, _sessionmaker = None, None
