"""Integration tests for Slice 2: booking pages, slots API, event type CRUD, availability management."""

from __future__ import annotations

import pytest
from datetime import date, timedelta


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _register_and_login(client, email: str, name: str, password: str = "testpass123"):
    reg = await client.post("/auth/register", json={
        "email": email,
        "name": name,
        "password": password,
    }, follow_redirects=False)
    # register returns 303 redirect to /dashboard with session cookie
    assert reg.status_code == 303
    assert "session" in reg.cookies
    return reg


async def _create_event_type(client, slug: str = "30-min-call", title: str = "30 Min Call", duration: int = 30):
    resp = await client.post("/dashboard/event-types", json={
        "slug": slug,
        "title": title,
        "duration_minutes": duration,
        "buffer_minutes": 0,
        "min_notice_hours": 0,
        "max_horizon_days": 90,
        "color": "#2563eb",
        "location": None,
        "video_link": None,
        "intake_questions": [],
    })
    assert resp.status_code == 200
    return resp.json()


# ---------------------------------------------------------------------------
# Event type CRUD
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_event_type(client):
    await _register_and_login(client, "et-create@example.com", "ET Create")
    data = await _create_event_type(client, slug="intro-call", title="Intro Call")
    assert "id" in data
    assert data["slug"] == "intro-call"


@pytest.mark.asyncio
async def test_list_event_types(client):
    await _register_and_login(client, "et-list@example.com", "ET List")
    await _create_event_type(client, slug="call-a", title="Call A")
    await _create_event_type(client, slug="call-b", title="Call B")

    resp = await client.get("/dashboard/event-types")
    assert resp.status_code == 200
    data = resp.json()
    slugs = [et["slug"] for et in data]
    assert "call-a" in slugs
    assert "call-b" in slugs


@pytest.mark.asyncio
async def test_update_event_type(client):
    await _register_and_login(client, "et-update@example.com", "ET Update")
    created = await _create_event_type(client, slug="update-me", title="Update Me")
    et_id = created["id"]

    resp = await client.put(f"/dashboard/event-types/{et_id}", json={
        "slug": "updated-slug",
        "title": "Updated Title",
        "duration_minutes": 60,
        "buffer_minutes": 15,
        "min_notice_hours": 2,
        "max_horizon_days": 60,
        "color": "#16a34a",
        "location": None,
        "video_link": None,
        "intake_questions": [],
    })
    assert resp.status_code == 200

    # Verify change reflected in list
    list_resp = await client.get("/dashboard/event-types")
    assert list_resp.status_code == 200
    updated = next(et for et in list_resp.json() if et["id"] == et_id)
    assert updated["title"] == "Updated Title"
    assert updated["duration_minutes"] == 60


