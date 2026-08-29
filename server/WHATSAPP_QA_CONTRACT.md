# WhatsApp Salon Booking Production QA Contract

Baseline as of latest strict QA:

- Total checks: 49
- Pass: 49
- Fail: 0
- Blocked: 0
- Local E2E: PASS
- Oracle signed production E2E: E2E_PROD_OK
- Latest deployment: DEPLOY_OK

This contract is mandatory for all future changes touching WhatsApp routing, booking state machine, availability, appointment services/models, slot locking, session management, app synchronization, or interactive message handling.

Do not rewrite or disturb already-working flows unnecessarily.

## Required Production Behavior

### Main Menu

Main menu must expose:

- Book Appointment
- View My Bookings
- View History
- Reschedule Booking
- Modify Booking
- Cancel Booking
- Rebook Service

Stable WhatsApp interactive IDs:

- `book_appointment`
- `view_bookings`
- `view_history`
- `reschedule_booking`
- `modify_booking`
- `cancel_booking`
- `rebook_service`
- `back_to_menu`

Backend must prioritize interactive IDs over visible titles/text. Numeric/text input may remain as fallback. A valid interactive tap must never produce `Please choose a valid menu option` unless the action is genuinely invalid.

### New Booking

Required flow:

`Book Appointment -> Branch -> Service -> Staff -> Date -> Available Slots -> Confirmation -> Confirm -> Appointment Created`

Confirmation must include service(s), staff, branch, date/time, duration, price, Booking ID, and status.

Confirming must create exactly one active appointment with correct salon, branch, customer, staff, service(s), date/time, price, duration, status, source, slot lock, realtime/app sync, staff notification if configured, and customer confirmation.

### My Bookings

Must show only upcoming active bookings. Cancelled/rescheduled historical appointments must not appear as active bookings.

### History

Must include completed, cancelled, rescheduled, no_show, expired, and previous historical appointments. Active upcoming bookings must not appear as history. A customer with valid historical records must never receive `You have no past bookings.`

### Reschedule

Reschedule creates a new appointment and closes the old appointment lifecycle.

Required lifecycle:

- OLD status = `rescheduled`
- OLD `rescheduledToId = NEW_APPOINTMENT_ID`
- NEW status = `confirmed`/active
- NEW `rescheduledFromId = OLD_APPOINTMENT_ID`

After reschedule, old slot must be released, new slot locked, only new appointment appears in upcoming bookings, old appointment appears in history, no duplicate active appointment exists, app/client state updates, and WhatsApp state updates.

Customer wording must be: `Your appointment has been rescheduled successfully.` Do not use `rebooked` for a normal reschedule.

### Modify

Modify updates the existing appointment in place. Supported fields are services, staff, branch, and date/time.

Before final confirmation, do not commit permanent DB changes. After confirmation, the same appointment ID must remain, changed fields must update, no unnecessary second appointment must be created, slot locks must update correctly, app/client state must update, and WhatsApp must reflect the update.

Critical modify availability rule: the appointment currently being modified must not block its own availability check. Use `excludeAppointmentId` or equivalent. Other conflicting appointments must still block. A regression where new booking returns slots but modify returns zero slots for the same valid staff/date is a critical bug.

### Rebook

Rebook creates a new appointment. The old historical appointment remains intact. The new appointment gets a new ID, becomes confirmed/active, has its own slot lock, and must not create a reschedule relationship.

### Cancel

Required flow:

`Select booking -> confirmation -> cancel`

After cancellation, status must be cancelled, slot released, booking removed from active bookings, booking appears in history, customer receives confirmation, and salon/client app reflects cancellation.

### Availability

Availability must validate salon, branch, staff, service, duration, business hours, staff working hours, blocked dates, holidays, timezone, conflicting appointments, and slot locks.

Responses must distinguish invalid date, past date, valid date with no availability, and valid date with available slots.

### Slot Race Protection

Sequential and concurrent same-slot attempts must result in exactly one success and one conflict/unavailable response. Duplicate-key errors on `AppointmentSlotLockModel` must be handled gracefully and never become HTTP 500.

### Navigation And Session Safety

At multi-step flows, support `BACK`, `CANCEL`, and `MENU` where appropriate.

- `BACK`: one logical step backward
- `CANCEL`: exit current operation safely
- `MENU`: return to main menu and clear stale flow-specific state

Never reuse stale appointment ID, service, staff, branch, date, time, or management action from an old flow.

### Invalid Input

Invalid input must return a clear state-specific error, keep the user in the correct state, not create/modify a booking, not corrupt session state, and not jump into another flow.

### Interactive WhatsApp Payloads

Strict QA must test real `list_reply.id`, `list_reply.title`, `button_reply.id`, and `button_reply.title`, not only equivalent text. Backend action routing must use ID first and title/text only as fallback.

### App, WhatsApp, And Database Sync

Test both directions:

- WhatsApp creates booking -> backend -> DB -> salon/client app -> staff notification
- Salon/client app creates/modifies/cancels -> DB -> WhatsApp reflects current state

No stale booking state is allowed.

### Session Isolation

Multiple customers must be isolated by customer ID, phone number, salonId, branchId, targetAppointmentId, selected staff, selected services, selected date, and selected time.

## Automated Regression Gate

The strict E2E suite is a permanent regression gate and must cover:

- A. Main menu
- B. All interactive menu actions
- C. New booking
- D. Invalid input
- E. View bookings
- F. Cancel
- G. Reschedule
- H. Modify
- I. Rebook
- J. History
- K. Back/Cancel/Menu navigation
- L. Duplicate booking
- M. Concurrent same-slot booking
- N. App -> WhatsApp sync
- O. WhatsApp -> App sync
- P. Interactive payload IDs
- Q. Session isolation
- R. Session recovery
- S. Error handling

For every test step, output:

- STEP
- INPUT
- EXPECTED WHATSAPP RESPONSE
- ACTUAL WHATSAPP RESPONSE
- EXPECTED STATE
- ACTUAL STATE
- EXPECTED DB CHANGE
- ACTUAL DB CHANGE
- PASS / FAIL

Do not mark a test PASS just because HTTP status is 200.

## Failure Handling

If any test fails:

1. Reproduce it.
2. Identify the exact root cause.
3. Fix the root cause.
4. Typecheck.
5. Build.
6. Rerun the failed test.
7. Rerun the complete affected flow.
8. Run the full regression suite.
9. Confirm no regression.

Do not hide failures behind hardcoded responses. Do not weaken assertions simply to make tests pass.

## Final QA Report

Every QA run must end with:

- TOTAL CHECKS
- PASS
- FAIL
- BLOCKED
- CRITICAL FAILURES
- HIGH PRIORITY FAILURES
- MEDIUM PRIORITY FAILURES
- FILES CHANGED
- TESTS ADDED/UPDATED
- DEPLOY STATUS
- PRODUCTION TEST STATUS
- FINAL VERDICT: `PRODUCTION READY` or `NOT PRODUCTION READY`

Only state `PRODUCTION READY` when all critical customer flows have actually been executed and verified.

## Current Command

When asked to `run strict regression`, execute the strict WhatsApp E2E regression suite, inspect exact responses/state/database results, fix any failures, rerun the affected flow and full suite, then provide the full report above.
