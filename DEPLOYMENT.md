# Solastio Deployment

## Frontend

Build Flutter web with the production API URL:

```bash
flutter build web --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com --project-dir "NEW SOLASTIO APP/flutter"
```

Publish `NEW SOLASTIO APP/flutter/build/web` to the static host.

Build Android with a real signing keystore configured in `NEW SOLASTIO APP/flutter/android/key.properties`:

```bash
flutter build apk --dart-define=SOLASTIO_API_BASE=https://api.your-domain.com --project-dir "NEW SOLASTIO APP/flutter"
```

## Backend

Build the Rust API:

```bash
cargo build --workspace --release --manifest-path "NEW SOLASTIO APP/app/Cargo.toml"
```

Run `solastio-api` with production environment variables documented in `NEW SOLASTIO APP/app/docs/LOCAL_DEVELOPMENT.md`.

## Health Checks

- `GET /api/v1/health` should return `ok`.
- `GET /api/v1/ready` should return `ready` after MongoDB is reachable.
