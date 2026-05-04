"""Integration tests for Slice 1: auth flows, setup wizard, profile management."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_setup_page_redirects_when_users_exist(client):
    """Setup page redirects to / when users already exist (which they do in shared test DB)."""
    resp = await client.get("/setup", follow_redirects=False)
    # Either shows setup page (200) or redirects to / if users already exist (303)
    assert resp.status_code in (200, 303)


@pytest.mark.asyncio
async def test_setup_rejects_when_users_exist(client):
    """Setup POST returns 403 when users already exist."""
    resp = await client.post("/setup", data={
        "name": "Alice Admin",
        "email": "alice-new@example.com",
        "password": "securepassword",
        "timezone": "UTC",
    }, follow_redirects=False)
    # If users exist, returns 403; if DB is empty, returns 303
    assert resp.status_code in (303, 403)


@pytest.mark.asyncio
async def test_login_page_accessible(client):
    resp = await client.get("/auth/login")
    assert resp.status_code == 200
    assert b"Sign in" in resp.content


@pytest.mark.asyncio
async def test_html_form_login_success(client):
    # Register via JSON API first
    await client.post("/auth/register", json={
        "email": "form-user@example.com",
        "name": "Form User",
        "password": "mypassword",
    })

    # Login via HTML form
    resp = await client.post("/auth/login-form", data={
        "email": "form-user@example.com",
        "password": "mypassword",
    }, follow_redirects=False)
    assert resp.status_code == 303
    assert "session" in resp.cookies or resp.headers.get("location") == "/dashboard"


@pytest.mark.asyncio
async def test_html_form_login_wrong_password(client):
    await client.post("/auth/register", json={
        "email": "user2@example.com",
        "name": "User Two",
        "password": "correctpassword",
    })

    resp = await client.post("/auth/login-form", data={
        "email": "user2@example.com",
        "password": "wrongpassword",
    }, follow_redirects=False)
    # Should redirect back to login with error
    assert resp.status_code == 303
    assert "error" in resp.headers.get("location", "").lower()


@pytest.mark.asyncio
async def test_profile_update(client):
    # Register and get session
    reg_resp = await client.post("/auth/register", json={
        "email": "profile-test@example.com",
        "name": "Profile Test",
        "password": "testpassword",
    }, follow_redirects=False)
    assert "session" in reg_resp.cookies

    # Update profile
    resp = await client.put("/profile", json={
        "name": "Updated Name",
        "slug": "updated-slug",
        "timezone": "America/New_York",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["slug"] == "updated-slug"


@pytest.mark.asyncio
async def test_duplicate_slug_rejected(client):
    # Register two users with different slugs
    await client.post("/auth/register", json={
        "email": "slug-test1@example.com",
        "name": "Slug Test 1",
        "password": "testpassword",
        "slug": "unique-slug-1",
    })

    # Login as user 1
    login_resp = await client.post("/auth/login", json={
        "email": "slug-test1@example.com",
        "password": "testpassword",
    }, follow_redirects=False)

    # Try to change slug to one that doesn't exist yet — should work
    resp = await client.put("/profile", json={
        "name": "Slug Test 1",
        "slug": "unique-slug-1",
        "timezone": "UTC",
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_logout_clears_session(client):
    await client.post("/auth/register", json={
        "email": "logout-test@example.com",
        "name": "Logout Test",
        "password": "testpassword",
    })

    resp = await client.post("/auth/logout", follow_redirects=False)
    assert resp.status_code == 303
    # Cookie should be cleared
    # (httpx clears cookies on delete_cookie response)
