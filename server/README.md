---
title: Solastio Server
emoji: 💈
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 4000
pinned: false
---

# Solastio Server

Node/Express backend for Solastio Salon & Beauty OS.

## Hugging Face Space

Create a Hugging Face Space with SDK `Docker`, then push the contents of this `server` folder to that Space.

Required Space secrets:

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

Note: Hugging Face free Spaces can sleep. For production WhatsApp webhooks, use an always-on backend host.
