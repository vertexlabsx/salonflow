# Solastio Rust Rebuild Audit And Architecture

## Current Application Map

Solastio is currently an Angular 20 + Ionic frontend backed by an Express TypeScript API. The backend uses MongoDB through Mongoose, JWT access tokens, hashed refresh tokens, CSRF cookies, idempotency keys, RBAC middleware, rate limiting, Helmet, CORS allowlists, and structured HTTP error helpers.

The existing application must remain the behavioral source of truth during the Rust rebuild.

## Existing Runtime Stack

| Area | Current Implementation | Rebuild Requirement |
| --- | --- | --- |
| Frontend | Angular 20, Ionic, Capacitor, route-level lazy pages | Redesigned UI, preserve workflows, can be served separately or by Rust static layer |
| Backend | Express 4, TypeScript, Zod validation | Rust, Axum, Tokio, typed DTOs, centralized errors |
| Database | MongoDB, Mongoose schemas and indexes | Preserve MongoDB and collection behavior |
| Auth | JWT access token, hashed refresh tokens, secure refresh cookie, CSRF | Preserve semantics with Rust typed auth layer |
| Authorization | Staff app permission grants, CRM permissions, owner role handling, Shopify admin/client roles | Preserve permission matching and guards |
| Integrations | Meta WhatsApp, Shopify, Razorpay, Web Push, OpenAI concierge | Preserve providers and webhook behavior |
| Jobs | Cleanup, appointment reminders, WhatsApp retry/nudges/reminders, Shopify automation | Rebuild as Tokio workers or separate binaries |

## API Map

All existing API routes are mounted under `/api/v1`, with provider webhooks also mounted at `/webhook` and `/shopify/webhooks`.

| API Surface | Existing Base Path | Purpose | Auth |
| --- | --- | --- | --- |
| Health | `/api/v1/health`, `/api/v1/ready` | Liveness and Mongo readiness | Public |
| Auth | `/api/v1/auth` | CSRF, login, refresh, logout, TOTP, passkey compatibility | Mixed |
| Staff OS | `/api/v1/staff-os` | Staff mobile workspace, attendance, clients, leaves, payroll, targets, tasks | JWT + RBAC |
| Staff Self | `/api/v1/staff-self` | Roster, preferences, shift swaps, self-service workflows | JWT |
| Team Chat | `/api/v1/team-chat` | Conversations, message search, receipts, private owner placeholder | JWT + RBAC |
| Appointments | `/api/v1/appointments` | Unified appointment list, create, status transitions | JWT + RBAC |
| Catalog | `/api/v1/catalog` | Branch/service/customer options and catalog mutation surfaces | JWT + RBAC |
| Mobile Push | `/api/v1/mobile` | Push device registration and notification support | JWT |
| Realtime | `/api/v1/realtime` | Event polling or realtime delivery surface | JWT |
| Owner Console | `/api/v1/owner-console` | Owner dashboards, appointments, clients, staff, finance, inventory, settings, reports | JWT + RBAC |
| WhatsApp | `/api/v1/whatsapp`, `/webhook` | Meta webhook, booking automation, templates, embedded signup, deposits | Mixed |
| Shopify Automation | `/api/v1/shopify-automation`, `/shopify/webhooks` | Shopify stores, flows, events, campaigns | Mixed |
| Shopify Product Auth | `/api/v1/shopify-api/auth` | Shopify admin/client login and refresh | Mixed |
| Shopify Admin | `/api/v1/shopify-api/admin` | Product admin console | Shopify admin JWT |
| Shopify Client | `/api/v1/shopify-api/client` | Product client console | Shopify client JWT |
| Self Booking | `/api/v1/self-booking` | Public branch/service/staff/slot lookup, book/cancel/reschedule | Public tenant-scoped |

## Database Map

Current database technology is MongoDB and must be preserved. Existing collections are represented by Mongoose models for users, salons, branches, services, schedules, appointments, slot locks, waitlist, customers, invoices, attendance, payroll, leaves, tasks, targets, tips, expenses, purchase orders, gift cards, bundle deals, client photos, notifications, audit logs, idempotency keys, team chat, conversations, WhatsApp records, and Shopify records.

Important existing behavior:

