/**
 * AES-256-GCM encryption/decryption for Google OAuth credentials.
 * Mirrors app/services/auth.py → encrypt_credentials / decrypt_credentials.
 *
 * The ENCRYPTION_KEY env var must be a 32-byte (256-bit) key encoded as
 * a 64-character hex string, OR a base64url-encoded 32-byte value.
 * If ENCRYPTION_KEY is empty, functions throw a configuration error.
 *
 * Ciphertext format: base64url(iv[12] + ciphertext + authTag[16])
 */

import { getConfig } from "@/config";

const IV_LENGTH = 12; // 96-bit IV for AES-GCM

/**
 * Derive a 32-byte CryptoKey from the ENCRYPTION_KEY config string.
 * Accepts hex (64 chars) or base64url (43–44 chars) encoding.
 */
async function getKey(): Promise<CryptoKey> {
  const { ENCRYPTION_KEY } = getConfig();
  if (!ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY is not set — cannot encrypt/decrypt credentials",
    );
  }

  let keyBytes: Uint8Array;
  if (ENCRYPTION_KEY.length === 64 && /^[0-9a-fA-F]+$/.test(ENCRYPTION_KEY)) {
    // Hex-encoded
    keyBytes = new Uint8Array(
      ENCRYPTION_KEY.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
    );
  } else {
    // Assume base64url
    const bin = atob(ENCRYPTION_KEY.replace(/-/g, "+").replace(/_/g, "/"));
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  }

  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (256 bits)");
  }

  // Ensure the buffer is a plain ArrayBuffer (not SharedArrayBuffer)
  const keyBuffer = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;

  return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a plaintext string. Returns a base64url-encoded payload
 * containing the IV + ciphertext + auth tag.
 */
export async function encryptCredentials(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  // Concatenate IV + ciphertext+tag
  const combined = new Uint8Array(IV_LENGTH + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), IV_LENGTH);

  // Encode as base64url
  let binary = "";
  for (const byte of combined) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decrypt a base64url-encoded payload produced by `encryptCredentials`.
 */
export async function decryptCredentials(ciphertext: string): Promise<string> {
  const key = await getKey();

  // Decode base64url → bytes
  const base64 = ciphertext.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const combined = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) combined[i] = bin.charCodeAt(i);

  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return new TextDecoder().decode(plainBuffer);
}
