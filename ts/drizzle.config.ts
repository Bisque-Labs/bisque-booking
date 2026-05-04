import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://bisque:bisque@localhost:5432/bisque_booking",
  },
  verbose: true,
  strict: true,
} satisfies Config;
