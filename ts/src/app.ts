/**
 * Hono application factory.
 *
 * Assembles all routers and returns a configured Hono app instance.
 * This is separate from the server entry point so it can be imported
 * in tests without starting a listener.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authRouter } from "@/routes/auth";
import { setupRouter } from "@/routes/setup";
import { profileRouter } from "@/routes/profile";
import { dashboardRouter } from "@/routes/dashboard";
import { bookingRouter } from "@/routes/booking";
import { pollsRouter } from "@/routes/polls";
import { cronRouter } from "@/routes/cron";

export function createApp(): Hono {
  const app = new Hono();

  // Middleware
  app.use("*", logger());
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

  // Mount routers
  app.route("/auth", authRouter);
  app.route("/setup", setupRouter);
  app.route("/profile", profileRouter);
  app.route("/dashboard", dashboardRouter);
  app.route("/polls", pollsRouter);

  // Vercel Cron Job routes
  app.route("/api/cron", cronRouter);

  // Booking routes last (catch-all /:slug patterns)
  app.route("/", bookingRouter);

  return app;
}
