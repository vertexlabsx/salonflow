# WhatsApp Onboarding Architecture

## Architecture

SalonFlow uses one backend and one Meta webhook endpoint for all salons. Each salon owns its own WhatsApp Business Account/phone number connection.

```text
Owner Dashboard -> Settings/WhatsApp -> Embedded Signup -> Meta authorization
  -> SalonFlow callback -> WhatsAppConnection(salonId, wabaId, phoneNumberId)
  -> Meta webhook -> phoneNumberId lookup -> salonId -> booking engine
  -> createAppointment() -> Staff/Owner apps see the same appointment
```

The authoritative tenant-routing key for webhooks is `phoneNumberId`, never customer phone, message text, or browser-provided `salonId`.

## Current Implementation

- `WhatsAppConnection`: tenant-owned connection, unique `phoneNumberId`, encrypted credential reference, status, WABA metadata.
- `WhatsAppWebhookEvent`: idempotent event ledger with unique `eventId` and tenant indexes.
- `WhatsAppTemplate`: tenant-scoped Meta template cache.
- `/api/v1/whatsapp/status`: safe owner status (no tokens).
- `/api/v1/whatsapp/embedded-signup/state`: server-generated one-time state.
- `/api/v1/whatsapp/embedded-signup/callback`: validates state, exchanges code, verifies accessible WABA phone numbers, stores encrypted connection.
- `/api/v1/whatsapp/disconnect`: disables local connection and stops outbound usage.
- `/api/v1/whatsapp/webhook`: single webhook endpoint for all salons.

## Tenant Isolation

- `salonId` always comes from `req.context` for authenticated owner APIs.
- `phoneNumberId` is globally unique and cannot belong to two salons.
- Customer uniqueness remains `(salonId, normalizedPhone)`, so the same customer phone can exist in different salons.
- Outbound sending resolves the Meta sender by `salonId -> WhatsAppConnection -> phoneNumberId/token`.

## Token Security

- Meta tokens are never returned to Angular.
- Tokens are encrypted with AES-256-GCM using `META_CREDENTIAL_ENCRYPTION_KEY`; if omitted, the server falls back to `JWT_REFRESH_SECRET`.
- Do not log access tokens, app secret, webhook app secret, or encrypted token payloads.
- Recommended production key rotation: add a versioned key id column before rotating existing encrypted tokens.

## Embedded Signup Flow

1. Owner clicks Connect WhatsApp.
2. Frontend calls `POST /api/v1/whatsapp/embedded-signup/state`.
3. Backend returns `state`, `appId`, `configId`, and API version.
4. Frontend starts Meta Embedded Signup with that state/config.
5. Frontend sends the returned authorization code and asset hints to `POST /api/v1/whatsapp/embedded-signup/callback`.
6. Backend consumes state once, exchanges code with Meta, fetches WABA phone numbers, validates selected `phoneNumberId`, subscribes webhooks, and stores the connection.

Asset ids returned from the browser are treated as hints only; the backend verifies access through Meta before storing anything.

## Webhook Flow

GET `/webhook` performs Meta challenge verification using `VERIFY_TOKEN`. The older `/api/v1/whatsapp/webhook` path remains available as an API alias.

POST `/api/v1/whatsapp/webhook`:

1. Validates `x-hub-signature-256` using `META_WEBHOOK_APP_SECRET` or `META_APP_SECRET`.
2. Extracts `metadata.phone_number_id`.
3. Looks up `WhatsAppConnection(phoneNumberId, status=connected)`.
4. Creates an idempotent `WhatsAppWebhookEvent`.
5. Processes booking messages through the existing `createAppointment()` service.
6. Updates the event to processed.

## Booking Engine

WhatsApp does not own slot logic. It uses the same services and persistence as Staff/Owner:

- `ServiceModel` for service catalogue.
- `createAppointment()` for booking.
- Existing transaction/slot-lock protection for concurrent booking conflicts.
- Staff/Owner apps read the same appointments collection.

## Template Management

`WhatsAppTemplate` is tenant-scoped and ready for template sync. Business-initiated messages outside the 24-hour customer service window must use Meta-approved templates; free-form text is only safe inside the allowed service window.

## Disconnect

Disconnect sets `status=disconnected`, removes the phone from the tenant salon record, disables outbound lookup, preserves historical customers/appointments/messages, and writes an audit log.

## Production Deployment

- Backend must run behind HTTPS.
- `META_GRAPH_API_BASE_URL` must remain `https://graph.facebook.com` unless Meta changes the official endpoint.
- Use Atlas indexes via `npm run db:indexes`.
- Use GitHub scheduled jobs or a host scheduler for reminders/retries.

## Troubleshooting

- `Embedded Signup is not configured`: set `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `VERIFY_TOKEN`.
- `Invalid state`: restart the signup flow; states expire after 10 minutes and are one-time use.
- `No accessible phone number`: Meta did not grant WABA/phone access or the selected phone is not part of the returned WABA.
- Webhook ignored: `phoneNumberId` is not connected or connection status is not `connected`.