| Model | Key Behavior To Preserve |
| --- | --- |
| User | Unique `(salonId, loginIdNormalized)`, partial unique `(salonId, email)`, hashed refresh tokens, branch access, status, TOTP, permissions |
| Appointment | Status workflow: `booked`, `confirmed`, `arrived`, `in_service`, `completed`, `cancelled`, `no_show`; optimistic version checks |
| AppointmentSlotLock | Prevent duplicate concurrent slot booking |
| Customer | Normalized phone, tags, preferences, visit/spend memory |
| OwnerSettings | Branch-scoped settings for localization, booking, WhatsApp policy, interface defaults |
| IdempotencyKey | Prevent duplicate mutating requests |
| WhatsApp records | Inbound/outbound status, sessions, templates, connections, webhook events |
| Shopify records | Stores, users, events, flows, executions, audiences, campaigns |

## Permission Map

Permission matching currently supports exact grants, wildcard `*`, admin grants such as `admin:*`, action/resource style permissions, any/every requirements, CRM permission fallback, and owner-role compatibility. Important grants include `read:appointments`, `create:appointments`, `update:appointments`, `read:clients`, `create:clients`, `update:clients`, `read:staff`, `write:staff`, `allow:staff-checkin-checkout`, `read:payroll`, `read:finance`, and `admin:*`.

## Feature Parity Matrix

| Feature | Existing Behavior | API | Database | Permissions | New Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Staff login/session | Tenant login, password, optional TOTP, refresh rotation | `/auth` | User, Salon | Active user, branch access | `auth` crate + Mongo repo | Scaffolded |
| Staff dashboard | Today workspace, appointments, tasks, summaries | `/staff-os/mobile/today` | Appointment, Task, Attendance | `read:appointments` | Application service | Pending parity implementation |
| Staff appointments | List, create walk-in/CRM, transition status | `/appointments` | Appointment, Service, Customer | Read/write appointment grants | Application service | Pending parity implementation |
| Staff attendance | Clock in/out, breaks, overtime | `/staff-os/attendance*` | Attendance | `allow:staff-checkin-checkout` | Attendance domain | Pending parity implementation |
| Staff clients | Client details, history, spend, purchases | `/staff-os/clients/:id` | Customer, Appointment, Invoice | `read:clients` | Client service | Pending parity implementation |
| Staff leaves | List balances, request leave | `/staff-os/leaves` | Leave | `read:appointments` legacy requirement | Leave service | Pending parity implementation |
| Staff payroll/performance | Payroll, targets, leaderboard, reports | `/staff-os/mobile/payroll`, `/targets` | Payroll, Target, Attendance | Staff/finance grants | People service | Pending parity implementation |
| Team chat | Conversations, messages, search, receipts | `/team-chat`, `/owner-console/operations/chats` | Conversation, ConversationMessage | Read/write appointment grants | Chat service | Implemented |
| Owner dashboard | Business overview by branch/period and busy-hour analytics | `/owner-console` | Appointment, Invoice, Attendance | Owner auth + module perms | Owner analytics service | Dashboard and busy-hours implemented |
| Owner appointments | Search/filter/page/detail/create/update/reschedule/cancel/check-in/POS hooks | `/owner-console/appointments` | Appointment, Customer, Service, User, Branch | Appointment grants | Owner appointment service | Listing/options/detail/create/update/reschedule/status shortcuts, recurrence create, and finance POS invoice hooks implemented |
| Owner clients | Client CRM, photos, benefits, spend | `/owner-console` | Customer, ClientPhoto, Invoice | Client grants | CRM service | Client list/detail/create/update/opt-out/photo metadata and WhatsApp review-request send implemented |
| Owner staff | Staff listing, roles, attendance, payroll, leave approvals | `/owner-console` | User, Attendance, Leave, Payroll | Staff/payroll grants | People service | Staff listing, payroll runs, leave list/detail/approve/reject and access/user/role admin implemented |
| Finance/GST/revenue | Expenses, invoices, GST reports, revenue reports | `/owner-console` | Expense, Invoice, Tip | Finance grants | Finance service | Core finance and billing aliases implemented |
| Inventory and purchase orders | Inventory-like purchase order workflows | `/owner-console` | PurchaseOrder | Owner/module grants | Operations service | Purchase orders implemented |
| Promos | Create, list, redeem, status, redemptions | `/owner-console` | PromoCode, PromoRedemption | `admin:*` for write | Promo service | Implemented |
| Settings/Admin catalog | Branch settings plus admin branch/service/access management | `/owner-console/settings`, `/owner-console/administration/*` | OwnerSettings, Branch, Service, User | Owner/module grants | Settings/catalog/owner service | Settings, branch/service admin, access/users/role placeholder implemented |
| Notifications | App notification list/status | `/mobile`, `/staff-self` | Notification, PushDevice | Auth | Notification service | Mobile/staff-self list/status, push-config/devices/push-subscriptions registration, and live Web Push delivery implemented |
| Public self-booking | Branches, services, staff, slots, book/cancel/reschedule | `/self-booking` | Branch, Service, Schedule, Appointment, Customer | Public tenant scope | Public booking service | Pending parity implementation |
| WhatsApp booking | Meta webhook, guided booking, smart parse, customer memory, deposits, waitlist | `/whatsapp`, `/webhook` | WhatsApp*, Appointment, Customer, Waitlist | Mixed | WhatsApp integration service | Webhook verification/signature check/raw event ingestion/inbound capture/status updates, text and template outbound send primitives, conversations list/messages, owner review-request send + reply handling, guarded OpenAI concierge replies, guided booking/deposits, smart date/time parse, customer memory, waitlist add/offer/claim, and rebooking/abandoned nudges implemented |
| Shopify product app | Admin/client auth and product console | `/shopify-api/*` | ShopifyUser | Shopify role | Shopify product service | Pending parity implementation |
| Shopify automation | Store connection, webhooks, flows, campaigns | `/shopify-automation`, `/shopify-api/*`, `/shopify/webhooks` | Shopify* | Staff permission + webhook signatures | Shopify automation service | Shopify product auth, staff-auth automation mirror, read-only admin/client APIs, OAuth exchange/encrypted token storage/store test/webhook registration, customer import/opt-out, audiences, campaign preview/create/send, install URL, disconnect, webhook signature verification/event ingestion/execution queueing, flow seed/create/update/node mutations, and due execution loop implemented |

