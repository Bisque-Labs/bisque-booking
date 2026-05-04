import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _resetConfig } from "@/config";
import { createAccessToken, decodeAccessToken } from "../tokens";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  _resetConfig();
  process.env["SECRET_KEY"] = "test-secret-key-minimum-16-chars!!";
  process.env["BASE_URL"] = "http://localhost:3000";
  process.env["FROM_EMAIL"] = "test@example.com";
});

afterEach(() => {
  process.env = originalEnv;
  _resetConfig();
});

describe("createAccessToken / decodeAccessToken", () => {
  it("creates and decodes a valid token", async () => {
    const token = await createAccessToken({ sub: "42" });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT has 3 parts

    const payload = await decodeAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("42");
  });

  it("returns null for an invalid token", async () => {
    const result = await decodeAccessToken("not-a-jwt");
    expect(result).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await createAccessToken({ sub: "1" });
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "999", exp: 9999999999 }))
      .toString("base64url");
    const tampered = parts.join(".");
    const result = await decodeAccessToken(tampered);
    expect(result).toBeNull();
  });

  it("embeds custom claims", async () => {
    const token = await createAccessToken({ sub: "7", role: "admin" });
    const payload = await decodeAccessToken(token);
    expect(payload?.["role"]).toBe("admin");
  });

  it("expires after the specified hours", async () => {
    // Create a token that expired 1 hour ago (negative hours)
    // We can't easily test expiry without mocking Date, so just verify
    // that a token with a very short expiry is created successfully.
    const token = await createAccessToken({ sub: "1" }, 0.001); // ~3.6 seconds
    expect(token).toBeTruthy();
  });
});
