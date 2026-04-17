"""Integration tests for the HTTP API using the test client."""

from __future__ import annotations

import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_register_and_login(client):
    # Register first user (becomes admin)
    resp = await client.post("/auth/register", json={
        "email": "admin@example.com",
        "name": "Admin User",
        "password": "password123",
    })
    assert resp.status_code in (200, 303)  # redirect or JSON

    # Login
    resp2 = await client.post("/auth/login", json={
        "email": "admin@example.com",
        "password": "password123",
    })
    assert resp2.status_code in (200, 303)


@pytest.mark.asyncio
async def test_booking_page_404(client):
    resp = await client.get("/nonexistent-user")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_booking_page_not_found_returns_404(client):
    resp = await client.get("/somebody-who-does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_poll_not_found(client):
    resp = await client.get("/polls/invalid-share-token")
    assert resp.status_code == 404
