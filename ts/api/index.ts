/**
 * Vercel serverless entry point.
 *
 * Wraps the Hono app with the Vercel adapter so every request routed
 * through vercel.json → /api/index is handled by the same Hono app
 * used locally.
 *
 * On cold start, initDb() wires up the Neon HTTP driver before the
 * first request is processed.
 */

import { handle } from "hono/vercel";
import { createApp } from "../src/app";
import { initDb } from "../src/db";

// Initialise the database on cold start (async, resolves before first request).
await initDb();

// Build the app once per cold start (re-used across warm invocations).
const app = createApp();

// Export the Vercel-compatible handler.
export default handle(app);

// Required by hono/vercel for the Node.js runtime.
export const config = {
  runtime: "nodejs20.x",
};
