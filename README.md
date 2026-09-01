# Solastio App

Angular/Capacitor web and Android app plus a Node/Express backend for Solastio Salon & Beauty OS.

## Apps

- Staff workspace: `/staff` and `/staff/login`
- Owner workspace: `/owner` and `/owner/login`
- Shopify admin surface: `/shopify-admin`
- Shopify client surface: `/shopify`

## Local Development

Run the backend and frontend in separate terminals:

```bash
npm --prefix server run dev:memory
npm start
```

The frontend runs on `http://127.0.0.1:4320` and proxies `/api` to the backend on `http://127.0.0.1:4000`.

## Common Scripts

- `npm run build` - build the Angular app into `www/`
- `npm test` - run frontend Vitest tests
- `npm --prefix server run build` - compile the backend
- `npm --prefix server test` - run backend Vitest tests
- `npm run test:e2e` - run Playwright tests (requires the backend and frontend to be running)
- `npm run test:e2e:update-snapshots` - regenerate local screenshot baselines
- `npm run apk:debug` - build and sync the debug Android APK

## E2E Credentials

The memory seed expects these local test credentials:

```bash
STAFF_TENANT=tenant_aura
STAFF_USER=reception
STAFF_PASS=staff@123
OWNER_TENANT=tenant_aura
OWNER_USER=owner
OWNER_PASS=owner@123
```

Playwright uses `BASE_URL=http://127.0.0.1:4320` by default.

## Documentation

- `DEPLOYMENT.md` - frontend/PWA deployment notes
- `server/PRODUCTION.md` - backend production runbook and topology
- `server/WHATSAPP_QA_CONTRACT.md` - WhatsApp QA contract
- `server/docs/WHATSAPP_ARCHITECTURE.md` - WhatsApp system design
- `server/docs/META_PRODUCTION_CHECKLIST.md` - Meta production checklist

## Production Notes

Production must use persistent MongoDB, unique 32+ character secrets, HTTPS frontend/API origins, and secure refresh cookies. Run backend production checks and index synchronization before go-live:

```bash
npm --prefix server run prod:check
npm --prefix server run db:indexes
```

Seed only fresh databases. Never run the seed over live production data without a backup and explicit approval.
