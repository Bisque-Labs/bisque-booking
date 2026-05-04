/**
 * Application entry point — starts the HTTP server.
 *
 * Usage:
 *   node --import tsx/esm src/server.ts
 *   pnpm dev
 */

import { serve } from "@hono/node-server";
import { createApp } from "@/app";
import { getConfig } from "@/config";

const cfg = getConfig();
const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port: cfg.PORT,
  },
  (info) => {
    console.info(
      `bisque-booking running on http://localhost:${info.port} [${cfg.DEBUG ? "debug" : "production"}]`,
    );
  },
);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.info("SIGTERM received — shutting down");
  server.close(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.info("SIGINT received — shutting down");
  server.close(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
    process.exit(0);
  });
});
