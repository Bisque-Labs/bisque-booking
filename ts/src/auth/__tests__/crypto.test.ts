import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _resetConfig } from "@/config";
import { encryptCredentials, decryptCredentials } from "../crypto";

/** Generate a valid 32-byte hex key for testing */
const TEST_HEX_KEY = "0".repeat(64); // 32 zero bytes as hex

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  _resetConfig();
  process.env["ENCRYPTION_KEY"] = TEST_HEX_KEY;
  process.env["BASE_URL"] = "http://localhost:3000";
  process.env["FROM_EMAIL"] = "test@example.com";
});

afterEach(() => {
  process.env = originalEnv;
  _resetConfig();
});

describe("encryptCredentials / decryptCredentials", () => {
  it("round-trips a simple string", async () => {
    const plain = "hello world";
    const cipher = await encryptCredentials(plain);
    expect(cipher).not.toBe(plain);
    const decrypted = await decryptCredentials(cipher);
    expect(decrypted).toBe(plain);
  });

  it("round-trips a JSON credentials object", async () => {
    const creds = JSON.stringify({ access_token: "tok", refresh_token: "rtok" });
    const cipher = await encryptCredentials(creds);
    const decrypted = await decryptCredentials(cipher);
    expect(decrypted).toBe(creds);
  });

  it("produces different ciphertexts for the same input (random IV)", async () => {
    const plain = "same input";
    const c1 = await encryptCredentials(plain);
    const c2 = await encryptCredentials(plain);
    expect(c1).not.toBe(c2);
  });

  it("throws when ENCRYPTION_KEY is missing", async () => {
    _resetConfig();
    delete process.env["ENCRYPTION_KEY"];
    await expect(encryptCredentials("x")).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it("throws on invalid ciphertext during decrypt", async () => {
    await expect(decryptCredentials("not-valid-base64url-data!")).rejects.toThrow();
  });
});
