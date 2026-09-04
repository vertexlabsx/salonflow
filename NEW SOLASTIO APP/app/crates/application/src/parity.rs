use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct ParityItem {
    pub feature: &'static str,
    pub status: &'static str,
}

pub fn parity_status() -> Vec<ParityItem> {
    vec![
        ParityItem {
            feature: "auth",
            status: "implemented",
        },
        ParityItem {
            feature: "appointments",
            status: "owner/staff/self-booking core implemented; owner recurrence implemented; POS invoice hooks available via finance invoice-from-appointment/payments/tips/void",
        },
        ParityItem {
            feature: "owner-console",
            status: "core implemented: dashboard, appointments, clients, finance, payroll, promos, admin, chat",
        },
        ParityItem {
            feature: "staff-os",
            status: "core implemented",
        },
        ParityItem {
            feature: "whatsapp",
            status: "webhook ingestion/signatures, text and template outbound sends, conversations list/messages, review-request + reply handling, guarded OpenAI concierge replies, guided booking bot (branch/service/staff/date/time/confirm->book), smart date/time parse, customer memory, Razorpay deposit payment-links + payment_link.paid webhook, waitlist add/offer/claim, rebooking/abandoned nudges, opt-out/opt-in",
        },
        ParityItem {
            feature: "mobile-push",
            status: "notification list/status, push-config, device registration, push-subscriptions implemented; Web Push delivery live (VAPID ES256 + RFC 8291 aes128gcm, wired into appointment create/status flows, device cleanup on 404/410)",
        },
        ParityItem {
            feature: "security",
            status: "CORS from CORS_ORIGINS; audit writes capture ip/user-agent; appointment status audit events added; background cleanup/reminder jobs implemented",
        },
        ParityItem {
            feature: "shopify",
            status: "auth, read-only APIs, OAuth/encrypted token, webhook ingestion, campaigns incl. send; execution loop processes wait/condition/whatsapp_template/stop nodes",
        },
        ParityItem {
            feature: "self-booking",
            status: "implemented",
        },
        ParityItem {
            feature: "realtime",
            status: "status endpoint implemented; backend no longer uses placeholder route responses",
        },
        ParityItem {
            feature: "backend",
            status: "backend parity sweep complete; no Rust placeholder/todo/unimplemented markers found; cargo fmt/check/test pass",
        },
    ]
}
