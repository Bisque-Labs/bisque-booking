/**
 * JWT access token signing and verification using jose.
 * Mirrors app/services/auth.py → create_access_token / decode_access_token.
 *
 * Algorithm: HS256
 * Default expiry: 24 hours (matches Python implementation)
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getConfig } from "@/config";

const ALGORITHM = "HS256";
const ACCESS_TOKEN_EXPIRE_HOURS = 24;

function getSecretBytes(): Uint8Array {
  const { SECRET_KEY } = getConfig();
  return new TextEncoder().encode(SECRET_KEY);
}

export interface TokenPayload extends JWTPayload {
  sub: string; // user id as string
}

/**
 * Create a signed JWT access token.
 *
 * @param data   Payload fields to embed (must include `sub` = user ID string).
 * @param expiresInHours  Override the default 24-hour expiry.
 */
export async function createAccessToken(
  data: Record<string, unknown>,
  expiresInHours: number = ACCESS_TOKEN_EXPIRE_HOURS,
): Promise<string> {
  const secret = getSecretBytes();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT(data)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInHours * 3600)
    .sign(secret);
}

/**
 * Verify and decode a JWT access token.
 *
 * @returns Decoded payload, or `null` if invalid / expired.
 */
export async function decodeAccessToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const secret = getSecretBytes();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
    });
    return payload as TokenPayload;
  } catch {
    return null;
  }
}
