# SOLASTIO Backend Audit Report

Rust backend (`NEW SOLASTIO APP/app/crates`) vs. legacy Node.js app (`old app/server/src`).
Scope: correctness, RBAC, multi-tenancy, finance math, timezone handling, DB layer, panics, HTTP behaviour.
Each finding references `file:line`. Severity: **CRITICAL / MAJOR / MINOR / OK**.

---

## 1. Application Core

### 1.1 Appointment state machine — NOT enforced (MAJOR)
- `domain/src/appointment.rs:15-25` defines `AppointmentStatus::can_transition_to` with the full state machine (`Booked→Confirmed|Arrived|Cancelled|NoShow`, etc.). **This is dead code — nothing calls it.**
- `application/src/appointments.rs:418-436` (`transition_status`) validates only that the caller has a permission, then calls `repository.transition_status` directly.
- `database/src/repositories.rs:592-609` `transition_status` does a version-guarded `$set {status}`/`$inc {version}` with **no enum validation** on the incoming `status` string. Any arbitrary string (`"garbage"`, `"paused"`) is written to the DB; invalid transitions such as `Booked→Completed` or `NoShow→Arrived` succeed.
- **Fix:** validate `request.status` against known enum values and enforce `can_transition_to` from the previous status before writing.
- **Old app:** appointment.model.ts:4,62 enumerates 10 statuses but the Node side also permits raw updates; the Rust domain enum is a regression because it *exists* but is unused.

### 1.2 Timezone bug — branch working hours compared against UTC (MAJOR)
- `application/src/appointments.rs:676-700` `validate_branch_hours` uses `start_at.weekday()` and `start_at.hour()` where `start_at` is UTC. Branch `hours` (`open`/`close`, e.g. `"10:00"`–`"21:00"`) are local (IST) times, but they are compared against UTC wall-clock. `branch.timezone` (default `Asia/Kolkata`, catalog.rs:151-153) is **never used**.
- Result: around/after 21:00 IST (== 15:30 UTC or later) any valid booking previous day is compared to a wrong weekday/hour; bookings at e.g. 18:30 UTC (=00:00 next-day IST) are rejected or mis-dated.
- **Fix:** convert `start_at` to the branch timezone (chrono_tz) before `.weekday()`/`.hour()`.
- **Old app:** `shared/business-date.ts` does all day-boundary math in the salon timezone (businessDateIn, zonedWeekday, zonedDayRange) — the new app regressed this.

### 1.3 Appointment status — blocking statuses & booking flow (OK / notes)
- `database/src/repositories.rs:1485-1487` blocking status set `["pending","booked","confirmed","arrived","in_service"]` — consistent with old app.
- `available_staff` (appointments.rs:464-537) and `create` (appointments.rs:119-197) each do schedule/leave/overlap/lock checks before select; overlap is staff-level only (no chair/room concept — old app had `chair`, appointment.model.ts:20). **Minor feature-plane gap**, not a correctness bug.

### 1.4 Owner update / reschedule skip conflict validation (MAJOR)
- `appointments.rs:307-377` `owner_update` and `appointments.rs:379-416` `owner_reschedule` set `branchId`/`staffId`/`startAt`/`endAt` via `update_by_id` (version-guarded `$set`) with:
  - **No overlap check** against existing appointments for the target staff/branch/time window.
  - **No branch-hours check** (validate_branch_hours is only called in `create`, appointments.rs:160).
  - Only `create` validates branch hours; `reschedule` in self_booking does check overlap (self_booking.rs:481-495) but owner routes do not.
- **Fix:** run overlap + branch-hours validation in `owner_update`/`owner_reschedule` when time/staff/branch changes.

---

## 2. RBAC & Owner Enforcement

