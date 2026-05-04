/**
 * Password hashing and verification using bcryptjs.
 * Mirrors app/services/auth.py → hash_password / verify_password.
 */

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password. Returns the bcrypt hash string.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(
  plain: string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}
