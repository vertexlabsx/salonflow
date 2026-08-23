# Production Runbook

## Phase 1 Baseline

The production server must run against persistent MongoDB. Do not use `npm run dev:memory` outside local testing; its data can be discarded.

## Required Environment

Set these values in the host secret manager or process environment, not in git:

- `NODE_ENV=production`
- `MONGODB_URI` — MongoDB Atlas connection string (never localhost, never memory)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `CSRF_SECRET` with unique random values of at least 32 characters
- `CORS_ORIGINS` with only deployed HTTPS frontend origins (e.g. the Vercel domain)
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=none` when the frontend and API are on different sites (Vercel + Fly/Render) so the refresh cookie travels
- Rotated `SEED_OWNER_PASSWORD` and `SEED_STAFF_PASSWORD` before first production seed

Use `MONGODB_AUTO_INDEX=false` in production and run index synchronization as a controlled deployment step.

## MVP Topology (5 pilot salons)

Angular/Vercel (web PWA) + existing Capacitor Android APK + Node/Express API + MongoDB Atlas + Meta WhatsApp Cloud API. One shared database; every tenant is isolated by `salonId`/`branchId` scoping already enforced server-side. The stack stays 10,000-salon capable (indexes, tenant filters, transactions) without paying for capacity a pilot does not need.

### Backend hosting decision: NOT Hugging Face Spaces

Hugging Face Spaces was evaluated and rejected for the API:

- Free Spaces sleep after inactivity → missed WhatsApp webhooks and dead SSE streams
- The proxy is tuned for ML demos; long-lived SSE and always-on REST behavior are not guaranteed
- Restartable ephemeral containers add no value for a stateless API that only needs Atlas

Use **Fly.io** (`fly.toml` included, Mumbai region, ~$2–3/mo always-on shared VM) or **Render** (`render.yaml`, paid starter tier — its free tier sleeps). Both serve HTTPS, keep the webhook reachable, and pass SSE through unbuffered.

### Deployment steps

1. **Atlas:** create an M0 cluster, get the connection string, allow network access from anywhere (0.0.0.0/0 is acceptable for a pilot; tighten later).
2. **Backend:** deploy from `server/` with Fly (`fly launch --no-deploy --copy-config && fly secrets set ... && fly deploy`) or Render (import `render.yaml`). Set all variables from `.env.production.example`.
3. **Frontend:** import this repo into Vercel. `vercel.json` builds with Angular's production configuration and serves `www/browser` with SPA rewrites.
4. **Frontend API URL:** set the deployed API origin in `src/environments/environment.prod.ts` (`apiBaseUrl`) — the single compile-time source used by web, PWA, and the Capacitor APK build.
5. **First deployment:** run locally against Atlas or via the host console:
   ```bash
   npm ci && npm run prod:check && npm run db:indexes
   npm run seed   # fresh database only
   ```
6. **Workers:** no cron on Fly/Render — GitHub Actions covers it (`.github/workflows/scheduled-jobs.yml`). Add repo secrets `PROD_MONGODB_URI`, `PROD_JWT_ACCESS_SECRET`, `PROD_JWT_REFRESH_SECRET`, `PROD_CSRF_SECRET`; reminders + WhatsApp retry run every 5 minutes, retention cleanup nightly.
7. **WhatsApp:** launch with `WHATSAPP_PROVIDER=mock`. When Meta credentials arrive, set the four `META_*` variables and flip to `WHATSAPP_PROVIDER=meta` — no code changes; register `https://<api-host>/api/v1/whatsapp/webhook`.

### Go-live checklist

1. Set production `MONGODB_URI` 2. strong JWT secrets 3. CSRF secret 4. production `CORS_ORIGINS` 5. `COOKIE_SECURE=true` 6. HTTPS (automatic on Fly/Render/Vercel) 7. Vercel production API URL 8. `npm run prod:check` passes 9. `npm run db:indexes` 10. seed only if fresh 11. owner login 12. staff login 13. appointment creation 14. availability conflicts rejected 15. cancel/reschedule 16. second tenant cannot read first tenant data 17. WhatsApp mock booking round-trip 18. realtime update appears on an open SSE client

## First Deployment

1. Install dependencies: `npm ci`
2. Validate production config and Mongo connectivity: `npm run prod:check`
3. Build: `npm run build`
4. Synchronize indexes: `npm run db:indexes`
5. Seed the first tenant once: `npm run seed`
6. Start the API: `npm start`

## Scheduled Jobs

Handled by `.github/workflows/scheduled-jobs.yml` in the MVP topology (the API hosts above have no cron). If you later move to a host with a shell, run these directly instead:

- `npm run reminders` every 5 minutes
- `npm run whatsapp:retry` every 10 minutes (re-sends failed/queued Meta messages, max 5 attempts)
- `npm run cleanup` daily during low traffic

## MongoDB Notes

- Prefer a replica set even for single-node self-hosting so transactions and retryable writes behave correctly.
- Enable automated backups before onboarding real customers.
- Keep direct database access restricted to deployment and backup operators.
- Run `npm run db:indexes` during maintenance windows for schema/index changes.

## Health Checks

- Liveness: `GET /api/v1/health`
- Readiness: `GET /api/v1/ready` returns `503` until MongoDB is connected.

## Container

Build the API image from `server/`:

```bash
docker build -t aura-staff-server:latest .
```

## Full-Stack Deployment (docker compose) — optional self-host alternative

Not the chosen MVP path, but kept for salons that later want fully self-hosted infrastructure: `deploy/docker-compose.yml` runs the API, a single-node MongoDB replica set (required for transactions), and Caddy with automatic HTTPS. Caddy also serves the frontend bundle and proxies the SSE stream without buffering.

1. Copy `.env.production.example` to `deploy/.env` and fill every value.
2. Build the frontend and place its output in `deploy/site/`:
   ```bash
   cd .. && npm run build && cp -r dist/* server/deploy/site/
   ```
3. From `server/deploy/`:
   ```bash
   docker compose up -d --build
   docker compose exec api node dist/ops/sync-indexes.js
   docker compose exec api node dist/seed.js   # first tenant only
   ```
4. Verify: `GET https://<domain>/api/v1/ready`, then log in from the deployed frontend.
5. Schedule the jobs above on the host (crontab or systemd timers) invoking `docker compose exec api node dist/jobs/<job>.js`.

## Local Persistent Development

Use a real local MongoDB instead of memory mode when testing flows that must survive restarts:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/aura_saas npm run dev
```

Then seed with:

```bash
npm run seed
```