### 2.1 `require_owner` is role-based, bypasses permissions/branch scope (MAJOR)
- `owner.rs:1791-1798`, duplicated `finance.rs:2620-2627` — `require_owner` checks only that `role` (`owner|admin|superadmin`, after stripping `_- ` and lowercasing). It does **not** consult the RBAC permission grant list.
- `owner.rs:363-367` `branches` and `owner.rs:816-827` `settings` call **only** `require_owner` with no `require_any(...)` — a user whose role string is `admin` but who holds **no** admin grant permissions is still allowed; all-root listing regardless of `branch_ids` scope (branches/settings list whole-salon data, ignoring `context.branch_ids`).
- `finance.rs` mirrors the same helper (finance.rs:2620-2627) for every finance route.
- **Fix:** require an explicit `admin:*` / `read:settings` grant, and respect `context.branch_ids` on branches/settings reads.

### 2.2 New staff users cannot clock in/out (MAJOR)
- `owner.rs:1366-1378` `default_user_permissions` = `read/create/update:appointments` + `read/create/update:clients`. It does **not** include `allow:staff-checkin-checkout` (nor `read:staff`/`write:staff`).
- `staff.rs:288-291` `clock_in` and `staff.rs:324-327` `clock_out` require `["allow:staff-checkin-checkout","read:staff","write:staff"]`.
- `create_user` (owner.rs:1011-1077) seeds `staff_app_permissions`/`crm_permissions` with `default_user_permissions()`, so **any newly created staff cannot check in or clock out** unless an admin later upgrades grants.
- Additionally `permission_groups()` (owner.rs:1388-1407) exposes only **appointments + clients** groups — `allow:staff-checkin-checkout` is not even offered in the permission UI, so it's effectively not grantable through the console.
- **Old app:** rbac.ts:17 scopes `staff-checkin-checkout` → `staff-app-checkin-checkout` as a first-class policy; the new app dropped it from the default set and permission catalogue.

### 2.3 Transition/update permission checks (OK)
- `appointments.rs:124-126` create requires `create:appointments` **or** `update:appointments` (loose but acceptable). `transition_status` requires `update` or `create`. `owner_update`/`reschedule` require `update:appointments` (appointments.rs:313,385). Reasonable.

### 2.4 `has_permission` wildcard semantics (OK)
- `domain/src/permission.rs:1-20` correctly handles `*`, `admin:*`, `action:*`, `admin:resource`, and legacy dot-aliases; matches old rbac.ts logic for the non-scoped path (the `staff-app-*` scoped path is not ported — see 2.2).

---

## 3. Finance

### 3.1 Payroll gross minutes never computed → payroll pays 0 (CRITICAL)
- `database/src/repositories.rs:2599-2611` `clock_out` sets only `{status, clockOutAt}`; it **never computes/writes `grossMinutes`**.
- `application/src/staff.rs:312` `clock_in` writes `gross_minutes: 0`; nothing ever updates it.
- `database/src/repositories.rs:4987-5008` `attendance_minutes_summary` aggregates `$grossMinutes` from attendance docs → always 0.
- `application/src/finance.rs:1720-1754` `generate_payroll_run` uses that summary → `gross_minutes = 0`, `gross_pay_paise = 0` for every staff member. **Payroll runs will always be zero pay.**
- **Fix:** compute `grossMinutes = clockOut − clockIn − break durations (- overtime) on clock_out`, persist it, and aggregate it in the payroll run.
- **Old app:** owner-console.routes.ts:809-818 aggregates `$grossMinutes` per staff AND computes `overtimeMinutes = max(0, grossMinutes - standardMinutes)`. The Node side wrote `grossMinutes` on clock-out; the Rust port dropped that write.

### 3.2 Overtime always 0 (MAJOR)
- `finance.rs:1750` sets `overtime_minutes: 0` unconditionally; no `standardMinutes` comparison as in old app (owner-console.routes.ts:817). Payslip (finance.rs:1860-1914) also just prints the stored 0.

### 3.3 Invoice from appointment — line total vs unit inconsistency (MINOR)
- `finance.rs:608-695` builds one line where `unit_amount_paise = net_paise` but `total_paise = gross_value`. For `prices_include_tax=true`, `subtotal = gross/(1+rate)`, `tax = gross − subtotal`, `grand = gross` (correct). For `prices_include_tax=false`, `net = gross − tax` but `total_paise = gross_value` (finance.rs:677) — a line whose unit excludes tax yet total includes it.
- GST report (finance.rs:918-927) uses `taxable = unit_amount * quantity = net`, so taxable underpins vs. old app's identical formula (old finance.service.ts:119) — the new code matches old behaviour, but the line-level `totalPaise` vs `unitAmountPaise` mismatch is internally inconsistent and can mislead clients (a `net` unit with `gross` total).

