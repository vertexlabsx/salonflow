# Meta Production Checklist

## Local Development

- Use `WHATSAPP_PROVIDER=mock`.
- No Meta credentials are required.
- Booking flow works end-to-end with database logs only.

## Test Number

- Create a Meta app with WhatsApp product.
- Use Meta's official test resources and test recipients.
- Set `WHATSAPP_PROVIDER=meta_test` only in a non-production environment.
- Configure `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET`.

## One Real Salon

- Business must pass Meta business verification where required.
- Phone/display name must be approved by Meta.
- Webhook URL: `https://<api-host>/api/v1/whatsapp/webhook`.
- Verify token: `VERIFY_TOKEN`.
- App secret/signature validation must be enabled.
- Templates required for business-initiated confirmations/reminders outside the allowed customer service window.

## Multi-Salon

- Each salon connects through Embedded Signup from SalonFlow.
- Never reuse one global phone number across salons.
- Validate every `phoneNumberId` through Meta before storing.
- Confirm `WhatsAppConnection.phoneNumberId` unique index exists via `npm run db:indexes`.
- Test two salons with the same customer phone; customers must remain separate by `salonId`.

## Tech Provider / Scale

Production multi-business onboarding may require Meta App Review, Advanced Access, Tech Provider configuration, and permissions approved by Meta. Do not bypass these requirements.

Expected permission areas for the current Embedded Signup/Tech Provider flow include WhatsApp business management, WABA/phone access, messaging, webhooks, and business management. Confirm exact current permission names in Meta's official docs/dashboard before submission because Meta changes permission names and review requirements.

## Blockers That Code Cannot Fake

- Meta App Review approval.
- Advanced Access / Tech Provider eligibility.
- Business verification.
- Phone number eligibility and registration.
- Display name approval.
- Template approval.
- Meta platform outages or policy restrictions.

## Validation Before Go-Live

1. `npm run prod:check` passes.
2. `npm run db:indexes` completes.
3. Owner can start Embedded Signup.
4. Callback creates a connection without exposing tokens.
5. Webhook signature validation rejects bad signatures.
6. Incoming message routes by `phoneNumberId` to the correct salon.
7. Same customer phone can book in two salons independently.
8. Outbound confirmation uses the connected salon's `phoneNumberId`.
9. Disconnect prevents outbound messages.
10. Template-based messages are configured before business-initiated production sends.
