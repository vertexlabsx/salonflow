# Solastio App

Flutter staff/owner app plus a Rust backend for Solastio Salon & Beauty OS.

## Apps

- Flutter frontend: `NEW SOLASTIO APP/flutter`
- Rust backend: `NEW SOLASTIO APP/app`
- Angular/Node files at the repository root are legacy reference code and are no longer the default app.
- The new app owns local runtime secrets in `NEW SOLASTIO APP/app/.env`; tracked files contain placeholders only.

## Local Development

Run the backend and frontend in separate terminals:

```bash
npm run api
npm run app
```

The backend runs on `http://127.0.0.1:4000`. The Flutter app receives the backend URL through `SOLASTIO_API_BASE`.
`npm run api` loads `NEW SOLASTIO APP/app/.env` so the Rust API uses the new app's local MongoDB and integration credentials.

## Common Scripts

- `npm run api` - start the Rust API
- `npm run app` - run the Flutter Windows app
- `npm run app:build:web` - build Flutter web output
- `npm run app:build:windows` - build the Windows app
- `npm run app:build:apk` - build the Android APK
- `npm run test` - run Flutter and Rust tests
- `npm run api:clippy` - run Rust clippy with warnings denied

## Required Environment

The Rust API requires MongoDB plus runtime secrets. See `NEW SOLASTIO APP/app/docs/LOCAL_DEVELOPMENT.md`.

Local secrets are stored in `NEW SOLASTIO APP/app/.env`, which is ignored by git.
Use `NEW SOLASTIO APP/app/.env.example` as the placeholder template for the new Rust backend.

## Production Notes

Production must use persistent MongoDB, unique 32+ character secrets, HTTPS frontend/API origins, secure cookies, and a real Android signing keystore.

See `NEW SOLASTIO APP/flutter/RUNBOOK.md` for frontend release commands.