### 3.4 Invoice stubs — empty service/product ids, empty events (MINOR)
- `finance.rs:663-664` invoice line is created with `service_id: String::new()` and `product_id: String::new()` (no link back to the actual appointment services), so inventory/service analytics cannot trace the line. Detail JSON includes `"events":[]` (finance.rs:2269) and `"rate":0` in taxes (finance.rs:2266) — surfaced as hardcoded placeholders.

### 3.5 Payment, void, tips — semantics (OK/Minor)
- `repositories.rs:4062-4088` `record_payment`: guarded against void and over-payment (`dueAmountPaise: {$gte: amount}`); single-doc update is atomic. OK.
- `repositories.rs:4090-4106` `void_invoice`: uses pipeline `$set` referencing `$grandTotalPaise`, zeroes payments/paid, sets unpaid. OK. **Note:** voided-invoice payments are erased (not counted); old app retained a void trail. Minor.
- `record_tip` (finance.rs:502-570) blocks voided invoices; staff attribution defaults to appointment staff. OK.

### 3.6 Promo redemption — not idempotent / no de-dup (MAJOR)
- `finance.rs:1628-1718` `redeem_promo` increments `redemption_count` and `total_discount_paise` in the in-memory struct and writes via `update_promo_stats`, then inserts a `PromoRedemptionRecord`. **No uniqueness/idempotency key** (e.g. `appointmentId`+`promoId`) and the redemption write + stats update are two non-transactional writes. A double-tap or duplicate request can redeem the same promo more than the intended max_redemptions and create duplicate redemptions. The customer match is best-effort; `customer_id` default empty.
- **Old app:** `modules/whatsapp/idempotency` middleware exists (middleware/idempotency.ts) and promo-code.service.ts guards redemption — the Rust port does not carry idempotency.

### 3.7 Gift card redemption — no concurrent-dedup guard (MAJOR)
- `finance.rs:1255-1304` `redeem_gift_card` reads `find_active_gift_card` then calls `repositories.rs:4508-4528` `redeem_gift_card` which is a blind `find_one_and_update` **matching only `_id`** with `$set balancePaise`. Two concurrent redemptions on a card with balance 100 (each 70) can both pass the in-memory `amount_paise > balance` check and both write, ending with balance 30 and *over-spending 140 on a 100 card*. There is no `{$gte: amount}` guard and no version/compare-and-swap.
- **Fix:** guard with `{ "_id": id, "balancePaise": { "$gte": amount } }` and re-check.

### 3.8 Expense / purchase-order / audit (OK)
- `finance.rs:2087-2138` expense tax math `tax = amount*rate/10000` matches old finance.service.ts:31. `gst_report` (finance.rs:885-960) matches old logic. Audit path (finance.rs:2028-2056) is best-effort and non-failing. OK.

---

## 4. Multi-tenancy & Branch Scoping

### 4.1 Salon scoping on queries — mostly correct (OK)
- Nearly all DB queries filter on `salonId` + `_id` (e.g. repositories.rs:601,4080,4117,4541) and owner `branch_ids` scope via `branch_scope` (owner.rs:1811-1820, finance.rs:2597-2606). Good.
- **Exception:** `repositories.rs:4518-4527` `redeem_gift_card` matches **only `_id`** — no `salonId` filter (see 3.7). `promo_code_exists`, `list_gift_cards`, `update_gift_card_status`, `redeem_gift_card` in the service pass `salon_id`, but the repo redeem update omits it.

### 4.2 Branch scoping gaps on owner-only endpoints (MINOR)
- `owner.rs:365` `branches` and `owner.rs:823` `settings` ignore `context.branch_ids` (whole-salon listing), as noted in 2.1.

---

## 5. Self-Booking

