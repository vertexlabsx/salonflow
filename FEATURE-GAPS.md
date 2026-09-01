# Feature Gap Analysis — vs Salonist, Dingg, Zenoti

> Comparison researched primarily against **Dingg**, with reference to Salonist and Zenoti.
> Status updated: as of the mobile/queue + manager-system + self-booking/promos/deposits work.

## Build status (what has since been shipped)

This file started as analysis-only, but most high-value gaps are now **built**:

- **Online client self-booking portal** — ✅ built (public `/book`, only real available slots, WhatsApp-confirmed).
- **Client cancel / reschedule self-service** — ✅ built (public `/book` manage flow, phone-verified, WhatsApp-notified).
- **Round-robin / first-available auto-assign** — ✅ built via the availability engine's least-loaded staff picker (client can also choose no staff).
- **Referral program + coupon/discount-code engine** — ✅ built (owner "Coupons & Referrals" page, redeem at billing).
- **Deposit / pre-authorization to lock appointments** — ✅ built + owner-configurable (Booking & deposits in Settings).
- **Waitlist + auto-fill** — ✅ existed in the backend; surfaced/confirmed (always-on, auto-promotes on slot release).
- **No-show / cancellation policy settings** — ✅ existed in the backend; surfaced in owner Settings.
- **Birthday / special-occasion + referral + deposit WhatsApp automations** — ✅ existed; surfaced in owner Settings.
- **Expense ledger / accounting / GST-tax reports** — ✅ built (owner GST & Expenses page, expense CRUD, GST liability/input-credit report).
- **Recurring / subscription appointments** — ✅ built (owner create flow can generate weekly/monthly repeats with availability validation).
- **Gift-card gifting** — ✅ built end-to-end in owner mobile app (`/owner/commerce` create/list/redeem/status).
- **Bundles & combo deals** — ✅ built end-to-end in owner mobile app (`/owner/commerce` create/list/status using real service options).
- **Automated review / reputation request workflow** — ✅ built in Client 360 (WhatsApp review-link trigger; Google reply sync still requires Google provider setup).
- **Per-service before/after photography records** — ✅ built in Client 360 (add/list/delete URL-backed before/after records).
- **Vendor / wholesale purchase orders & supplier tracking** — ✅ built end-to-end in owner mobile app (`/owner/purchase-orders` create/list/status).
- **Busy/idle hour heatmaps** — ✅ built end-to-end in owner mobile app (`/owner/busy-hours`) from real appointment data.
- **Manual split payments, invoice voiding and tips** — ✅ built end-to-end in owner mobile Billing (`/owner/billing`); Razorpay/terminal hardware capture remains external-provider dependent.

## Deferred (explicitly NOT building — small company)

- **Email marketing / drip automation** — ❌ **Deferred.** We are a small team; WhatsApp already covers outreach. Adding an email provider is only worth it at scale. Recorded decision — not planned.
- **In-app retail storefront / e-commerce** — ❌ **Deferred.** Small company; existing separate Shopify integration covers product sales. Not planned.

Both deferred items are tracked here so the decision is intentional and can be revisited if the business grows.

## What Solastio currently HAS (grounding)
From `src/app/app.routes.ts` (owner app + staff app + Shopify integration):

- **Owner:** dashboard, appointments (list/queue + recurring create), clients (Client 360 + review/photo workflows), staff, attendance, leave requests, chats, WhatsApp, revenue, reports, payroll, inventory, purchase orders, billing, GST & expenses, gift cards/bundles, busy hours, marketing, notifications, roles/permissions, branches, settings.
- **Staff:** dashboard, appointments, business, queue, clients (manager create/edit), tasks, attendance, roster, performance, leaderboard, notifications, reports, calendar, chat, payroll, leaves, profile, settings.
- **Client data:** wallet, loyalty, membership, packages — present.
- **Messaging:** WhatsApp outreach + internal/team chat.
- **Commerce:** separate Shopify admin + storefront integration (first-party, not in-app retail).

