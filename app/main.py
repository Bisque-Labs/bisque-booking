"""bisque-booking — FastAPI application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.routers import auth, booking, dashboard, health, polls

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="bisque-booking",
        description="Self-hosted scheduling for consulting teams",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    # Middleware
    app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

    # Static files
    app.mount("/static", StaticFiles(directory="app/static"), name="static")

    # Routers
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(dashboard.router)
    app.include_router(polls.router)

    # Booking router last (catches /{slug} wildcard)
    app.include_router(booking.router)

    # Root redirect
    @app.get("/", response_class=HTMLResponse)
    async def root(request: Request):
        templates = Jinja2Templates(directory="app/templates")
        return templates.TemplateResponse("pages/home.html", {"request": request})

    return app


app = create_app()