### 5.1 No advance-book / cancellation window rules (MAJOR)
- `self_booking.rs:220-297` `slots` and `self_booking.rs:299-410` `book` have **no** advance-booking window (e.g. not past 24h/7d), no "same-day cutoff", and no minimum-notice. `book` accepts any future (or even erroneous) timestamp that passes `validate_branch_hours_at`.
- **Old app** enforces booking windows in policy/booking logic (`modules/whatsapp/policy.service.ts`). Regression.

### 5.2 Self-booking slots have no hold; slot_locks have no TTL/cleanup (MAJOR)
- `slots` (self_booking.rs:220-297) only *reads* `has_lock_overlap`; it does not create holds. `book` inserts `slot_locks` only at final confirmation (`repositories.rs:952-978 create_with_customer_and_locks` via `slot_instants`, ~5-minute interval).
- `appointmentslotlocks` collection is cleaned only for the WhatsApp/Razorpay deposit path (`run_expired_hold_cleanup`, api/main.rs:5874-5923, requires `status:"pending"` + `holdExpiresAt`). **Self-booking never creates `holdExpiresAt`**, so if a `booked` appointment is abandoned/cancelled the slot locks are never pruned → stale locks can block future bookings until the appointment itself is moved (cancel_public, reschedule_public do not delete locks in the self-booking path).
- **No TTL index** exists anywhere (see 8.2).

### 5.3 self_booking timezone — local date treated as UTC (MINOR/MAJOR)
- `self_booking.rs:573-582` `date_minutes_to_utc` builds a UTC timestamp from the local calendar date (`date.and_hms` + `from_naive_utc_and_offset`), ignoring the branch timezone, then `validate_branch_hours_at` (self_booking.rs:584-608) compares include `start_at.hour()` in UTC as well. Slot dates/hours shift by the branch offset — a 10:00 a.m. IST slot on a given date is emitted as 10:00 UTC (= 15:30 IST, out of hours). Same family as 1.2.

---

## 6. Staff / Attendance / Team Chat

### 6.1 Attendance business_date uses UTC (MINOR/MAJOR)
- `staff.rs:307` `business_date = chrono::Utc::now().date_naive()` — an IST punch after midnight belongs to the previous UTC day. Payroll/leave summary keyed by `businessDate` will attribute punches to the wrong date.
- `staff.rs:352-385` monthly/today attendance filtering, `staff_self.rs:95` `today = Utc now` and `staff_self.rs:99-104` `today_count` matches `starts_with("{today}T")` — fragile UTC-prefix string match; an appointment at 00:30 IST is counted as "yesterday".
- **Old app:** `shared/business-date.ts` computes business date in salon timezone; the Rust port uses UTC throughout.

### 6.2 Leave balances & overtime hardcoded (MAJOR)
- `staff_self.rs:322-329` `leave_balances` returns static `[{casual 12 used 0 balance 12}, {sick 6 used 0 balance 6}]` — never derived from actual approved leaves. Incorrect as soon as any leave is used.
- `staff_self.rs:300-320` `overtime_summary` returns `todayMinutes/weekMinutes/last30DaysMinutes` all hardcoded `0` (only `lifetimeMinutes` is computed). UI will show zeros.

### 6.3 Staff leave request — no overlap conflict check (MINOR)
- `staff.rs` `request_leave` (handler `staff_request_leave`, api/main.rs:1168) does not check for overlapping existing approved leave in the same window; duplicate/overlapping leave requests are not rejected. Owner `decide_leave` (owner.rs:533-591) does guard pending-only + versioning. OK there.

### 6.4 Team chat — private owner DM is a stub (MAJOR)
- `team_chat.rs:165-170` `private_owner` returns `{"created":false}` and creates nothing — the "DM the owner" feature is a non-implemented stub behind the `operations/chats/private` route (api/main.rs:584).
- `send_message` (team_chat.rs:86-117) requires `write:appointments` (an odd, non-semantic mapping) and sets `sender_name` empty; receipts (delivered_count/read_count) are coarse counters, not per-user.

### 6.5 Team chat conversations N+1 (MINOR)
- `team_chat.rs:58-64` loops conversations calling `count_messages` per item → N+1 query pattern; unread counting not batchable.

---

## 7. Catalog / Owner People

