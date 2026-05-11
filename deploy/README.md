# bisque-booking — Deployment Guide

Self-hosted deployment via Docker Compose with nginx reverse proxy and Let's Encrypt TLS.

## Prerequisites

- A Linux server with **Docker** and **Docker Compose** (`docker compose` v2)
- **nginx** installed on the host (`apt install nginx`)
- **certbot** for TLS (`apt install certbot python3-certbot-nginx`)
- A domain pointing at your server (e.g. `booking.yourdomain.com`)

## Deploy Steps

### 1. Clone the repo

```bash
git clone https://github.com/Bisque-Labs/bisque-booking
cd bisque-booking
```

### 2. Configure environment variables

```bash
cp nextjs/.env.example .env
nano .env
```

Fill in every **Required** variable. At minimum:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | Your admin password |
| `SESSION_SECRET` | Output of `openssl rand -hex 32` |
| `CRON_SECRET` | Output of `openssl rand -hex 32` (run again for a different value) |
| `HOST_EMAIL` | Your email address |
| `BASE_URL` | `https://booking.yourdomain.com` |
| `DATABASE_PATH` | `/app/data/bookings.db` (leave as-is for Docker) |

### 3. Generate secrets

```bash
openssl rand -hex 32   # paste as SESSION_SECRET
openssl rand -hex 32   # paste as CRON_SECRET
```

### 4. Start the containers

```bash
docker compose up -d
```

Verify everything started:

```bash
docker compose ps
docker compose logs -f app
```

The app is now running at `http://localhost:3200`.

### 5. Configure nginx

```bash
# Copy the snippet and edit the domain name
cp deploy/nginx.conf /etc/nginx/sites-available/bisque-booking
nano /etc/nginx/sites-available/bisque-booking   # replace booking.yourdomain.com
ln -s /etc/nginx/sites-available/bisque-booking /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 6. Get a TLS certificate

```bash
certbot --nginx -d booking.yourdomain.com
```

Certbot modifies the nginx config automatically and sets up auto-renewal.

### 7. First-time setup

Visit `https://booking.yourdomain.com/admin` → log in with `ADMIN_PASSWORD` → go to **Availability** and set your working hours.

### 8. Share the booking page

Send guests to: `https://booking.yourdomain.com/book`

---

## Day-to-Day Operations

**View logs:**
```bash
docker compose logs -f app
docker compose logs -f cron
```

**Update to latest version:**
```bash
git pull
docker compose build
docker compose up -d
```

**Backup SQLite database:**
```bash
docker compose exec app sqlite3 /app/data/bookings.db .dump > backup-$(date +%Y%m%d).sql
```

**Stop everything** (data persists in the named volume):
```bash
docker compose down
```

**Wipe data and start fresh** (destructive!):
```bash
docker compose down -v
```

---

## Monitoring

| Check | Command |
|---|---|
| Health endpoint | `curl https://booking.yourdomain.com/api/health` |
| Container status | `docker compose ps` |
| Reminder cron log | `docker compose logs cron` |

The `/api/health` endpoint returns `{"ok": true, "version": "..."}` and is suitable for uptime monitors (Better Uptime, UptimeRobot, etc.).

---

## Architecture Notes

- **SQLite** is stored in the `bisque_data` named Docker volume at `/app/data/bookings.db`.
- **Reminder emails** are sent by the `cron` service (Ofelia) every 15 minutes via `POST /api/cron/reminders`. The route is idempotent — duplicate runs are safe.
- **Secrets** live only in `.env` (not committed). Rotate them by updating `.env` and restarting: `docker compose up -d`.
- **TLS** is terminated by nginx on the host. The container only speaks plain HTTP on port 3000 (exposed as 3200 on the host).
