"""Test fixtures — in-memory SQLite database, test client, factory helpers."""

from __future__ import annotations

import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Use SQLite for tests (no Postgres needed)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("ENCRYPTION_KEY", "")

# Module-level engine shared across all test fixtures in the session
_test_engine = None
_test_session_factory = None


def get_test_engine():
    global _test_engine, _test_session_factory
    if _test_engine is None:
        _test_engine = create_async_engine(TEST_DATABASE_URL, echo=False, connect_args={"check_same_thread": False})
        _test_session_factory = async_sessionmaker(_test_engine, class_=AsyncSession, expire_on_commit=False)
    return _test_engine, _test_session_factory


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_tables():
    """Create all tables once for the entire test session."""
    engine, _ = get_test_engine()
    from app.database import Base
    # Import all models
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db():
    """Return a fresh session; roll back after each test."""
    _, session_factory = get_test_engine()
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client():
    """Test HTTP client with DB overridden to use the test engine."""
    from app.database import get_db
    from app.dependencies import get_calendar_provider, get_email_provider
    from app.main import app
    from app.services.noop_providers import NoopCalendarProvider, NoopEmailProvider

    _, session_factory = get_test_engine()

    async def override_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_calendar_provider] = lambda: NoopCalendarProvider()
    app.dependency_overrides[get_email_provider] = lambda: NoopEmailProvider()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
