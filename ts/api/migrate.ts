/**
 * Vercel migration endpoint.
 *
 * Call POST /api/migrate (with MIGRATE_SECRET header) after deploying
 * to apply any pending database migrations via the Neon HTTP driver.
 *
 * curl -X POST https://<your-deployment>.vercel.app/api/migrate \
 *      -H "Authorization: Bearer $MIGRATE_SECRET"
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed — use POST" });
  }

  const secret = process.env["MIGRATE_SECRET"];
  const auth = req.headers["authorization"];
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    return res.status(500).json({ error: "DATABASE_URL is not set" });
  }

  try {
    const sql = neon(databaseUrl);
    const db = drizzle(sql);

    // Migrations folder is co-located in the repo and bundled by Vercel.
    const migrationsFolder = path.resolve(__dirname, "../migrations");
    await migrate(db, { migrationsFolder });

    return res.status(200).json({ ok: true, message: "Migrations applied successfully" });
  } catch (err) {
    console.error("Migration failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Migration failed", detail: message });
  }
}

export const config = {
  runtime: "nodejs20.x",
};