### 7.1 Branch/service/customer CRUD (OK)
- `catalog.rs:112-530` validates lengths/statuses, scopes by `salonId`, uses camelCase `$set` keys consistent with models. Branch default timezone set on create (catalog.rs:151-153). Service duration bounded 5–600 (catalog.rs:292). OK.
- `create_user` (owner.rs:1011-1077) sets password min 8, hash bcrypt cost 12, assigns `staff_id` = `"{login}_staff"` for non-owner. OK.

### 7.2 Clock overlap on breaks (MINOR)
- `repositories.rs:2613-2636` `start_break`/`end_break` allow only one open break at a time (guarded), but `clock_out` does not validate/close trailing open breaks, and gross minutes never account for break duration (see 3.1).

---

## 8. Database Layer

### 8.1 Collection & field names (OK)
- `repositories.rs` uses consistent caffeCase field names (`salonId`, `staffId`, `startAt`, `grandTotalPaise`, `loginIdNormalized`) everywhere, and `#[serde(rename_all="camelCase")]` on all models (models.rs passim). `appointments_raw` (repositories.rs:510) aliases the same `appointments` collection. Consistent.

### 8.2 No indexes / no TTL (MAJOR — performance)
- **Zero** `create_index`/`create_indexes` calls in the entire database crate (grep over lib.rs + repositories.rs returned nothing). No TTL index on `appointmentslotlocks` or holds.
- Every appointment overlap lookup (`find_overlap`, `has_lock_overlap`, `count_day_load`) and `slot_locks` insert/delete scans collections with no supporting index.
- **Old app:** explicit indexes (appointment.model.ts:88-89) plus `ops/sync-indexes.ts`. Regression → production query latency / lock contention as data grows.

### 8.3 Panic surface — object-id parsing (OK)
- Repos and services consistently map `ObjectId::parse_str` failures to `AppError::Validation` (e.g. finance.rs:2593-2595, owner.rs:1262-1264) and use `map_err(|_| AppError::Database)` on DB calls — no obvious unwrap/panic paths found in exercised code. The `.map_err(|_| AppError::Database)?` on `deserialize_current` in cursor loops is safe (returns error).

---

## 9. Auth / Transport

### 9.1 Auth flow (OK)
- `application/src/auth.rs`: `login` (128-171) lowercase-normalized login lookup, bcrypt verify with constant-time-ish dummy hash on miss, active-salon check, refresh-token rotation + revocation (auth.rs:173-212). Access token HS256 with issuer/exp validation (tokens.rs:62-72). `context_from_token` re-reads user from DB each request (auth.rs:248-270) — correct (fresh permissions/status) though adds a DB hit per request (MINOR perf).
- `LoginRequest` (auth.rs:25-27) requires an explicit `tenant_id` (salon id) — device/branch validated. OK.

### 9.2 Demo session is an unauthenticated backdoor (MINOR)
- `api/main.rs:839-844` + `auth.rs:223-238` `demo_staff_session` issues a real session for the **first staff** of the **first active salon** with **no authentication whatsoever**. Exposed publicly as `GET /api/v1/auth/demo-staff-session` (api/main.rs:271). If reachable in prod, it is an auth bypass. **Flag for environment-gating.**

### 9.3 HTTP codes / CORS (OK)
- Handlers return structured `AppError` (Auth/Authorization/Validation/Conflict/NotFound/StaleVersion). CORS restrict Origin (api/main.rs:217-250); refresh cookie is `HttpOnly SameSite=Lax` (api/main.rs:766). `x-forwarded-for`/`x-real-ip` trusted without proxy config — minor spoofing surface for audit IP (MINOR).

### 9.4 Pagination (OK)
- Owner `page_json` (owner.rs:1297) and finance `page` blocks consistently return `total/limit/offset/hasMore`; expense/audit use `page/size/totalElements`. Consistent.

---

## 10. Parity Module