## New Rust Architecture

The rebuild is scaffolded as a Cargo workspace in `NEW SOLASTIO APP/app`.

```text
app/
├── crates/
│   ├── api/              # Axum routes, middleware, DTOs
│   ├── application/      # Use-cases and workflow services
│   ├── auth/             # JWT, refresh tokens, CSRF, RBAC semantics
│   ├── database/         # MongoDB client and repositories
│   ├── domain/           # Business entities and rules
│   ├── infrastructure/   # HTTP clients, logging, external providers
│   ├── integrations/     # WhatsApp, Shopify, Razorpay, Web Push, OpenAI
│   └── shared/           # Config, errors, response envelope, primitives
├── docs/
├── migrations/
└── tests/
```

Layering rule:

```text
API -> Application -> Domain -> Repository traits -> Database/Integrations
```

## UI Redesign Direction

The new UI should use a restrained editorial operations aesthetic: off-white and graphite surfaces, precise spacing, strong numeric typography, clear command surfaces, density only where business data needs it, and page-specific compositions rather than repeated card grids.

Design system primitives: buttons, inputs, selects, command search, tables, badges, tabs, modals, drawers, toasts, alerts, pagination, skeletons, empty states, error states, and confirmation dialogs.

Each page family must have a distinct information architecture while sharing the same tokens.

## Implementation Notes

This first rebuild commit intentionally does not delete or overwrite the existing app. The Rust workspace starts with production defaults, health/readiness APIs, config loading, Mongo connectivity, typed error responses, and parity placeholders. Feature-by-feature parity should now be implemented against this audit matrix, with tests comparing old and new behavior.

Latest batch:
- CORS now honours configured `CORS_ORIGINS` (no longer permissive).
- `RequestContext` captures `ip`/`user_agent` from headers; finance audit writes and the new `FinanceService::write_audit` persist them.
- Owner appointment status transitions write `appointment.status` audit events.
- WhatsApp conversations list and per-phone messages endpoints (`/whatsapp/conversations`, `/conversations/:phone/messages`) implemented against `customers`/`whatsappinbounds`/`whatsappoutbounds`.
- Mobile push endpoints (`/mobile/push-config`, `/mobile/devices`, `/mobile/push-subscriptions`) store into `pushdevices`.
- Owner client review-request (`/owner-console/operations/clients/:id/review-request`) sends a WhatsApp text message using the real outbound send path.

