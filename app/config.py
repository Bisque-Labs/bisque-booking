"""Application configuration — all settings come from environment variables."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Core
    app_name: str = "bisque-booking"
    debug: bool = False
    base_url: str = "http://localhost:8000"

    # Database
    database_url: str = "postgresql+asyncpg://bisque:bisque@db:5432/bisque_booking"

    # Security
    secret_key: str = "change-me-in-production-32-bytes!!"
    encryption_key: str = ""  # Fernet key — generated on first run if empty

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""  # defaults to {base_url}/auth/google/callback

    # SMTP
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    from_email: str = "noreply@localhost"
    smtp_use_tls: bool = False
    smtp_use_starttls: bool = False

    @property
    def google_callback_url(self) -> str:
        return self.google_redirect_uri or f"{self.base_url}/auth/google/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()