### 10.1 `parity.rs` is a static stub, not a real comparison (MAJOR)
- `application/src/parity.rs:9-56` returns a **hardcoded `Vec<ParityItem>`** of "implemented" self-claims. It never reads the old Node app nor performs any comparison. It only powers `GET /api/v1/parity` (api/main.rs:187). The claim `"backend parity sweep complete; no Rust placeholder/todo/unimplemented markers found; cargo fmt/check/test pass"` (parity.rs:53) is inaccurate given the many gaps above (payroll zero-pay, no state machine, stubbed private_owner, hardcoded leaves/overtime).
- **Fix:** either genuinely diff features against the old app, or rename to a manual "coverage legend" and stop asserting automated parity.

---

## Top Issues by Severity

### CRITICAL
1. **Payroll always pays 0** — `grossMinutes` never written on clock-out (repositories.rs:2608, staff.rs:312) but payroll aggregate reads it (repositories.rs:4995, finance.rs:1745). finance.rs:1720-1754.
2. **Gift-card concurrent over-spend** — `redeem_gift_card` blind `$set` matched only by `_id`, no balance-guard / no salonId (finance.rs:1286-1292, repositories.rs:4518-4528).

### MAJOR
3. **Appointment state machine not enforced** — `can_transition_to` dead code; `transition_status` writes any string (domain/appointment.rs:15-25, appointments.rs:418-436, repositories.rs:592-609).
4. **Branch-hours/weekday compared in UTC** — appointments.rs:676-700, self_booking.rs:573-608; business_date in UTC (staff.rs:307, staff_self.rs:95-104). Old app used salon-timezone math.
5. **Owner update/reschedule skip conflict & branch-hours checks** — appointments.rs:307-416.
6. **`require_owner` role-based, no permission/branch enforcement** on branches/settings — owner.rs:363-367,816-827,1791-1798.
7. **New staff can't clock in/out** — `default_user_permissions` lacks `allow:staff-checkin-checkout`; permission UI omits it (owner.rs:1366-1378,1388-1407; staff.rs:288-291).
8. **Payroll overtime hardcoded 0** — finance.rs:1750 (old app computed it, owner-console.routes.ts:817).
9. **Promo redemption not idempotent / two non-atomic writes** — finance.rs:1672-1704.
10. **Self-booking: no advance-window rules, no slot holds/TTL; stale slot_locks never pruned for self-booking** — self_booking.rs:220-410, api/main.rs:5874-5923.
11. **`private_owner` DM is a stub** — team_chat.rs:165-170.
12. **Leave balances & overtime summary hardcoded** — staff_self.rs:300-329.
13. **No DB indexes / no TTL anywhere** — performance for overlap & slot-lock queries (database lib/repositories, zero create_index).
14. **parity.rs is a static self-claim, not a real comparison** — parity.rs:9-56.

### MINOR
- Invoice line `unitAmountPaise`(net) vs `totalPaise`(gross) mismatch in non-tax-inclusive mode — finance.rs:675-677.
- Invoice line not linked to actual services (empty serviceId/productId); `events:[]`, `rate:0` placeholders — finance.rs:663-664,2266-2269.
- `redeem_gift_card` missing `salonId` filter (tenant isolation) — repositories.rs:4518-4527.
- Demo-staff-session unauthenticated backdoor — auth.rs:223-238, api/main.rs:839-844.
- Team-chat conversations N+1 and odd `write:appointments` send gate — team_chat.rs:58-64,92.
- `x-forwarded-for` trusted without proxy config — api/main.rs:1068-1073.
- Staff leave request no overlap conflict check; self-booking timezone drift.
- Voided invoices erase payment trail (payments set to `[]`).
- Broken `login_id`→`staffId` derivation `"{login}_staff"` may collide across users with similar login ids (owner.rs:1057-1061).

### Overall
The port covers the breadth of the old app (schemas, collections, RBAC aliases, finance/payroll/promos/gift cards/purchase orders, WhatsApp/Shopify, mobile push) with sound salon-scoping on most queries, atomic payment updates, and good object-id/DB error mapping. The **critical/blocking functional gaps are (a) payroll produces all-zero pays, (b) gift-card redemption is race-prone, (c) the appointment state machine is bypassed, and (d) timezone handling regressed to UTC**, plus a set of stub/hardcoded features (leaves, overtime, private DM, parity) and zero DB indexes. These should be fixed before considering the parity claim complete.