@pytest.mark.asyncio
async def test_delete_event_type(client):
    await _register_and_login(client, "et-delete@example.com", "ET Delete")
    created = await _create_event_type(client, slug="delete-me", title="Delete Me")
    et_id = created["id"]

    resp = await client.delete(f"/dashboard/event-types/{et_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    # Should not appear in list anymore
    list_resp = await client.get("/dashboard/event-types")
    ids = [et["id"] for et in list_resp.json()]
    assert et_id not in ids


@pytest.mark.asyncio
async def test_cannot_edit_other_users_event_type(client):
    """User A should not be able to update User B's event type."""
    await _register_and_login(client, "owner@example.com", "Owner")
    created = await _create_event_type(client, slug="owners-type", title="Owner Type")
    et_id = created["id"]

    # Log out and register as user B
    await client.post("/auth/logout")
    await _register_and_login(client, "attacker@example.com", "Attacker")

    resp = await client.put(f"/dashboard/event-types/{et_id}", json={
        "slug": "hacked",
        "title": "Hacked",
        "duration_minutes": 30,
        "buffer_minutes": 0,
        "min_notice_hours": 1,
        "max_horizon_days": 30,
        "color": "#ff0000",
        "location": None,
        "video_link": None,
        "intake_questions": [],
    })
    # Should return 404 (not found for this user)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Availability management
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_and_get_availability(client):
    await _register_and_login(client, "avail@example.com", "Avail User")

    rules = [
        {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00", "timezone": "UTC"},
        {"day_of_week": 1, "start_time": "10:00", "end_time": "16:00", "timezone": "UTC"},
    ]
    resp = await client.post("/dashboard/availability", json=rules)
    assert resp.status_code == 200
    assert resp.json()["saved"] == 2

    get_resp = await client.get("/dashboard/availability")
    assert get_resp.status_code == 200
    saved = get_resp.json()
    assert len(saved) == 2
    days = [r["day_of_week"] for r in saved]
    assert 0 in days
    assert 1 in days


@pytest.mark.asyncio
async def test_availability_replace_all(client):
    """POST /availability replaces (not appends) all existing rules."""
    await _register_and_login(client, "avail-replace@example.com", "Avail Replace")

    # Set 3 rules
    await client.post("/dashboard/availability", json=[
        {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00", "timezone": "UTC"},
        {"day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "timezone": "UTC"},
        {"day_of_week": 2, "start_time": "09:00", "end_time": "17:00", "timezone": "UTC"},
    ])

    # Replace with just 1 rule
    await client.post("/dashboard/availability", json=[
        {"day_of_week": 4, "start_time": "08:00", "end_time": "12:00", "timezone": "UTC"},
    ])

    get_resp = await client.get("/dashboard/availability")
    rules = get_resp.json()
    assert len(rules) == 1
    assert rules[0]["day_of_week"] == 4


# ---------------------------------------------------------------------------
# Booking page rendering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_booking_page_renders(client):
    """Public booking page renders for active user with event types."""
    await _register_and_login(client, "page-user@example.com", "Page User")

    # Update slug via profile
    await client.put("/profile", json={
        "name": "Page User",
        "slug": "page-user-slug",
        "timezone": "UTC",
    })
    await _create_event_type(client, slug="quick-chat", title="Quick Chat")

    # Access the public booking page (no auth needed)
    await client.post("/auth/logout")
    resp = await client.get("/page-user-slug")
    assert resp.status_code == 200
    assert b"Page User" in resp.content
    assert b"Quick Chat" in resp.content


@pytest.mark.asyncio
async def test_booking_page_404_for_unknown_slug(client):
    resp = await client.get("/this-slug-definitely-does-not-exist-xyz")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Slots API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_slots_returns_json(client):
    """Slots endpoint returns JSON with a date and slots list."""
    await _register_and_login(client, "slots-user@example.com", "Slots User")

    await client.put("/profile", json={
        "name": "Slots User",
        "slug": "slots-user-slug",
        "timezone": "UTC",
    })
    await _create_event_type(client, slug="consult", title="Consult")

    # Set availability on Monday (day_of_week=0)
    await client.post("/dashboard/availability", json=[
        {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00", "timezone": "UTC"},
    ])

    # Find the next Monday at least 1 day out
    today = date.today()
    days_ahead = (7 - today.weekday()) % 7  # days until next Monday
    if days_ahead == 0:
        days_ahead = 7
    next_monday = today + timedelta(days=days_ahead)

    await client.post("/auth/logout")
    resp = await client.get(
        f"/slots-user-slug/consult/slots",
        params={"target_date": next_monday.isoformat(), "client_timezone": "UTC"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "date" in data
    assert "slots" in data
    assert isinstance(data["slots"], list)


@pytest.mark.asyncio
async def test_slots_empty_when_no_availability(client):
    """Slots endpoint returns empty list when user has no availability rules."""
    await _register_and_login(client, "noavail@example.com", "No Avail")

    await client.put("/profile", json={
        "name": "No Avail",
        "slug": "noavail-slug",
        "timezone": "UTC",
    })
    await _create_event_type(client, slug="meeting", title="Meeting")

    # No availability rules set

    today = date.today()
    next_monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)

    await client.post("/auth/logout")
    resp = await client.get(
        f"/noavail-slug/meeting/slots",
        params={"target_date": next_monday.isoformat(), "client_timezone": "UTC"},
    )
    assert resp.status_code == 200
    assert resp.json()["slots"] == []


@pytest.mark.asyncio
async def test_slots_404_for_unknown_event_type(client):
    await _register_and_login(client, "slots404@example.com", "Slots 404")
    await client.put("/profile", json={
        "name": "Slots 404",
        "slug": "slots404-slug",
        "timezone": "UTC",
    })

    await client.post("/auth/logout")
    resp = await client.get(
        "/slots404-slug/nonexistent-type/slots",
        params={"target_date": date.today().isoformat(), "client_timezone": "UTC"},
    )
    assert resp.status_code == 404
