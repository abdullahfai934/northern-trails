"""Async engine + session handling.

The whole database layer is optional. With no DATABASE_URL the app keeps
using the in-memory data layer, so a clone-and-run still works with zero
infrastructure — `enabled()` is the switch every caller checks.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (AsyncSession, async_sessionmaker,
                                    create_async_engine)
from sqlalchemy import text

from ..config import DATABASE_URL, DB_ECHO
from .models import Base

log = logging.getLogger("northern_trails.db")

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


#: libpq-only query options that asyncpg rejects. Hosted providers (Neon,
#: Render, Supabase) put them in the URLs they hand out.
_LIBPQ_ONLY = ("sslmode", "channel_binding", "sslrootcert", "gssencmode", "target_session_attrs")


def normalized_url(url: str) -> str:
    """Accept the postgres:// URLs that Render/Railway/Neon hand out."""
    return split_url(url)[0]


def split_url(url: str) -> tuple[str, dict]:
    """(asyncpg URL, connect_args): libpq SSL options become asyncpg's `ssl`."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    sslmode = next((v for k, v in query if k == "sslmode"), "")
    kept = [(k, v) for k, v in query if k not in _LIBPQ_ONLY]
    url = urlunsplit(parts._replace(query=urlencode(kept)))
    connect_args = {}
    if sslmode in ("require", "verify-ca", "verify-full"):
        connect_args["ssl"] = "require" if sslmode == "require" else True
    return url, connect_args


def enabled() -> bool:
    return bool(DATABASE_URL)


def engine():
    global _engine, _sessionmaker
    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        url, connect_args = split_url(DATABASE_URL)
        _engine = create_async_engine(url, echo=DB_ECHO, connect_args=connect_args,
                                      pool_pre_ping=True, pool_size=5, max_overflow=5)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSession]:
    engine()
    assert _sessionmaker is not None
    async with _sessionmaker() as s:
        yield s


#: Columns added after the first release. `create_all` creates missing
#: tables but never alters existing ones, so a database made by an earlier
#: version gets these added in place. Each statement is idempotent.
MIGRATIONS = [
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS highlight VARCHAR(200) DEFAULT ''",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS photo_query VARCHAR(120) DEFAULT ''",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS operator_url VARCHAR(500) DEFAULT ''",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20) DEFAULT ''",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'seed'",
    "ALTER TABLE packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()",
    "CREATE INDEX IF NOT EXISTS ix_packages_source ON packages (source)",
    "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
    "ALTER TABLE routes ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120) DEFAULT ''",
]


async def init_db() -> dict:
    """Create the PostGIS extension and every table. Safe to re-run."""
    eng = engine()
    async with eng.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.create_all)
        for stmt in MIGRATIONS:
            await conn.execute(text(stmt))
    async with eng.connect() as conn:
        version = (await conn.execute(text("SELECT postgis_version()"))).scalar()
    log.info("database ready (PostGIS %s)", version)
    return {"postgis": version, "tables": sorted(Base.metadata.tables)}


async def dispose() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
        _engine, _sessionmaker = None, None