Guided booking + deposits (latest):
- WhatsApp guided booking bot: inbound text replies drive a persisted state machine (`whatsappbookingsessions`) through branch → service → staff → date → time → confirm → `SelfBookingService::book`. Reuses `branches/services/staff/slots/book`. STOP/START opt-out handling; `Cancel` clears the session.
- Razorpay deposit flow: `create_razorpay_payment_link` (Payment Links API, HTTP Basic auth, paise amounts), `verify_razorpay_webhook` (HMAC-SHA256, hex), and `POST /api/v1/whatsapp/razorpay/webhook` handling `payment_link.paid` → confirm appointment, release slot locks on expiring holds.
- `AppointmentRepository` gained: raw-doc appointment reads (`appointments_raw`), `confirm_deposit_payment`, `deposit_appointment`, `booking_deposit_config` (from `ownersettings`), `apply_deposit_hold`.
- `WhatsAppRepository` gained: booking session CRUD (`get_booking_session`/`upsert_booking_session`/`clear_booking_session`), `salon_for_phone_number_id` (phone→salon resolution), `set_customer_opt_out`.
- Guided booking books the appointment and, when a deposit is configured + Razorpay is configured, creates a payment link and moves the appointment to a `pending`/`paymentStatus=pending` hold awaiting the webhook.
- Smart parse + memory: Rust WhatsApp bot now understands Hinglish date words (`kal`, `parso`, `aaj`), weekdays, common exact times/day-parts (`4pm`, `shaam`, `subah`, `asap`), filters offered slots accordingly, supports fuzzy service/staff name selection, and reuses `favoriteServiceIds`/`preferredStaffIds` for “same as last time” prompts. Confirmed WhatsApp bookings update customer memory fields (`visitCount`, `lastBookedAt`, `interactionStatus`, `tags`, `favoriteServiceIds`, `preferredStaffIds`), including Razorpay-confirmed deposit bookings.

Waitlist/rebooking/abandoned nudges (latest):
- WhatsApp bot creates `waitlists` entries when no slot matches the selected service/date/time preference, with de-dupe against active waiting/offered entries.
- Appointment cancellation offers the opened slot to the earliest matching waitlist entry, creates a 15-minute pending `whatsapp_waitlist` hold, marks the waitlist entry `offered`, and sends a real WhatsApp waitlist message. Incoming `BOOK` claims the offer and confirms the hold.
- A Rust background loop runs WhatsApp rebooking and abandoned-booking nudges every 15 minutes, using `whatsappoutbounds.metadata.dedupeKey` for parity with Express de-dupe behavior.

OpenAI concierge + review replies (latest):
- Owner review-request sends now mark outbound metadata with `source=review_request`; inbound positive/negative replies within 7 days tag customers (`happy_customer`/`rebook_candidate` or `service_recovery`/`negative_feedback`) and send a real WhatsApp response.
- When `WHATSAPP_CONCIERGE_ENABLED` and `OPENAI_API_KEY` are configured, free-form non-booking inbound messages can receive a short same-language OpenAI receptionist reply. Booking/price/service/reschedule signals intentionally fall back to the deterministic booking flow to avoid invented availability/prices.

Appointment recurrence/POS (latest):
- Owner appointment create now accepts `recurrence` (`none`/`weekly`/`monthly`, `interval`, `count`, `until`) and creates repeated appointments with the same response envelope shape (`recurrence.created`, `recurrence.appointmentIds`).
- Finance POS hooks were already present in Rust via invoice-from-appointment, invoice payment, tip, and void routes under `/owner-console/finance/invoices`.

Shopify execution loop (latest):
- A Rust background loop processes due `shopifyflowexecutions` every 60 seconds and webhook queueing kicks an immediate run for the affected salon.
- Implemented node handling for `wait`, `condition`, `whatsapp_template`, `stop`, retry backoff, stale lock recovery, and metrics increments for completed/messages sent.

Cleanup/reminders (latest):
- WhatsApp nudge loop now also expires pending appointment holds and waitlist offers, deletes stale slot locks, and sends 2-hour appointment reminders with outbound `dedupeKey` protection.

Final backend sweep (latest):
- Replaced the last Rust backend placeholder (`/api/v1/realtime`) with a production-safe realtime status endpoint returning transport/database/server-time readiness data.
- Code scan found no remaining Rust `placeholder(...)`, `todo!()`, `unimplemented!()`, or “not implemented” markers in `app/crates`.
- Final verification passed: `cargo fmt`, `cargo check`, and `cargo test --workspace`.

Web Push delivery (latest):
- Rust API now sends real Web Push notifications from stored browser subscriptions using VAPID ES256 JWTs and RFC 8291 `aes128gcm` payload encryption.
- `PushDeviceRepository` gained user-device lookup and stale-device delete helpers; delivery removes devices when push providers return 404/410, matching Express `web-push` behavior.
- Staff push notifications are wired into appointment create and appointment status-change handlers through staffId → login user resolution.
