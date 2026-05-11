# syntax=docker/dockerfile:1

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
# Install all node_modules (including devDependencies needed for build).
FROM node:20-alpine AS deps

WORKDIR /app

# better-sqlite3 requires native compilation
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
# Compile the Next.js app with standalone output.
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Produce a standalone build so the runner stage only needs the minimal output.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
# Minimal production image — only the compiled output, no source or dev deps.
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user to run the app
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy the standalone server bundle and static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# SQLite data directory — mount a volume here in production
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
