# Solastio API Contract Coverage

## Verified Backend Quality Gates

The Rust workspace is expected to pass:

```bash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Flutter Frontend Quality Gates

The Flutter app is expected to pass:

```bash
flutter analyze
flutter test
flutter build windows --dart-define=SOLASTIO_API_BASE=<backend-url>
```

## Staff App Coverage

| Area | Backend endpoints | Frontend status |
|---|---|---|
| Auth | `/api/v1/auth/login`, `/refresh`, `/logout`, `/csrf` | Login/logout/restore wired |
| Today | `/api/v1/staff-os/mobile/today` | Dashboard wired with cache fallback |
| Attendance | `/attendance`, `/clock-in`, `/clock-out`, `/break-start`, `/break-end` | History + actions + offline queue |
| Tasks | `/api/v1/staff-os/tasks/:task_id` + Today task payload | List + status actions + offline queue |
| Appointments | `/api/v1/appointments`, `/appointments/:id/status` | List/create/status/detail-from-list |
| Roster | `/api/v1/staff-self/calendar`, `/calendar/:schedule_id` | Calendar list wired |
| Leaves | `/api/v1/staff-os/leaves` | List + apply form |
| Payroll | `/api/v1/staff-os/mobile/payroll` | List wired |
| Clients | `/api/v1/catalog/customers` | Search/create/detail wired |
| Services | `/api/v1/catalog/services` | Used by appointment creation |
| Chat | `/api/v1/team-chat/conversations`, `/messages`, `/receipts` | Conversation list/messages/send/receipts wired |
| Notifications | `/api/v1/mobile/notifications`, `/notifications/:id` | List + mark read wired |
| Realtime | `/api/v1/realtime/` | Status visible in Settings |
| Push | `/api/v1/mobile/push-config`, `/devices`, `/push-subscriptions` | Push config + manual registration wired |

## Owner Console Coverage

| Area | Backend endpoints | Frontend status |
|---|---|---|
| Dashboard | `/api/v1/owner-console/dashboard` | Metrics wired |
| Appointments | `/appointments`, `/appointments/:id`, action endpoints | List/create/actions/reschedule/invoice wired |
| Branches | `/branches`, `/administration/branches` | List/create/edit/status wired |
| Services | `/administration/services` | List/create/edit/status wired |
| Access/users | `/administration/access`, `/administration/users` | List/create/edit wired |
| Staff/leaves | `/people/staff`, `/people/leaves`, approve/reject | List + approve/reject wired |
| Clients | `/operations/clients` | List/create/edit wired |
| Finance invoices | `/finance/invoices`, payments/tips/void | List + payment/tip/void wired |
| Expenses | `/finance/expenses` | List/create wired |
| Tax/GST | `/finance/tax-settings`, `/finance/gst-report` | List/update/report wired |
| Purchase orders | `/operations/purchase-orders` | List/create wired |
| Gift cards | `/commerce/gift-cards` | List/create/status wired |
| Bundles | `/commerce/bundles` | List/create/status wired |
| Promos | `/promos` | List/create/status wired |
| Payroll runs | `/people/payroll/runs` | List/status wired |
| Audit logs | `/administration/audit-logs` | List wired |
| Analytics | `/analytics/busy-hours` | List/report wired |
| WhatsApp intelligence | `/whatsapp/intelligence`, `/whatsapp/bot-settings` | List/update wired |

## Remaining Non-Code Release Gates

These cannot be completed without runtime credentials/devices:

1. Real tenant seed data and live backend walkthrough.
2. Real FCM/APNs/WebPush token registration.
3. Production signing assets for Android/iOS/Windows.
4. Production API URL, SSL, and deployment environment.
