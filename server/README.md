# Solastio Server

Node/Express backend for Solastio Salon & Beauty OS.

## Production

Use `PRODUCTION.md` as the source of truth for production hosting, deployment, workers, health checks, and MongoDB operations. Hugging Face Spaces are not recommended for production because free Spaces sleep and are not reliable for WhatsApp webhooks or SSE.

Required production secrets:

- `NODE_ENV=production`
- `PORT=4000`
- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CSRF_SECRET`
- `CORS_ORIGINS`
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=none`
- `VERIFY_TOKEN`

Optional WhatsApp/Meta secrets:

- `WHATSAPP_PROVIDER`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_CONFIG_ID`
- `META_WEBHOOK_APP_SECRET`
- `META_CREDENTIAL_ENCRYPTION_KEY`
- `META_WHATSAPP_TOKEN`
- `META_WABA_PHONE_NUMBER_ID`

Health checks:

- `/api/v1/health`
- `/api/v1/ready`

WhatsApp webhook URL:

- `/webhook`
