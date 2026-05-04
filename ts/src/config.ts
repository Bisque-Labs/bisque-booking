/**
 * Application configuration — all settings from environment variables.
 * Validated with Zod at startup so missing required vars fail fast.
 */

import { z } from "zod";

const ConfigSchema = z.object({
  // Core
  APP_NAME: z.string().default("bisque-booking"),
  DEBUG: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default("postgresql://bisque:bisque@localhost:5432/bisque_booking"),

  // Security
  SECRET_KEY: z
    .string()
    .min(16, "SECRET_KEY must be at least 16 characters")
    .default("change-me-in-production-32-bytes!!"),
  ENCRYPTION_KEY: z.string().default(""), // AES key for Google credentials

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default(""),

  // SMTP
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USERNAME: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_USE_TLS: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  SMTP_USE_STARTTLS: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  FROM_EMAIL: z.string().min(1).default("noreply@localhost"),

  // Webhooks
  WEBHOOK_URL: z.string().default(""),
  WEBHOOK_SECRET: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

/**
 * Parse and validate environment variables. Throws on invalid config.
 * Results are cached after first call.
 */
export function getConfig(): Config {
  if (_config !== null) return _config;
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  _config = result.data;
  return _config;
}

/** Reset cached config (for testing only). */
export function _resetConfig(): void {
  _config = null;
}

/** Computed: Google OAuth callback URL */
export function getGoogleCallbackUrl(): string {
  const cfg = getConfig();
  return cfg.GOOGLE_REDIRECT_URI || `${cfg.BASE_URL}/auth/google/callback`;
}