## Feature gaps NOT in our system

### Client-facing / appointments
- Client **self-booking portal / online booking widget** (clients book their own slot). We only book from owner/staff side.
- **Round-robin / auto-assign** staff when client books without a preference.
- **Waitlist auto-fill** (auto-promote waitlist when a slot opens).
- **Cancellation / reschedule self-service** by the client.
- **No-show / late-cancel** policy settings with automated penalty tracking.
- **Recurring / subscription appointments** — ✅ built after this analysis was created.

### Client CRM & loyalty
- **Client 360 timeline** (all touchpoints: visits, purchases, notes, photos, planned next visit). Partial — history/purchases exist in client detail.
- **End-to-end pre-visit / reminder + post-visit follow-up automation** (SMS/WhatsApp drip). We have WhatsApp/outreach but not full journeys.
- **Birthday / special-occasion campaigns** with automated offers.
- **Referral program** with earning/share links.
- **Lapsed / re-engagement** senders for "next appointment".

### Marketing & growth
- **Email marketing / drip automation campaigns** (we lean WhatsApp; email missing).
- **Automated review / reputation management** — ✅ review solicitation built via WhatsApp link; reply/sync requires Google provider setup.
- **Landing pages / link-in-bio** for promos.
- **Coupon / discount-code engine** (percentage, BOGO, first-visit, minimum-spend rules).

### Commerce & products
- **In-app retail storefront / e-commerce** for salon products (only separate Shopify integration; no first-party product store in-app).
- **Gift-card gifting** — ✅ built after this analysis was created.
- **Bundles & combo deals** — ✅ built after this analysis was created.

### Operations
- **SMS gateway** beyond WhatsApp/chat (broadcast, service alerts).
- **Multi-location call-center / central booking desk**.
- **Appointment confirm calls / IVR**.
- **Vendor / wholesale purchase orders & supplier tracking** — ✅ built after this analysis was created.
- **Per-service before/after photography** stored on the client record — ✅ built after this analysis was created.

### Payments & finance
- **Deposit / pre-authorization** to lock appointments.
- **POS terminal billing** — ✅ manual split payments, tips and invoice voiding are built; Razorpay/terminal hardware capture remains provider-dependent.
- **Recurring auto-billing** for subscription/membership plans (membership stored; recurring billing not wired to the billing engine).
- **Expense ledger / accounting / GST-tax reports** — ✅ built after this analysis was created.

### Analytics & AI
- **AI revenue forecasting / demand prediction** (Dingg-style). AI insights exist; forecasting does not.
- **Anomaly / shrinkage / theft detection** on inventory vs sales.
- **Google Business Profile / directory listing sync** (hours, holidays, prices).
- **Busy/idle hour heatmaps** for staffing & scheduling — ✅ built after this analysis was created.

## Recommended priorities
1. **Online client self-booking** — ✅ DONE (highest impact became the shipped portal).
2. **Waitlist auto-fill** — ✅ DONE (backend already had it; now surfaced).
3. **No-show / cancellation policies** — ✅ DONE (surfaced in Settings).
4. Referral program — ✅ DONE. Deposit/pre-auth — ✅ DONE.
5. Recurring auto-billing — ⏳ integration pending (only meaningful once memberships scale and real payment mandates are configured).

### Genuinely remaining (from the list above), with small-company stance
- **Email marketing** — deferred (small team, WhatsApp covers outreach).
- **In-app retail store** — deferred (Shopify integration already exists).
- **Recurring / subscription appointments** — ✅ DONE.
- **Expense ledger / GST-tax reports** — ✅ DONE.
- **POS terminal billing (split pay/tips)** — ✅ manual split payments and tips are built; Razorpay terminal capture remains provider-dependent.
- **Gift-card gifting, bundles, purchase orders, client photos, heatmaps, review requests** — ✅ DONE.
- **AI forecasting, call-center/IVR, Google Business sync, SMS gateway, landing-page hosting** — provider/infrastructure dependent; considered low priority for a small company.
