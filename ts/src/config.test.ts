/**
 * Tests for src/config.ts — environment variable validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _resetConfig, getConfig, getGoogleCallbackUrl } from "./config";

// Save and restore process.env around each test
let originalEnv: NodeJS.ProcessEnv;

/** Minimal valid env — overridden per test as needed */
function setMinimalEnv(): void {
  delete process.env["DATABASE_URL"];
  delete process.env["SECRET_KEY"];
  delete process.env["PORT"];
  delete process.env["DEBUG"];
  delete process.env["SMTP_PORT"];
  delete process.env["SMTP_USE_TLS"];
  delete process.env["SMTP_USE_STARTTLS"];
  delete process.env["GOOGLE_REDIRECT_URI"];
  // These must be valid strings; ensure defaults are accepted by Zod
  process.env["BASE_URL"] = "http://localhost:3000";
  process.env["FROM_EMAIL"] = "noreply@localhost";
}

beforeEach(() => {
  originalEnv = { ...process.env };
  _resetConfig();
  setMinimalEnv();
});

afterEach(() => {
  process.env = originalEnv;
  _resetConfig();
});

describe("getConfig()", () => {
  it("returns defaults when no env vars are set", () => {
    // Remove potentially interfering vars
    delete process.env["DATABASE_URL"];
    delete process.env["SECRET_KEY"];
    delete process.env["PORT"];

    const cfg = getConfig();
    expect(cfg.DATABASE_URL).toBe(
      "postgresql://bisque:bisque@localhost:5432/bisque_booking",
    );
    expect(cfg.SECRET_KEY).toBe("change-me-in-production-32-bytes!!");
    expect(cfg.PORT).toBe(3000);
    expect(cfg.DEBUG).toBe(false);
    expect(cfg.BASE_URL).toBe("http://localhost:3000");
    expect(cfg.FROM_EMAIL).toBe("noreply@localhost");
  });

  it("parses DATABASE_URL from env", () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@host:5432/mydb";
    const cfg = getConfig();
    expect(cfg.DATABASE_URL).toBe("postgresql://user:pass@host:5432/mydb");
  });

  it("parses PORT as integer", () => {
    process.env["PORT"] = "8080";
    const cfg = getConfig();
    expect(cfg.PORT).toBe(8080);
  });

  it('parses DEBUG="true" as boolean true', () => {
    process.env["DEBUG"] = "true";
    const cfg = getConfig();
    expect(cfg.DEBUG).toBe(true);
  });

  it('parses DEBUG="1" as boolean true', () => {
    process.env["DEBUG"] = "1";
    const cfg = getConfig();
    expect(cfg.DEBUG).toBe(true);
  });

  it('parses DEBUG="false" as boolean false', () => {
    process.env["DEBUG"] = "false";
    const cfg = getConfig();
    expect(cfg.DEBUG).toBe(false);
  });

  it("caches config across calls", () => {
    const cfg1 = getConfig();
    const cfg2 = getConfig();
    expect(cfg1).toBe(cfg2); // same reference
  });

  it("throws when SECRET_KEY is too short", () => {
    process.env["SECRET_KEY"] = "short";
    expect(() => getConfig()).toThrow(/SECRET_KEY/);
  });

  it("parses SMTP_PORT as integer", () => {
    process.env["SMTP_PORT"] = "587";
    const cfg = getConfig();
    expect(cfg.SMTP_PORT).toBe(587);
  });

  it('parses SMTP_USE_TLS="true" as boolean', () => {
    process.env["SMTP_USE_TLS"] = "true";
    const cfg = getConfig();
    expect(cfg.SMTP_USE_TLS).toBe(true);
  });
});

describe("getGoogleCallbackUrl()", () => {
  it("returns GOOGLE_REDIRECT_URI when set", () => {
    process.env["GOOGLE_REDIRECT_URI"] = "https://example.com/auth/callback";
    const url = getGoogleCallbackUrl();
    expect(url).toBe("https://example.com/auth/callback");
  });

  it("computes callback URL from BASE_URL when GOOGLE_REDIRECT_URI is empty", () => {
    process.env["GOOGLE_REDIRECT_URI"] = "";
    process.env["BASE_URL"] = "https://myapp.example.com";
    const url = getGoogleCallbackUrl();
    expect(url).toBe("https://myapp.example.com/auth/google/callback");
  });
});
