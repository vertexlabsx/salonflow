# Local Development

## Requirements

- Rust stable
- MongoDB using the existing Solastio database
- Environment variables matching the current server secrets

Minimum local environment for API startup:

```bash
JWT_ACCESS_SECRET=replace-with-32-plus-character-secret
JWT_REFRESH_SECRET=replace-with-32-plus-character-secret
CSRF_SECRET=replace-with-32-plus-character-secret
SHOPIFY_JWT_SECRET=replace-with-32-plus-character-secret
SHOPIFY_ADMIN_EMAIL=admin@example.com
SHOPIFY_ADMIN_PASSWORD=replace-with-8-plus-character-password
MONGODB_URI=mongodb://127.0.0.1:27017/aura_saas?replicaSet=rs0
MONGODB_DATABASE=aura_saas
```

From the repository root, `npm run api` loads `NEW SOLASTIO APP/app/.env`.
Keep real values there and keep `server/.env` as legacy commented placeholders.

For production also set:

```bash
NODE_ENV=production
COOKIE_SECURE=true
CORS_ORIGINS=https://your-app-domain.com
MONGODB_URI=<persistent mongodb uri>
SEED_OWNER_PASSWORD=<strong non-default password>
SEED_STAFF_PASSWORD=<strong non-default password>
```

Configure optional integration secrets only when enabling those providers:
`WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `META_*`, `SHOPIFY_*`,
`RAZORPAY_*`, and `OPENAI_API_KEY`.

## Run

```bash
cargo run -p solastio-api
```

## Verify

```bash
cargo fmt
cargo check
cargo test
```

Health smoke test:

```bash
curl http://127.0.0.1:4000/api/v1/health
curl http://127.0.0.1:4000/api/v1/ready
```

`/api/v1/ready` returns `not_ready` until MongoDB is reachable.
