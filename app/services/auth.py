"""Auth utilities — password hashing, JWT sessions, token generation."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# JWT sessions
# ---------------------------------------------------------------------------


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    settings = get_settings()
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Single-use tokens (cancel / reschedule / poll share)
# ---------------------------------------------------------------------------


def generate_token(length: int = 32) -> str:
    """Generate a URL-safe random token."""
    return secrets.token_urlsafe(length)


# ---------------------------------------------------------------------------
# Fernet encryption for Google OAuth credentials
# ---------------------------------------------------------------------------


def encrypt_credentials(data: str) -> str:
    from cryptography.fernet import Fernet
    settings = get_settings()
    key = settings.encryption_key.encode()
    f = Fernet(key)
    return f.encrypt(data.encode()).decode()


def decrypt_credentials(token: str) -> str:
    from cryptography.fernet import Fernet
    settings = get_settings()
    key = settings.encryption_key.encode()
    f = Fernet(key)
    return f.decrypt(token.encode()).decode()
