"""Tests for auth utilities."""

from app.services.auth import (
    create_access_token,
    decode_access_token,
    generate_token,
    hash_password,
    verify_password,
)


def test_password_hashing():
    plain = "my-secure-password"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed)
    assert not verify_password("wrong-password", hashed)


def test_jwt_roundtrip():
    data = {"sub": "42", "role": "consultant"}
    token = create_access_token(data)
    decoded = decode_access_token(token)
    assert decoded is not None
    assert decoded["sub"] == "42"
    assert decoded["role"] == "consultant"


def test_invalid_jwt_returns_none():
    result = decode_access_token("not.a.valid.token")
    assert result is None


def test_generate_token_uniqueness():
    tokens = {generate_token() for _ in range(100)}
    assert len(tokens) == 100  # All unique
