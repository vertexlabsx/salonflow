use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{
        header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE, SET_COOKIE},
        HeaderMap, HeaderValue, Method, StatusCode,
    },
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{Datelike, Timelike};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use mongodb::bson::{doc, oid::ObjectId, DateTime, Document};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solastio_application::appointments::{
    AppointmentListQuery, AppointmentService, AppointmentStatusRequest, CreateAppointmentRequest,
    OwnerAppointmentReschedule, OwnerAppointmentWrite,
};
use solastio_application::auth::{AuthService, LoginRequest, LogoutRequest, RefreshRequest};
use solastio_application::catalog::{
    CatalogService, CreateBranchRequest, CreateCustomerRequest, CreateServiceRequest,
    CustomerQuery, ServiceQuery, StatusRequest, UpdateBranchRequest, UpdateServiceRequest,
};
use solastio_application::finance::{
    AuditLogExportQuery, AuditLogQuery, BundleDealStatusRequest, BundleDealWrite, ExpenseQuery,
    ExpenseWrite, FinanceService, GiftCardQuery, GiftCardRedeemRequest, GiftCardStatusRequest,
    GiftCardWrite, GstReportQuery, InvoiceListQuery, PaymentRequest, PayrollGenerateRequest,
    PayrollRunQuery, PayrollStatusRequest, PromoQuery, PromoRedeemRequest, PromoRedemptionQuery,
    PromoStatusRequest, PromoWrite, PurchaseOrderQuery, PurchaseOrderStatusRequest,
    PurchaseOrderWrite, TaxSettingsUpdate, TipRequest, VoidRequest,
};
use solastio_application::owner::{
    BotSettingsUpdate, BusyHoursQuery, ClientOptOutRequest, ClientPhotoWrite,
    OwnerAppointmentQuery, OwnerClientWrite, OwnerLeaveDecisionRequest, OwnerLeaveQuery,
    OwnerListQuery, OwnerService, OwnerStaffQuery, OwnerUserWrite, SettingsQuery, SettingsUpdate,
    WhatsAppIntelligenceQuery,
};
use solastio_application::parity::parity_status;
use solastio_application::self_booking::{
    BookRequest, BranchQuery, CancelRequest, RescheduleRequest, SalonQuery, SelfBookingService,
    SlotsQuery, StaffQuery,
};
use solastio_application::staff::{
    AttendanceQuery, ClockInRequest, ClockOutRequest, LeaveRequest, LimitQuery, StaffService,
    StartBreakRequest, TaskPatchRequest, TodayQuery,
};
use solastio_application::staff_self::{
    CreateShiftSwapRequest, NotificationPatchRequest, NotificationQuery, SchedulePatchRequest,
    ShiftSwapCancelRequest, ShiftSwapDecisionRequest, StaffSelfService,
};
use solastio_application::team_chat::{
    ReceiptRequest, SearchQuery, SendMessageRequest, TeamChatService,
};
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{RefreshTokenRecord, ShopifyUserRecord},
    repositories::{
        AppointmentRepository, AttendanceRepository, CatalogRepository, ChatRepository,
        FinanceRepository, OwnerRepository, PushDeviceRepository, SalonRepository,
        ShopifyUserRepository, StaffRepository, UserRepository, WhatsAppRepository,
    },
    MongoStore,
};
use solastio_infrastructure::init_tracing;
use solastio_shared::{config::AppConfig, error::AppError, response::ok};
use std::{net::SocketAddr, sync::Arc};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

mod web_push;

#[derive(Clone)]
struct AppState {
    store: MongoStore,
    auth: AuthService,
    appointments: AppointmentService,
    self_booking: SelfBookingService,
    staff: StaffService,
    owner: OwnerService,
    catalog: CatalogService,
    staff_self: StaffSelfService,
    team_chat: TeamChatService,
    finance: FinanceService,
    whatsapp: WhatsAppRepository,
    appointment_repo: AppointmentRepository,
    shopify_users: ShopifyUserRepository,
    push_devices: PushDeviceRepository,
    users: UserRepository,
    salons: SalonRepository,
    config: AppConfig,
}

#[derive(Serialize)]
struct Health<'a> {
    status: &'a str,
}

#[tokio::main]
async fn main() -> Result<(), AppError> {
    init_tracing();
    let config = AppConfig::from_env().map_err(AppError::Validation)?;
    let store = MongoStore::connect(&config).await?;
    let users = UserRepository::new(&store.database);
    let salons = SalonRepository::new(&store.database);
    let appointment_repo = AppointmentRepository::new(&store.database);
    let catalog_repo = CatalogRepository::new(&store.database);
    let public_catalog_repo = CatalogRepository::new(&store.database);
    let public_appointment_repo = AppointmentRepository::new(&store.database);
    let attendance_repo = AttendanceRepository::new(&store.database);
    let staff_repo = StaffRepository::new(&store.database);
    let owner_repo = OwnerRepository::new(&store.database);
    let owner_appointment_repo = AppointmentRepository::new(&store.database);
    let catalog_service_repo = CatalogRepository::new(&store.database);
    let auth = AuthService::new(config.clone(), users, salons.clone());
    let appointments = AppointmentService::new(appointment_repo, catalog_repo);
    let self_booking = SelfBookingService::new(public_catalog_repo, public_appointment_repo);
    let staff = StaffService::new(attendance_repo, staff_repo);
    let owner = OwnerService::new(owner_repo, owner_appointment_repo);
    let catalog = CatalogService::new(catalog_service_repo);
    let staff_self_repo = StaffRepository::new(&store.database);
    let staff_self_appointment_repo = AppointmentRepository::new(&store.database);
    let staff_self = StaffSelfService::new(staff_self_appointment_repo, staff_self_repo);
    let team_chat_repo = ChatRepository::new(&store.database);
    let team_chat = TeamChatService::new(team_chat_repo);
    let finance_repo = FinanceRepository::new(&store.database);
    let finance = FinanceService::new(finance_repo);
    let whatsapp = WhatsAppRepository::new(&store.database);
    let appointment_repo = AppointmentRepository::new(&store.database);
    let shopify_users = ShopifyUserRepository::new(&store.database);
    let push_devices = PushDeviceRepository::new(&store.database);
    let users = UserRepository::new(&store.database);
    let state = AppState {
        store,
        auth,
        appointments,
        self_booking,
        staff,
        owner,
        catalog,
        staff_self,
        team_chat,
        finance,
        whatsapp,
        appointment_repo,
        shopify_users,
        push_devices,
        users,
        salons,
        config: config.clone(),
    };
    tokio::spawn(resubscribe_connected_whatsapp(Arc::new(state.clone())));
    start_whatsapp_nudge_loop(Arc::new(state.clone()));
    start_shopify_execution_loop(Arc::new(state.clone()));
    let app = build_router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|_| AppError::Internal)?;
    tracing::info!(%addr, "Solastio Rust API listening");
    axum::serve(listener, app)
        .await
        .map_err(|_| AppError::Internal)
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/v1/health",
            get(|| async { ok(Health { status: "ok" }) }),
        )
        .route("/api/v1/ready", get(ready))
        .route(
            "/webhook",
            get(whatsapp_verify_webhook).post(whatsapp_receive_webhook),
        )
        .route("/shopify/webhooks", post(shopify_webhook))
        .route("/api/v1/parity", get(|| async { ok(parity_status()) }))
        .nest("/api/v1/auth", auth_router())
        .nest("/api/v1/staff-os", staff_os_router())
        .nest("/api/v1/staff-self", staff_self_router())
        .nest("/api/v1/team-chat", team_chat_router())
        .nest("/api/v1/appointments", appointments_router())
        .nest("/api/v1/catalog", catalog_router())
        .nest("/api/v1/mobile", mobile_router())
        .nest("/api/v1/realtime", realtime_router())
        .nest("/api/v1/owner-console", owner_console_router())
        .nest("/api/v1/whatsapp", whatsapp_router())
        .nest("/api/v1/shopify-automation", shopify_automation_router())
        .nest("/api/v1/shopify-api/auth", shopify_auth_router())
        .nest("/api/v1/shopify-api/admin", shopify_admin_router())
        .nest("/api/v1/shopify-api/client", shopify_client_router())
        .nest("/api/v1/self-booking", self_booking_router())
        .nest(
            "/api/v1/attendance-verification",
            attendance_verification_router(),
        )
        .layer(TraceLayer::new_for_http())
        .layer(configured_cors(&state.config.cors_origins))
        .with_state(Arc::new(state))
}

async fn ready(State(state): State<Arc<AppState>>) -> axum::response::Response {
    let status = if state.store.ready().await {
        "ready"
    } else {
        "not_ready"
    };
    ok(Health { status })
}

fn configured_cors(origins: &[String]) -> CorsLayer {
    use tower_http::cors::{AllowOrigin, CorsLayer};
    let allowed_origins: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|o| o.parse::<HeaderValue>().ok())
        .collect();

    CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            ACCEPT,
            AUTHORIZATION,
            CONTENT_TYPE,
            axum::http::header::HeaderName::from_static("x-csrf-token"),
        ])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate(move |origin, _| {
            if let Ok(str_val) = origin.to_str() {
                if str_val.starts_with("http://localhost")
                    || str_val.starts_with("http://127.0.0.1")
                {
                    return true;
                }
            }
            allowed_origins.contains(origin)
        }))
}

fn realtime_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(realtime_status))
        .route("/ticket", post(realtime_issue_ticket))
}

async fn realtime_status(State(state): State<Arc<AppState>>) -> axum::response::Response {
    ok(serde_json::json!({
        "status": "ok",
        "transport": "polling-compatible",
        "serverTime": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
        "databaseReady": state.store.ready().await,
    }))
}

fn auth_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/logout", post(logout))
        .route("/csrf", get(csrf))
        .route("/demo-staff-session", get(demo_staff_session))
        .route("/webauthn/register/begin", post(webauthn_register_begin))
        .route("/webauthn/register/finish", post(webauthn_register_finish))
        .route("/webauthn/login/begin", post(webauthn_login_begin))
        .route("/webauthn/login/finish", post(webauthn_login_finish))
}

fn appointments_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_appointments).post(create_appointment))
        .route("/:id/status", patch(update_appointment_status))
}

fn catalog_router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/branches",
            get(catalog_branches).post(catalog_create_branch),
        )
        .route(
            "/services",
            get(catalog_services).post(catalog_create_service),
        )
        .route(
            "/customers",
            get(catalog_customers).post(catalog_create_customer),
        )
}

fn staff_os_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mobile/today", get(staff_today))
        .route("/leaves", get(staff_leaves).post(staff_request_leave))
        .route("/mobile/payroll", get(staff_payroll))
        .route("/mobile/targets", get(staff_targets))
        .route("/tasks/:task_id", patch(staff_update_task))
        .route("/attendance", get(staff_attendance))
        .route("/attendance/clock-in", post(staff_clock_in))
        .route("/attendance/clock-out", post(staff_clock_out))
        .route("/attendance/break-start", post(staff_break_start))
        .route("/attendance/break-end", post(staff_break_end))
        .route("/shift-swaps", get(staff_os_shift_swaps))
        .route(
            "/shift-swaps/:swap_id/approve",
            post(staff_os_approve_shift_swap),
        )
        .route(
            "/shift-swaps/:swap_id/reject",
            post(staff_os_reject_shift_swap),
        )
        .route("/leaves/:leave_id/approve", patch(staff_os_approve_leave))
        .route("/leaves/:leave_id/reject", patch(staff_os_reject_leave))
}

fn staff_self_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/dashboard", get(staff_self_dashboard))
        .route("/calendar", get(staff_self_calendar))
        .route("/calendar/:schedule_id", patch(staff_self_update_schedule))
        .route(
            "/shift-swap-coworkers",
            get(staff_self_shift_swap_coworkers),
        )
        .route(
            "/shift-swaps",
            get(staff_self_shift_swaps).post(staff_self_create_shift_swap),
        )
        .route(
            "/shift-swaps/:swap_id/respond",
            post(staff_self_respond_shift_swap),
        )
        .route(
            "/shift-swaps/:swap_id/cancel",
            post(staff_self_cancel_shift_swap),
        )
        .route(
            "/attendance/overtime-summary",
            get(staff_self_overtime_summary),
        )
        .route("/leave-balances", get(staff_self_leave_balances))
        .route(
            "/workspace-preferences",
            get(staff_self_workspace_preferences),
        )
        .route("/notifications/:id", patch(staff_self_update_notification))
}

fn mobile_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/notifications", get(mobile_notifications))
        .route("/notifications/:id", patch(mobile_update_notification))
        .route("/push-config", get(mobile_push_config))
        .route("/devices", post(mobile_register_device))
        .route("/push-subscriptions", post(mobile_push_subscription))
}

fn attendance_verification_router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/branches/:branch_id/policy",
            get(att_verify_policy).put(att_verify_update_policy),
        )
        .route("/devices", get(att_verify_devices))
        .route(
            "/devices/:device_id/reviews",
            post(att_verify_device_review),
        )
        .route("/evidence", get(att_verify_evidence))
}

fn whatsapp_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(whatsapp_status))
        .route(
            "/embedded-signup/state",
            post(whatsapp_embedded_signup_state),
        )
        .route(
            "/embedded-signup/start",
            post(whatsapp_embedded_signup_state),
        )
        .route(
            "/embedded-signup/callback",
            post(whatsapp_embedded_signup_callback),
        )
        .route("/disconnect", post(whatsapp_disconnect))
        .route("/admin/cleanup-all", post(whatsapp_cleanup_all))
        .route(
            "/webhook",
            get(whatsapp_verify_webhook).post(whatsapp_receive_webhook),
        )
        .route("/conversations", get(whatsapp_conversations))
        .route(
            "/conversations/:phone/messages",
            get(whatsapp_conversation_messages),
        )
        .route("/razorpay/webhook", post(whatsapp_razorpay_webhook))
}

fn shopify_auth_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", post(shopify_login))
        .route("/refresh", post(shopify_refresh))
        .route("/logout", post(shopify_logout))
}

fn shopify_admin_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/overview", get(shopify_admin_overview))
        .route(
            "/flows",
            get(shopify_admin_flows).post(shopify_admin_create_flow),
        )
        .route("/flows/seed", post(shopify_admin_seed_flows))
        .route("/flows/:id", patch(shopify_admin_update_flow))
        .route("/flows/:id/nodes", post(shopify_admin_add_flow_node))
        .route(
            "/flows/:flow_id/nodes/:node_id",
            patch(shopify_admin_update_flow_node).delete(shopify_admin_delete_flow_node),
        )
        .route("/templates", get(shopify_admin_templates))
        .route("/logs", get(shopify_admin_logs))
        .route("/customers", get(shopify_admin_customers))
        .route("/customers/import", post(shopify_admin_import_customers))
        .route("/customers/opt-out", post(shopify_admin_customer_opt_out))
        .route(
            "/audiences",
            get(shopify_admin_audiences).post(shopify_admin_create_audience),
        )
        .route("/campaigns/preview", get(shopify_admin_campaign_preview))
        .route(
            "/campaigns",
            get(shopify_admin_campaigns).post(shopify_admin_create_campaign),
        )
        .route("/campaigns/:id/send", post(shopify_admin_send_campaign))
        .route("/shopify/install-url", post(shopify_admin_install_url))
        .route("/shopify/disconnect", post(shopify_admin_disconnect))
}

fn shopify_client_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/overview", get(shopify_client_overview))
        .route("/flows", get(shopify_client_flows))
        .route("/activity", get(shopify_client_activity))
}

fn shopify_automation_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/shopify/callback", get(shopify_automation_callback))
        .route("/overview", get(shopify_automation_overview))
        .route(
            "/flows",
            get(shopify_automation_flows).post(shopify_automation_create_flow),
        )
        .route("/flows/seed", post(shopify_automation_seed_flows))
        .route("/flows/:id", patch(shopify_automation_update_flow))
        .route("/flows/:id/nodes", post(shopify_automation_add_flow_node))
        .route(
            "/flows/:flow_id/nodes/:node_id",
            patch(shopify_automation_update_flow_node).delete(shopify_automation_delete_flow_node),
        )
        .route("/templates", get(shopify_automation_templates))
        .route("/logs", get(shopify_automation_logs))
        .route("/customers", get(shopify_automation_customers))
        .route(
            "/customers/import",
            post(shopify_automation_import_customers),
        )
        .route(
            "/customers/opt-out",
            post(shopify_automation_customer_opt_out),
        )
        .route(
            "/audiences",
            get(shopify_automation_audiences).post(shopify_automation_create_audience),
        )
        .route(
            "/campaigns/preview",
            get(shopify_automation_campaign_preview),
        )
        .route(
            "/campaigns",
            get(shopify_automation_campaigns).post(shopify_automation_create_campaign),
        )
        .route(
            "/campaigns/:id/send",
            post(shopify_automation_send_campaign),
        )
        .route("/shopify/install-url", post(shopify_automation_install_url))
        .route("/shopify/connect", post(shopify_automation_connect))
        .route("/shopify/test", post(shopify_automation_test))
        .route("/shopify/disconnect", post(shopify_automation_disconnect))
}

fn owner_console_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/dashboard", get(owner_dashboard))
        .route(
            "/appointments",
            get(owner_appointments).post(owner_create_appointment),
        )
        .route(
            "/appointments/:id",
            get(owner_appointment_detail).patch(owner_update_appointment),
        )
        .route(
            "/appointments/:id/reschedule",
            post(owner_reschedule_appointment),
        )
        .route("/appointments/:id/cancel", post(owner_appointment_cancel))
        .route(
            "/appointments/:id/check-in",
            post(owner_appointment_check_in),
        )
        .route(
            "/appointments/:id/start-service",
            post(owner_appointment_start_service),
        )
        .route(
            "/appointments/:id/complete",
            post(owner_appointment_complete),
        )
        .route("/appointments/:id/no-show", post(owner_appointment_no_show))
        .route("/appointments/:id/status", post(owner_appointment_status))
        .route(
            "/appointments/options/branches",
            get(owner_appointment_branch_options),
        )
        .route(
            "/appointments/options/clients",
            get(owner_appointment_client_options),
        )
        .route(
            "/appointments/options/staff",
            get(owner_appointment_staff_options),
        )
        .route(
            "/appointments/options/services",
            get(owner_appointment_service_options),
        )
        .route("/branches", get(owner_branches))
        .route("/staff", get(owner_staff))
        .route("/people/staff", get(owner_people_staff))
        .route("/people/leaves", get(owner_people_leaves))
        .route("/people/leaves/:leave_id", get(owner_people_leave_detail))
        .route(
            "/people/leaves/:leave_id/approve",
            patch(owner_approve_leave),
        )
        .route("/people/leaves/:leave_id/reject", patch(owner_reject_leave))
        .route(
            "/administration/branches",
            get(owner_admin_branches).post(owner_admin_create_branch),
        )
        .route(
            "/administration/branches/:branch_id",
            patch(owner_admin_update_branch),
        )
        .route(
            "/administration/branches/:branch_id/status",
            patch(owner_admin_update_branch_status),
        )
        .route(
            "/administration/services",
            get(owner_admin_services).post(owner_admin_create_service),
        )
        .route(
            "/administration/services/:service_id",
            patch(owner_admin_update_service),
        )
        .route(
            "/administration/services/:service_id/status",
            patch(owner_admin_update_service_status),
        )
        .route("/administration/access", get(owner_admin_access))
        .route("/administration/users", post(owner_admin_create_user))
        .route(
            "/administration/users/:user_id",
            patch(owner_admin_update_user),
        )
        .route("/administration/roles", post(owner_admin_create_role))
        .route(
            "/administration/roles/:role/restore-defaults",
            post(owner_admin_restore_role_defaults),
        )
        .route(
            "/administration/settings",
            get(owner_admin_settings).put(owner_admin_update_settings),
        )
        .route("/operations/chats", get(team_chat_conversations))
        .route("/operations/chats/search", get(team_chat_search))
        .route(
            "/operations/chats/:conversation_id/search",
            get(team_chat_search_in_conversation),
        )
        .route(
            "/operations/chats/:conversation_id/messages",
            get(team_chat_messages).post(team_chat_send_message),
        )
        .route("/operations/chats/private", post(team_chat_private_owner))
        .route(
            "/operations/chats/:conversation_id/receipts",
            post(team_chat_update_receipts),
        )
        .route(
            "/operations/clients",
            get(owner_clients).post(owner_create_client),
        )
        .route(
            "/operations/clients/:client_id",
            get(owner_client_detail).patch(owner_update_client),
        )
        .route(
            "/operations/clients/:client_id/opt-out",
            patch(owner_client_opt_out),
        )
        .route(
            "/operations/clients/:client_id/review-request",
            post(owner_client_review_request),
        )
        .route(
            "/operations/clients/:client_id/photos",
            post(owner_add_client_photo),
        )
        .route(
            "/operations/clients/:client_id/photos/:photo_id",
            delete(owner_delete_client_photo),
        )
        .route("/operations/inventory", get(owner_inventory))
        .route(
            "/operations/inventory/:product_id",
            get(owner_inventory_product),
        )
        .route("/operations/notifications", get(owner_notifications))
        .route(
            "/operations/notifications/:notification_id/receipt",
            patch(owner_notification_receipt),
        )
        .route(
            "/operations/notifications/mark-all-read",
            post(owner_notifications_mark_all_read),
        )
        .route("/clients", get(owner_clients))
        .route(
            "/settings",
            get(owner_settings).patch(owner_update_settings),
        )
        .route("/billing/invoices", get(finance_invoices))
        .route("/billing/invoices/:invoice_id", get(finance_invoice_detail))
        .route("/finance/invoices", get(finance_invoices))
        .route(
            "/finance/invoices/:invoice_id/payments",
            post(finance_record_payment),
        )
        .route(
            "/finance/invoices/:invoice_id/tips",
            post(finance_record_tip),
        )
        .route(
            "/finance/invoices/:invoice_id/void",
            post(finance_void_invoice),
        )
        .route(
            "/finance/invoices/from-appointment/:appointment_id",
            post(finance_invoice_from_appointment),
        )
        .route("/finance/invoices/:invoice_id", get(finance_invoice_detail))
        .route(
            "/finance/tax-settings",
            get(finance_tax_settings).put(finance_update_tax_settings),
        )
        .route(
            "/finance/expenses",
            get(finance_expenses).post(finance_create_expense),
        )
        .route(
            "/finance/expenses/:expense_id",
            put(finance_update_expense).delete(finance_delete_expense),
        )
        .route("/finance/gst-report", get(finance_gst_report))
        .route("/analytics/busy-hours", get(owner_busy_hours))
        .route("/whatsapp/intelligence", get(owner_whatsapp_intelligence))
        .route(
            "/whatsapp/bot-settings",
            get(owner_whatsapp_bot_settings).put(owner_update_whatsapp_bot_settings),
        )
        .route(
            "/operations/purchase-orders",
            get(finance_purchase_orders).post(finance_create_purchase_order),
        )
        .route(
            "/operations/purchase-orders/:purchase_order_id/status",
            patch(finance_update_purchase_order_status),
        )
        .route(
            "/commerce/gift-cards",
            get(finance_gift_cards).post(finance_create_gift_card),
        )
        .route(
            "/commerce/gift-cards/:gift_card_id/status",
            patch(finance_update_gift_card_status),
        )
        .route(
            "/commerce/gift-cards/:gift_card_id/redeem",
            post(finance_redeem_gift_card),
        )
        .route(
            "/commerce/bundles",
            get(finance_bundle_deals).post(finance_create_bundle_deal),
        )
        .route(
            "/commerce/bundles/:bundle_id/status",
            patch(finance_update_bundle_deal_status),
        )
        .route("/promos", get(finance_promos).post(finance_create_promo))
        .route(
            "/promos/:promo_id/redemptions",
            get(finance_promo_redemptions),
        )
        .route(
            "/promos/:promo_id/status",
            patch(finance_update_promo_status),
        )
        .route("/promos/redeem", post(finance_redeem_promo))
        .route(
            "/people/payroll/generate",
            post(finance_generate_payroll_run),
        )
        .route("/people/payroll/runs", get(finance_payroll_runs))
        .route("/people/payroll/runs/:run_id", get(finance_payroll_run))
        .route(
            "/people/payroll/runs/:run_id/status",
            patch(finance_update_payroll_status),
        )
        .route(
            "/people/payroll/runs/:run_id/payslips/:staff_id.pdf",
            get(finance_payroll_payslip_pdf),
        )
        .route("/administration/audit-logs", get(finance_audit_logs))
        .route(
            "/administration/audit-logs/export",
            get(finance_audit_logs_export),
        )
        .route(
            "/appointments/:id/pos-handoff",
            post(owner_appointment_pos_handoff),
        )
        .route("/finance/overview", get(owner_finance_overview))
        .route("/finance/drilldown", get(owner_finance_drilldown))
        .route("/reports/catalogue", get(owner_reports_catalogue))
        .route("/reports/:report_key", get(owner_report_run))
        .route("/reports/export", get(owner_report_export))
        .route("/people/attendance", get(owner_attendance_list))
        .route(
            "/people/attendance/:attendance_id/corrections",
            post(owner_attendance_corrections),
        )
        .route(
            "/people/attendance/:attendance_id/reset",
            post(owner_attendance_reset),
        )
        .route("/people/staff/:staff_id", get(owner_staff_detail))
        .route("/people/staff/:staff_id/status", patch(owner_staff_status))
        .route("/people/staff/:staff_id/login", post(owner_staff_login))
        .route("/people/staff/:staff_id/transfer", post(owner_staff_transfer))
        .route(
            "/people/staff/:staff_id/schedules",
            post(owner_staff_schedules),
        )
        .route(
            "/people/staff/:staff_id/commissions",
            post(owner_staff_commissions),
        )
        .route("/operations/marketing", get(owner_marketing_list))
}

fn team_chat_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/conversations", get(team_chat_conversations))
        .route("/search", get(team_chat_search))
        .route(
            "/conversations/:conversation_id/search",
            get(team_chat_search_in_conversation),
        )
        .route(
            "/conversations/:conversation_id/messages",
            get(team_chat_messages).post(team_chat_send_message),
        )
        .route(
            "/conversations/:conversation_id/receipts",
            post(team_chat_update_receipts),
        )
        .route("/private-owner", post(team_chat_private_owner))
}

fn self_booking_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/branches", get(self_booking_branches))
        .route("/services", get(self_booking_services))
        .route("/staff", get(self_booking_staff))
        .route("/slots", get(self_booking_slots))
        .route("/book", post(self_booking_book))
        .route("/cancel", post(self_booking_cancel))
        .route("/reschedule", post(self_booking_reschedule))
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> Result<axum::response::Response, AppError> {
    let session = state.auth.login(request).await?;
    if let Ok(header_val) = aura_refresh_cookie(&state.config, &session.refresh_token, false) {
        let mut response = ok(session);
        response.headers_mut().insert(SET_COOKIE, header_val);
        return Ok(response);
    }
    Ok(ok(session))
}

async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<RefreshRequest>,
) -> Result<axum::response::Response, AppError> {
    if request
        .refresh_token
        .as_ref()
        .map(|t| t.trim().is_empty())
        .unwrap_or(true)
    {
        if let Some(cookie_hdr) = headers.get(COOKIE).and_then(|v| v.to_str().ok()) {
            for part in cookie_hdr.split(';') {
                let part = part.trim();
                if let Some(val) = part.strip_prefix("auraRefresh=") {
                    request.refresh_token = Some(val.to_string());
                    break;
                }
            }
        }
    }
    let session = state.auth.refresh(request).await?;
    if let Ok(header_val) = aura_refresh_cookie(&state.config, &session.refresh_token, false) {
        let mut response = ok(session);
        response.headers_mut().insert(SET_COOKIE, header_val);
        return Ok(response);
    }
    Ok(ok(session))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<LogoutRequest>,
) -> Result<axum::response::Response, AppError> {
    if request
        .refresh_token
        .as_ref()
        .map(|t| t.trim().is_empty())
        .unwrap_or(true)
    {
        if let Some(cookie_hdr) = headers.get(COOKIE).and_then(|v| v.to_str().ok()) {
            for part in cookie_hdr.split(';') {
                let part = part.trim();
                if let Some(val) = part.strip_prefix("auraRefresh=") {
                    request.refresh_token = Some(val.to_string());
                    break;
                }
            }
        }
    }
    let result = state.auth.logout(request).await?;
    let mut response = ok(result);
    if let Ok(header_val) = aura_refresh_cookie(&state.config, "", true) {
        response.headers_mut().insert(SET_COOKIE, header_val);
    }
    Ok(response)
}

async fn demo_staff_session(
    State(state): State<Arc<AppState>>,
) -> Result<axum::response::Response, AppError> {
    if state.config.env == "production" {
        return Err(AppError::NotFound(
            "Demo staff session is not available in production.".to_string(),
        ));
    }
    let session = state.auth.demo_staff_session().await?;
    Ok(ok(session))
}

async fn webauthn_register_begin() -> Result<axum::response::Response, AppError> {
    Err(AppError::Validation(
        "Passkeys/WebAuthn not configured on this environment".to_string(),
    ))
}

async fn webauthn_register_finish() -> Result<axum::response::Response, AppError> {
    Err(AppError::Validation(
        "Passkeys/WebAuthn not configured on this environment".to_string(),
    ))
}

async fn webauthn_login_begin() -> Result<axum::response::Response, AppError> {
    Err(AppError::Validation(
        "Passkeys/WebAuthn not configured on this environment".to_string(),
    ))
}

async fn webauthn_login_finish() -> Result<axum::response::Response, AppError> {
    Err(AppError::Validation(
        "Passkeys/WebAuthn not configured on this environment".to_string(),
    ))
}

async fn csrf(State(state): State<Arc<AppState>>) -> axum::response::Response {
    ok(state.auth.issue_csrf())
}

async fn list_appointments(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AppointmentListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let appointments = state.appointments.list(&context, query).await?;
    Ok(ok(appointments))
}

async fn update_appointment_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<AppointmentStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let requested_status = request.status.clone();
    let before_cancel = if requested_status == "cancelled" {
        if let Ok(oid) = ObjectId::parse_str(&id) {
            state
                .appointment_repo
                .find_by_id(&context.salon_id, oid)
                .await?
        } else {
            None
        }
    } else {
        None
    };
    let appointment = state
        .appointments
        .transition_status(&context, &id, request)
        .await?;
    let notification = web_push::PushNotification {
        title: "Appointment updated".to_string(),
        body: format!(
            "{} is now {}",
            appointment.customer_name, appointment.status
        ),
        tag: Some(format!("appointment-{}", appointment.id)),
        data: serde_json::json!({
            "appointmentId": appointment.id,
            "type": "appointment.status_changed",
            "status": appointment.status
        }),
    };
    tokio::spawn({
        let state = state.clone();
        let salon_id = context.salon_id.clone();
        let staff_id = appointment.staff_id.clone();
        async move {
            let _ =
                web_push::notify_staff_by_staff_id(state, salon_id, staff_id, notification).await;
        }
    });
    if let Some(opened) = before_cancel {
        if let Some(offer) = state
            .appointment_repo
            .offer_cancelled_slot_to_waitlist(&opened)
            .await?
        {
            let _ = send_whatsapp_message(
                &state,
                &context.salon_id,
                &offer.customer_phone,
                "waitlist",
                &format!(
                    "A waitlist slot opened for {} at {}. Reply BOOK within 15 minutes to claim it. Booking ID: {}",
                    opened.service_names.join(", "),
                    format_time(&opened.start_at.try_to_rfc3339_string().unwrap_or_default()),
                    offer.appointment_id
                ),
                None,
                serde_json::json!({ "source": "waitlist_cancel_match", "waitlistId": offer.waitlist_id, "dedupeKey": format!("waitlist_cancel_match:{}:{}", offer.waitlist_id, offer.appointment_id) }),
            )
            .await;
        }
    }
    Ok(ok(appointment))
}

async fn create_appointment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateAppointmentRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let appointment = state.appointments.create(&context, request).await?;
    let notification = web_push::PushNotification {
        title: "New appointment".to_string(),
        body: format!(
            "{} — {} at {}",
            appointment.customer_name,
            appointment.service_names.join(", "),
            lines_with_kolkata_time(&appointment.start_at)
        ),
        tag: Some(format!("appointment-{}", appointment.id)),
        data: serde_json::json!({
            "appointmentId": appointment.id,
            "type": "appointment.created"
        }),
    };
    tokio::spawn({
        let state = state.clone();
        let salon_id = context.salon_id.clone();
        let staff_id = appointment.staff_id.clone();
        async move {
            let _ =
                web_push::notify_staff_by_staff_id(state, salon_id, staff_id, notification).await;
        }
    });
    Ok(ok(appointment))
}

async fn catalog_branches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let branches = state.catalog.branches(&context).await?;
    Ok(ok(branches))
}

async fn catalog_create_branch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateBranchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let branch = state.catalog.create_branch(&context, request).await?;
    Ok(ok(branch))
}

async fn catalog_services(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ServiceQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let services = state.catalog.services(&context, query).await?;
    Ok(ok(services))
}

async fn catalog_create_service(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateServiceRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let service = state.catalog.create_service(&context, request).await?;
    Ok(ok(service))
}

async fn catalog_customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<CustomerQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let customers = state.catalog.customers(&context, query).await?;
    Ok(ok(customers))
}

async fn catalog_create_customer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateCustomerRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let customer = state.catalog.create_customer(&context, request).await?;
    Ok(ok(customer))
}

async fn context_from_headers(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<solastio_application::auth::RequestContext, AppError> {
    let token = headers
        .get("x-auth-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .map(str::to_owned)
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim)
                .map(str::to_owned)
        })
        .ok_or(AppError::Authentication)?;
    let mut context = state.auth.context_from_token(&token).await?;
    context.ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .unwrap_or_default();
    context.user_agent = headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .unwrap_or_default();
    Ok(context)
}

async fn self_booking_branches(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SalonQuery>,
) -> Result<axum::response::Response, AppError> {
    let branches = state.self_booking.branches(query).await?;
    Ok(ok(branches))
}

async fn self_booking_services(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BranchQuery>,
) -> Result<axum::response::Response, AppError> {
    let services = state.self_booking.services(query).await?;
    Ok(ok(services))
}

async fn self_booking_staff(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StaffQuery>,
) -> Result<axum::response::Response, AppError> {
    let staff = state.self_booking.staff(query).await?;
    Ok(ok(staff))
}

async fn self_booking_slots(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SlotsQuery>,
) -> Result<axum::response::Response, AppError> {
    let slots = state.self_booking.slots(query).await?;
    Ok(ok(slots))
}

async fn self_booking_book(
    State(state): State<Arc<AppState>>,
    Json(request): Json<BookRequest>,
) -> Result<axum::response::Response, AppError> {
    let booking = state.self_booking.book(request).await?;
    Ok(ok(booking))
}

async fn self_booking_cancel(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CancelRequest>,
) -> Result<axum::response::Response, AppError> {
    let cancellation = state.self_booking.cancel(request).await?;
    Ok(ok(cancellation))
}

async fn self_booking_reschedule(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RescheduleRequest>,
) -> Result<axum::response::Response, AppError> {
    let reschedule = state.self_booking.reschedule(request).await?;
    Ok(ok(reschedule))
}

async fn staff_attendance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AttendanceQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let attendance = state.staff.list_attendance(&context, query).await?;
    Ok(ok(attendance))
}

async fn staff_today(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<TodayQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let today = state.staff.today(&context, query).await?;
    Ok(ok(today))
}

async fn staff_leaves(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<LimitQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leaves = state.staff.leaves(&context, query).await?;
    Ok(ok(leaves))
}

async fn staff_request_leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<LeaveRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leave = state.staff.request_leave(&context, request).await?;
    Ok(ok(leave))
}

async fn staff_payroll(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let payroll = state.staff.payroll(&context).await?;
    Ok(ok(payroll))
}

async fn staff_targets(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let targets = state.staff.targets(&context).await?;
    Ok(ok(targets))
}

async fn staff_update_task(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
    Json(request): Json<TaskPatchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let task = state.staff.update_task(&context, &task_id, request).await?;
    Ok(ok(task))
}

async fn staff_clock_in(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClockInRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let attendance = state.staff.clock_in(&context, request).await?;
    Ok(ok(attendance))
}

async fn staff_clock_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ClockOutRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let attendance = state.staff.clock_out(&context, request).await?;
    Ok(ok(attendance))
}

async fn staff_break_start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<StartBreakRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let break_state = state.staff.start_break(&context, request).await?;
    Ok(ok(break_state))
}

async fn staff_break_end(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let break_state = state.staff.end_break(&context).await?;
    Ok(ok(break_state))
}

async fn staff_self_dashboard(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<solastio_application::staff_self::DashboardQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let dashboard = state.staff_self.dashboard(&context, query).await?;
    Ok(ok(dashboard))
}

async fn staff_self_calendar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let calendar = state.staff_self.calendar(&context).await?;
    Ok(ok(calendar))
}

async fn staff_self_update_schedule(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(schedule_id): Path<String>,
    Json(request): Json<SchedulePatchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let schedule = state
        .staff_self
        .update_schedule(&context, &schedule_id, request)
        .await?;
    Ok(ok(schedule))
}

async fn staff_self_shift_swap_coworkers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let coworkers = state.staff_self.shift_swap_coworkers(&context).await?;
    Ok(ok(coworkers))
}

async fn staff_self_shift_swaps(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let swaps = state.staff_self.shift_swaps(&context).await?;
    Ok(ok(swaps))
}

async fn staff_self_create_shift_swap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateShiftSwapRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let swap = state
        .staff_self
        .create_shift_swap(&context, request)
        .await?;
    Ok(ok(swap))
}

async fn staff_self_respond_shift_swap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(swap_id): Path<String>,
    Json(request): Json<ShiftSwapDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let swap = state
        .staff_self
        .respond_shift_swap(&context, &swap_id, request)
        .await?;
    Ok(ok(swap))
}

async fn staff_self_cancel_shift_swap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(swap_id): Path<String>,
    Json(request): Json<ShiftSwapCancelRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let swap = state
        .staff_self
        .cancel_shift_swap(&context, &swap_id, request)
        .await?;
    Ok(ok(swap))
}

async fn staff_self_overtime_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let summary = state
        .staff_self
        .overtime_summary(
            &context,
            solastio_application::staff_self::OvertimeSummaryQuery { as_of: None },
        )
        .await?;
    Ok(ok(summary))
}

async fn staff_self_leave_balances(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let balances = state.staff_self.leave_balances(&context).await?;
    Ok(ok(balances))
}

async fn staff_self_workspace_preferences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let prefs = state.staff_self.workspace_preferences(&context).await?;
    Ok(ok(prefs))
}

async fn staff_self_update_notification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<NotificationPatchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let notification = state
        .staff_self
        .update_notification(&context, &id, request)
        .await?;
    Ok(ok(notification))
}

async fn mobile_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<NotificationQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let notifications = state.staff_self.notifications(&context, query).await?;
    Ok(ok(notifications))
}

async fn mobile_update_notification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<NotificationPatchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let notification = state
        .staff_self
        .update_notification(&context, &id, request)
        .await?;
    Ok(ok(notification))
}

#[derive(Debug, Deserialize)]
struct PushDeviceRequest {
    #[serde(rename = "id")]
    device_id: String,
    #[serde(default = "default_platform")]
    platform: String,
    #[serde(default = "default_push_provider")]
    push_provider: String,
    #[serde(default)]
    device_token: String,
    #[serde(default)]
    app_version: String,
    #[serde(default)]
    capabilities: Option<PushCapabilities>,
}

#[derive(Debug, Deserialize, Default)]
struct PushCapabilities {
    #[serde(default = "default_true")]
    pwa: bool,
    #[serde(default)]
    native: bool,
    #[serde(default = "default_true")]
    push_notifications: bool,
}

fn default_platform() -> String {
    "web".to_string()
}

fn default_push_provider() -> String {
    "web-push".to_string()
}

fn default_true() -> bool {
    true
}

async fn mobile_push_config(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let _context = context_from_headers(&state, &headers).await?;
    let public_key = state.config.web_push_public_key.clone().unwrap_or_default();
    let configured = !public_key.is_empty()
        && state
            .config
            .web_push_private_key
            .as_deref()
            .is_some_and(|v| !v.is_empty());
    Ok(ok(
        serde_json::json!({ "configured": configured, "publicKey": public_key }),
    ))
}

async fn mobile_register_device(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PushDeviceRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if request.device_id.trim().is_empty() || request.device_id.len() > 200 {
        return Err(AppError::Validation("Device id is required.".to_string()));
    }
    if request.platform.len() > 40
        || request.push_provider.len() > 40
        || request.device_token.len() > 500
        || request.app_version.len() > 40
    {
        return Err(AppError::Validation("Invalid device fields.".to_string()));
    }
    let capabilities = request.capabilities.unwrap_or_default();
    let capabilities_doc = doc! {
        "pwa": capabilities.pwa,
        "native": capabilities.native,
        "pushNotifications": capabilities.push_notifications,
    };
    state
        .push_devices
        .upsert_device(
            &context.salon_id,
            &context.user_id,
            &request.device_id,
            &request.platform,
            &request.push_provider,
            &request.device_token,
            &request.app_version,
            capabilities_doc,
        )
        .await?;
    Ok(ok(serde_json::json!({ "id": request.device_id })))
}

#[derive(Debug, Deserialize)]
struct PushSubscriptionRequest {
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    keys: Option<serde_json::Map<String, serde_json::Value>>,
}

async fn mobile_push_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PushSubscriptionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let device_id = if request.endpoint.trim().is_empty() {
        format!("sub-{}", now_millis())
    } else {
        request.endpoint.clone()
    };
    let mut subscription_doc = doc! { "endpoint": request.endpoint };
    if let Some(keys) = request.keys {
        let keys_value = serde_json::Value::Object(keys);
        subscription_doc.insert(
            "keys",
            mongodb::bson::to_bson(&keys_value).map_err(|_| AppError::Internal)?,
        );
    }
    state
        .push_devices
        .upsert_subscription(
            &context.salon_id,
            &context.user_id,
            &device_id,
            subscription_doc,
        )
        .await?;
    Ok(ok(serde_json::json!({ "saved": true, "id": device_id })))
}

#[derive(Debug, Deserialize)]
struct WhatsAppVerifyQuery {
    #[serde(rename = "hub.mode")]
    mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    challenge: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppSignupCallbackRequest {
    state: String,
    authorization_code: String,
    #[serde(default)]
    waba_id: Option<String>,
    #[serde(default)]
    phone_number_id: Option<String>,
    #[serde(default)]
    business_id: Option<String>,
    #[serde(default)]
    redirect_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppDisconnectRequest {
    #[serde(default)]
    phone_number_id: Option<String>,
}

fn require_whatsapp_write(
    context: &solastio_application::auth::RequestContext,
) -> Result<(), AppError> {
    if has_permission(&context.permissions, "update:appointments")
        || has_permission(&context.permissions, "admin:*")
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn whatsapp_embedded_signup_configured(config: &AppConfig) -> bool {
    config.meta_app_id.is_some()
        && config.meta_app_secret.is_some()
        && config.meta_config_id.is_some()
}

fn whatsapp_meta_api_version(config: &AppConfig) -> String {
    config
        .meta_api_version
        .clone()
        .unwrap_or_else(|| config.meta_graph_api_version.clone())
}

fn whatsapp_connection_json(doc: &Document) -> serde_json::Value {
    serde_json::json!({
        "id": doc.get_object_id("_id").map(|id| id.to_hex()).unwrap_or_default(),
        "salonId": doc.get_str("salonId").unwrap_or_default(),
        "provider": doc.get_str("provider").unwrap_or("meta_production"),
        "wabaId": doc.get_str("wabaId").unwrap_or_default(),
        "phoneNumberId": doc.get_str("phoneNumberId").unwrap_or_default(),
        "businessId": doc.get_str("businessId").unwrap_or_default(),
        "displayPhoneNumber": doc.get_str("displayPhoneNumber").unwrap_or_default(),
        "verifiedName": doc.get_str("verifiedName").unwrap_or_default(),
        "status": doc.get_str("status").unwrap_or("connected"),
        "webhookSubscribed": doc.get_bool("webhookSubscribed").unwrap_or(false),
        "registrationPending": doc.get_bool("registrationPending").unwrap_or(false),
        "connectedAt": doc.get_datetime("connectedAt").ok().and_then(|d| d.try_to_rfc3339_string().ok()),
        "disconnectedAt": doc.get_datetime("disconnectedAt").ok().and_then(|d| d.try_to_rfc3339_string().ok()),
        "updatedAt": doc.get_datetime("updatedAt").ok().and_then(|d| d.try_to_rfc3339_string().ok()),
    })
}

fn whatsapp_state_signature(config: &AppConfig, payload: &str) -> Result<String, AppError> {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = <HmacSha256 as Mac>::new_from_slice(&encryption_key(config))
        .map_err(|_| AppError::Internal)?;
    mac.update(payload.as_bytes());
    Ok(base64_url_encode(&mac.finalize().into_bytes()))
}

fn whatsapp_state_hash(state: &str) -> String {
    hex_lower(&Sha256::digest(state.as_bytes()))
}

async fn whatsapp_embedded_signup_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_whatsapp_write(&context)?;
    if !whatsapp_embedded_signup_configured(&state.config) {
        return Err(AppError::Validation(
            "Meta Embedded Signup is not configured for this environment.".to_string(),
        ));
    }
    let expires_ms = DateTime::now().timestamp_millis() + 10 * 60 * 1000;
    let nonce: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    let payload = format!(
        "{}.{}.{}.{}",
        context.salon_id, context.user_id, expires_ms, nonce
    );
    let state_value = format!(
        "{}.{}",
        payload,
        whatsapp_state_signature(&state.config, &payload)?
    );
    state
        .whatsapp
        .insert_oauth_state(
            &whatsapp_state_hash(&state_value),
            &context.salon_id,
            &context.user_id,
            DateTime::from_millis(expires_ms),
        )
        .await?;
    Ok(ok(serde_json::json!({
        "state": state_value,
        "expiresAt": DateTime::from_millis(expires_ms).try_to_rfc3339_string().unwrap_or_default(),
        "appId": state.config.meta_app_id.as_deref().unwrap_or_default(),
        "configId": state.config.meta_config_id.as_deref().unwrap_or_default(),
        "apiVersion": whatsapp_meta_api_version(&state.config),
        "provider": "meta_production",
    })))
}

async fn consume_whatsapp_signup_state(
    state: &Arc<AppState>,
    state_value: &str,
    expected_salon_id: &str,
    expected_user_id: &str,
) -> Result<(), AppError> {
    let parts = state_value.split('.').collect::<Vec<_>>();
    if parts.len() != 5 {
        return Err(AppError::Validation(
            "Invalid Embedded Signup state.".to_string(),
        ));
    }
    let payload = format!("{}.{}.{}.{}", parts[0], parts[1], parts[2], parts[3]);
    if whatsapp_state_signature(&state.config, &payload)? != parts[4] {
        return Err(AppError::Validation(
            "Invalid Embedded Signup state signature.".to_string(),
        ));
    }
    if parts[0] != expected_salon_id || parts[1] != expected_user_id {
        return Err(AppError::Authorization);
    }
    let expires_ms = parts[2]
        .parse::<i64>()
        .map_err(|_| AppError::Validation("Invalid Embedded Signup state.".to_string()))?;
    if expires_ms < DateTime::now().timestamp_millis() {
        return Err(AppError::Validation(
            "Embedded Signup state expired. Start again.".to_string(),
        ));
    }
    let state_hash = whatsapp_state_hash(state_value);
    if state
        .whatsapp
        .consume_oauth_state(&state_hash, expected_salon_id, expected_user_id)
        .await?
    {
        return Ok(());
    }
    let existing = state
        .whatsapp
        .oauth_state(&state_hash, expected_salon_id, expected_user_id)
        .await?;
    if let Some(existing) = existing {
        if existing.get_datetime("consumedAt").is_ok() {
            return Err(AppError::Validation(
                "Embedded Signup state has already been used.".to_string(),
            ));
        }
        if existing
            .get_datetime("expiresAt")
            .map(|expires_at| expires_at.timestamp_millis() <= DateTime::now().timestamp_millis())
            .unwrap_or(false)
        {
            return Err(AppError::Validation(
                "Embedded Signup state expired. Start again.".to_string(),
            ));
        }
    }
    Err(AppError::Validation(
        "Invalid Embedded Signup state.".to_string(),
    ))
}

async fn whatsapp_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let connection = state
        .whatsapp
        .connected_connection(&context.salon_id)
        .await?;
    let connections = connection
        .into_iter()
        .map(|doc| whatsapp_connection_json(&doc))
        .collect::<Vec<_>>();
    Ok(ok(serde_json::json!({
        "configured": whatsapp_embedded_signup_configured(&state.config),
        "connections": connections,
    })))
}

fn sanitize_meta_error(message: &str) -> String {
    let mut output = message.to_string();
    if let Some(index) = output.find("access_token=") {
        output.truncate(index + "access_token=".len());
        output.push_str("[redacted]");
    }
    if output.contains("Bearer ") {
        output = output.replace("Bearer ", "Bearer [redacted] ");
    }
    output
}

async fn exchange_embedded_signup_code(
    config: &AppConfig,
    code: &str,
    redirect_uri: Option<&str>,
) -> Result<(String, Option<i64>), AppError> {
    let app_id = config.meta_app_id.as_deref().ok_or_else(|| {
        AppError::Validation("Meta Embedded Signup is not configured.".to_string())
    })?;
    let app_secret = config.meta_app_secret.as_deref().ok_or_else(|| {
        AppError::Validation("Meta Embedded Signup is not configured.".to_string())
    })?;
    let mut url = url::Url::parse(&format!(
        "{}/{}/oauth/access_token",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config)
    ))
    .map_err(|_| AppError::ExternalService)?;
    url.query_pairs_mut()
        .append_pair("client_id", app_id)
        .append_pair("client_secret", app_secret)
        .append_pair("code", code);
    if let Some(redirect_uri) = redirect_uri.filter(|value| !value.trim().is_empty()) {
        url.query_pairs_mut()
            .append_pair("redirect_uri", redirect_uri);
    }
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    let token = payload
        .get("access_token")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    if !status.is_success() || token.is_empty() {
        let message = payload
            .pointer("/error/message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unable to exchange Meta authorization code.");
        return Err(AppError::Validation(sanitize_meta_error(message)));
    }
    Ok((
        token,
        payload.get("expires_in").and_then(|value| value.as_i64()),
    ))
}

async fn meta_get_data(
    config: &AppConfig,
    path: &str,
    access_token: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    let url = format!(
        "{}/{}/{}",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        path.trim_start_matches('/')
    );
    let response = reqwest::Client::new()
        .get(url)
        .query(&[("access_token", access_token)])
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(|value| value.as_str())
            .unwrap_or("Meta API request failed.");
        return Err(AppError::Validation(sanitize_meta_error(message)));
    }
    Ok(payload
        .get("data")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default())
}

async fn fetch_shared_wabas(
    config: &AppConfig,
    access_token: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    if let Ok(data) = meta_get_data(
        config,
        "/me/shared_whatsapp_business_accounts",
        access_token,
    )
    .await
    {
        if !data.is_empty() {
            return Ok(data);
        }
    }
    let mut owned = Vec::new();
    if let Ok(businesses) = meta_get_data(config, "/me/businesses", access_token).await {
        for business in businesses {
            if let Some(business_id) = business.get("id").and_then(|value| value.as_str()) {
                if let Ok(items) = meta_get_data(
                    config,
                    &format!("/{}/owned_whatsapp_business_accounts", business_id),
                    access_token,
                )
                .await
                {
                    owned.extend(items);
                }
            }
        }
    }
    Ok(owned)
}

async fn fetch_waba_phone_numbers(
    config: &AppConfig,
    access_token: &str,
    waba_id: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    meta_get_data(
        config,
        &format!(
            "/{}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating",
            waba_id
        ),
        access_token,
    )
    .await
}

async fn subscribe_waba_to_webhooks(
    config: &AppConfig,
    access_token: &str,
    waba_id: &str,
) -> Result<bool, AppError> {
    let url = format!(
        "{}/{}/{}/subscribed_apps",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        waba_id
    );
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    if status.is_success() {
        return Ok(true);
    }
    let body = response.text().await.unwrap_or_default();
    tracing::error!(
        kind = "waba_subscribe",
        %waba_id,
        status = status.as_u16(),
        body = %body,
        "failed to subscribe app to waba"
    );
    if status.as_u16() == 400 || status.as_u16() == 403 {
        return Ok(false);
    }
    Err(AppError::ExternalService)
}

async fn subscribe_phone_number_to_webhooks(
    config: &AppConfig,
    access_token: &str,
    phone_number_id: &str,
) -> Result<bool, AppError> {
    let url = format!(
        "{}/{}/{}/subscribed_apps",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        phone_number_id
    );
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    if status.is_success() {
        return Ok(true);
    }
    let body = response.text().await.unwrap_or_default();
    tracing::error!(
        kind = "phone_subscribe",
        %phone_number_id,
        status = status.as_u16(),
        body = %body,
        "failed to subscribe app to phone number"
    );
    if status.as_u16() == 400 || status.as_u16() == 403 {
        return Ok(false);
    }
    Err(AppError::ExternalService)
}

async fn register_phone_number(
    config: &AppConfig,
    access_token: &str,
    phone_number_id: &str,
) -> bool {
    let pin = std::env::var("WHATSAPP_REGISTRATION_PIN").unwrap_or_else(|_| "000000".to_string());
    let url = format!(
        "{}/{}/{}/register",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        phone_number_id
    );
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "messaging_product": "whatsapp",
            "pin": pin,
        }))
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!(
                kind = "phone_register",
                %phone_number_id,
                status = status.as_u16(),
                body = %body,
                "register phone number result"
            );
            status.is_success()
        }
        Err(err) => {
            tracing::error!(
                kind = "phone_register",
                %phone_number_id,
                error = ?err,
                "register phone number request failed"
            );
            false
        }
    }
}

async fn probe_phone_platform_type(
    config: &AppConfig,
    access_token: &str,
    phone_number_id: &str,
) -> String {
    let node_url = format!(
        "{}/{}/{}?fields=platform_type",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        phone_number_id
    );
    let response = reqwest::Client::new()
        .get(&node_url)
        .bearer_auth(access_token)
        .send()
        .await;
    let body = match response {
        Ok(response) => response.text().await.unwrap_or_default(),
        Err(_) => return String::new(),
    };
    let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();
    parsed
        .as_ref()
        .and_then(|value| value.get("platform_type"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

async fn register_phone_number_if_needed(
    config: &AppConfig,
    access_token: &str,
    phone_number_id: &str,
) {
    let platform = probe_phone_platform_type(config, access_token, phone_number_id).await;
    if platform == "CLOUD_API" {
        tracing::error!(
            kind = "phone_register",
            %phone_number_id,
            platform = %platform,
            "phone number already registered for cloud api, skipping"
        );
        return;
    }
    tracing::error!(
        kind = "phone_register",
        %phone_number_id,
        platform = %platform,
        "phone number not registered for cloud api, attempting register"
    );
    register_phone_number(config, access_token, phone_number_id).await;
}

async fn deregister_phone_number(
    config: &AppConfig,
    access_token: &str,
    phone_number_id: &str,
) -> bool {
    let url = format!(
        "{}/{}/{}/deregister",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        phone_number_id
    );
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!(
                kind = "phone_deregister",
                %phone_number_id,
                status = status.as_u16(),
                body = %body,
                "deregister phone number result"
            );
            status.is_success()
        }
        Err(err) => {
            tracing::error!(
                kind = "phone_deregister",
                %phone_number_id,
                error = ?err,
                "deregister phone number request failed"
            );
            false
        }
    }
}

async fn whatsapp_cleanup_all(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let ops_key = std::env::var("WHATSAPP_OPS_KEY").unwrap_or_default();
    if ops_key.is_empty() || headers.get("x-ops-key").and_then(|v| v.to_str().ok()) != Some(&ops_key) {
        return Err(AppError::Authorization);
    }
    let connections = state
        .whatsapp
        .list_connected_connections()
        .await
        .map_err(|_| AppError::Database)?;
    tracing::error!(
        kind = "whatsapp_cleanup",
        connections = connections.len(),
        "cleanup started"
    );
    for doc in &connections {
        let encrypted_token = match doc.get_str("encryptedAccessToken") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let token = match decrypt_secret(&state.config, encrypted_token) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let phone_number_id = doc.get_str("phoneNumberId").unwrap_or_default();
        deregister_phone_number(&state.config, &token, phone_number_id).await;
    }
    state.whatsapp.delete_all_data().await.map_err(|_| AppError::Database)?;
    state.salons.clear_all_whatsapp_phone_numbers().await.map_err(|_| AppError::Database)?;
    tracing::error!(kind = "whatsapp_cleanup", "cleanup complete");
    Ok(ok(serde_json::json!({ "deleted": true })))
}

async fn graph_get_probe(
    config: &AppConfig,
    access_token: &str,
    kind: &str,
    path_with_query: &str,
) {
    let url = format!(
        "{}/{}/{}",
        config.meta_graph_api_base_url.trim_end_matches('/'),
        whatsapp_meta_api_version(config),
        path_with_query
    );
    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!(
                kind = "graph_probe",
                %kind,
                status = status.as_u16(),
                body = %body,
                "graph probe result"
            );
        }
        Err(err) => tracing::error!(
            kind = "graph_probe",
            %kind,
            error = ?err,
            "graph probe request failed"
        ),
    }
}

async fn resubscribe_connected_whatsapp(state: Arc<AppState>) {
    let connections = match state.whatsapp.list_connected_connections().await {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(kind = "resubscribe", error = ?err, "list connected connections failed");
            return;
        }
    };
    tracing::error!(kind = "resubscribe", count = connections.len(), "resubscribe task started");
    for connection in connections {
        let Some(encrypted_token) = connection.get_str("encryptedAccessToken").ok() else {
            continue;
        };
        let token = match decrypt_secret(&state.config, encrypted_token) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let waba_id = connection.get_str("wabaId").unwrap_or_default().to_string();
        let phone_number_id = connection
            .get_str("phoneNumberId")
            .unwrap_or_default()
            .to_string();
        let waba_result = subscribe_waba_to_webhooks(&state.config, &token, &waba_id).await;
        let phone_result =
            subscribe_phone_number_to_webhooks(&state.config, &token, &phone_number_id).await;
        let _ = register_phone_number_if_needed(&state.config, &token, &phone_number_id).await;
        match (&waba_result, &phone_result) {
            (Err(waba_err), _) => tracing::error!(
                kind = "resubscribe",
                %waba_id,
                %phone_number_id,
                error = ?waba_err,
                "waba subscribe request failed"
            ),
            (_, Err(phone_err)) => tracing::error!(
                kind = "resubscribe",
                %waba_id,
                %phone_number_id,
                error = ?phone_err,
                "phone subscribe request failed"
            ),
            _ => {}
        }
        let subscribed = waba_result.unwrap_or(false) && phone_result.unwrap_or(false);
        let _ = state
            .whatsapp
            .set_connection_webhook_subscribed(&phone_number_id, subscribed)
            .await;
        tracing::error!(
            kind = "resubscribe_result",
            %waba_id,
            %phone_number_id,
            subscribed,
            "resubscribe result"
        );
        graph_get_probe(
            &state.config,
            &token,
            "phone_webhook_config",
            &format!(
                "{}/?fields=id,display_phone_number,verified_name,platform_type,code_verification_status,webhook_configuration",
                phone_number_id
            ),
        )
        .await;
        graph_get_probe(
            &state.config,
            &token,
            "waba_subscribed_apps",
            &format!("{}/subscribed_apps", waba_id),
        )
        .await;
        let _ = graph_get_probe(
            &state.config,
            &token,
            "waba_info",
            &format!(
                "{}/?fields=id,name,account_status,timezone_id,currency",
                waba_id
            ),
        )
        .await;
    }
}

async fn whatsapp_embedded_signup_callback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<WhatsAppSignupCallbackRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_whatsapp_write(&context)?;
    if request.state.trim().len() < 20 || request.authorization_code.trim().len() < 5 {
        return Err(AppError::Validation(
            "Invalid Embedded Signup callback.".to_string(),
        ));
    }
    consume_whatsapp_signup_state(&state, &request.state, &context.salon_id, &context.user_id)
        .await?;
    let (access_token, expires_in) = exchange_embedded_signup_code(
        &state.config,
        request.authorization_code.trim(),
        request.redirect_uri.as_deref(),
    )
    .await?;
    let mut waba_id = request
        .waba_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if waba_id.is_none() {
        let shared_wabas = fetch_shared_wabas(&state.config, &access_token).await?;
        waba_id = shared_wabas
            .first()
            .and_then(|item| item.get("id"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
    }
    if waba_id.is_none() {
        waba_id = state
            .config
            .meta_waba_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }
    let waba_id = waba_id.ok_or_else(|| {
        AppError::Validation(
            "Meta did not return a WhatsApp Business Account id. Complete Embedded Signup again."
                .to_string(),
        )
    })?;
    let phone_numbers = fetch_waba_phone_numbers(&state.config, &access_token, &waba_id).await?;
    let phone_number_id = request
        .phone_number_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let selected_phone = if let Some(id) = phone_number_id {
        phone_numbers
            .iter()
            .find(|item| item.get("id").and_then(|value| value.as_str()) == Some(id))
            .ok_or_else(|| AppError::Validation("Selected WhatsApp phone number was not returned by Meta. Complete Embedded Signup again.".to_string()))?
    } else if phone_numbers.len() == 1 {
        &phone_numbers[0]
    } else {
        return Err(AppError::Validation(
            "Meta did not return the selected WhatsApp phone number id. Complete Embedded Signup again and select the exact number.".to_string(),
        ));
    };
    let phone_number_id = selected_phone
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            AppError::Validation(
                "No accessible WhatsApp phone number was returned by Meta for this WABA."
                    .to_string(),
            )
        })?;
    if let Some(existing) = state
        .whatsapp
        .connection_by_phone_number(phone_number_id)
        .await?
    {
        if existing.get_str("salonId").unwrap_or_default() != context.salon_id {
            return Err(AppError::Conflict(
                "This WhatsApp phone number is already connected to another Solastio workspace."
                    .to_string(),
            ));
        }
    }
    let webhook_subscribed =
        subscribe_waba_to_webhooks(&state.config, &access_token, &waba_id).await?
            && subscribe_phone_number_to_webhooks(
                &state.config,
                &access_token,
                phone_number_id,
            )
            .await?;
    let _ = register_phone_number(&state.config, &access_token, phone_number_id).await;
    let registration_pending =
        probe_phone_platform_type(&state.config, &access_token, phone_number_id).await != "CLOUD_API";
    let encrypted_access_token = encrypt_secret(&state.config, &access_token)?;
    let token_expires_at = expires_in
        .map(|seconds| DateTime::from_millis(DateTime::now().timestamp_millis() + seconds * 1000));
    let display_phone_number = selected_phone
        .get("display_phone_number")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let verified_name = selected_phone
        .get("verified_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let doc = state
        .whatsapp
        .upsert_connection(
            &context.salon_id,
            &context.user_id,
            "meta_production",
            &waba_id,
            phone_number_id,
            request.business_id.as_deref().unwrap_or_default(),
            display_phone_number,
            verified_name,
            &encrypted_access_token,
            token_expires_at,
            webhook_subscribed,
            registration_pending,
        )
        .await?;
    state
        .salons
        .add_whatsapp_phone_number(&context.salon_id, phone_number_id)
        .await?;
    Ok(ok(
        serde_json::json!({ "connection": whatsapp_connection_json(&doc) }),
    ))
}

async fn whatsapp_disconnect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<WhatsAppDisconnectRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_whatsapp_write(&context)?;
    let doc = state
        .whatsapp
        .disconnect_connection(&context.salon_id, request.phone_number_id.as_deref())
        .await?;
    if let Ok(phone_number_id) = doc.get_str("phoneNumberId") {
        state
            .salons
            .remove_whatsapp_phone_number(&context.salon_id, phone_number_id)
            .await?;
    }
    Ok(ok(
        serde_json::json!({ "connection": whatsapp_connection_json(&doc) }),
    ))
}

async fn whatsapp_verify_webhook(
    State(state): State<Arc<AppState>>,
    Query(query): Query<WhatsAppVerifyQuery>,
) -> impl IntoResponse {
    let expected = state
        .config
        .verify_token
        .as_deref()
        .or(state.config.meta_webhook_verify_token.as_deref());
    if query.mode.as_deref() == Some("subscribe")
        && expected.is_some()
        && query.verify_token.as_deref() == expected
    {
        return (StatusCode::OK, query.challenge.unwrap_or_default()).into_response();
    }
    StatusCode::FORBIDDEN.into_response()
}

async fn whatsapp_receive_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<axum::response::Response, AppError> {
    if !verify_meta_signature(&state.config, &headers, &body)? {
        return Err(AppError::Authorization);
    }
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::Validation("Invalid WhatsApp webhook payload.".to_string()))?;
    state
        .whatsapp
        .insert_webhook_event(doc! {
            "provider": "meta",
            "payload": mongodb::bson::to_bson(&payload).map_err(|_| AppError::Validation("Invalid WhatsApp webhook payload.".to_string()))?,
            "receivedAt": DateTime::now(),
        })
        .await?;
    for status in extract_whatsapp_statuses(&payload) {
        state
            .whatsapp
            .apply_delivery_status(
                &status.provider_message_id,
                &status.status,
                DateTime::from_millis(status.timestamp_ms),
            )
            .await?;
    }
    if let Some(message) = extract_whatsapp_message(&payload) {
        let inbound_message = message.clone();
        let connection = state
            .whatsapp
            .salon_for_phone_number_id(&message.phone_number_id)
            .await?;
        state
            .whatsapp
            .insert_inbound(doc! {
                "salonId": connection.as_ref().and_then(|doc| doc.get_str("salonId").ok()).unwrap_or_default(),
                "phoneNumberId": message.phone_number_id,
                "waPhone": message.wa_phone,
                "profileName": message.profile_name,
                "messageId": message.message_id,
                "text": message.text,
                "timestamp": DateTime::from_millis(message.timestamp_ms),
                "receivedAt": DateTime::from_millis(message.timestamp_ms),
                "interactiveId": message.interactive_id,
                "messageType": message.message_type,
                "flowResponse": mongodb::bson::to_bson(&message.flow_response).map_err(|_| AppError::Validation("Invalid WhatsApp flow response.".to_string()))?,
                "createdAt": DateTime::now(),
            })
            .await?;
        if inbound_message.message_type == "text" || inbound_message.message_type == "interactive" {
            tokio::spawn({
                let state = state.clone();
                async move {
                    if let Err(error) = handle_whatsapp_inbound(&state, &inbound_message).await {
                        tracing::warn!(%error, "whatsapp inbound bot handling failed");
                    }
                }
            });
        }
    }
    Ok(ok(serde_json::json!({ "received": true })))
}

fn wa_normalize_phone(raw: &str, profile_name: &str) -> (String, String) {
    let digits: String = raw.chars().filter(|value| value.is_ascii_digit()).collect();
    let normalized = if digits.len() == 11
        && digits.starts_with('9')
        && profile_name.chars().all(|c| !c.is_ascii_digit())
    {
        solastio_shared::phone::normalize_phone_india(&digits[1..])
    } else {
        solastio_shared::phone::normalize_phone_india(&digits)
    };
    let display = format!("+{normalized}");
    (display, normalized)
}

fn opt_out_keyword(lower: &str) -> bool {
    let trimmed = lower.trim();
    trimmed == "stop"
        || trimmed == "unsubscribe"
        || trimmed == "opt out"
        || trimmed == "stop all"
        || trimmed == "sair"
        || trimmed == "leave"
        || trimmed == "quit"
        || trimmed == "cancelar"
        || trimmed == "parar"
}

async fn handle_whatsapp_inbound(
    state: &Arc<AppState>,
    message: &WhatsAppInboundMessage,
) -> Result<(), AppError> {
    let Some(connection) = state
        .whatsapp
        .salon_for_phone_number_id(&message.phone_number_id)
        .await?
    else {
        return Ok(());
    };
    let salon_id = connection
        .get_str("salonId")
        .map_err(|_| AppError::Database)?
        .to_string();
    let (_display, normalized) = wa_normalize_phone(&message.wa_phone, &message.profile_name);
    let lower = message.text.to_lowercase();

    if opt_out_keyword(&lower) {
        let _ = state
            .whatsapp
            .set_customer_opt_out(&salon_id, &normalized, true)
            .await;
        let _ = send_whatsapp_message(
            state,
            &salon_id,
            &normalized,
            "utility",
            "You have been unsubscribed from updates and promotions.\nReply START to re-subscribe.",
            None,
            serde_json::json!({ "source": "opt_out" }),
        )
        .await;
        return Ok(());
    }
    if lower.trim() == "start" || lower.trim() == "restart" {
        let _ = state
            .whatsapp
            .set_customer_opt_out(&salon_id, &normalized, false)
            .await;
        let _ = state
            .whatsapp
            .clear_booking_session(&salon_id, &normalized)
            .await;
        return drive_booking_step(
            state,
            &salon_id,
            &normalized,
            &message.profile_name,
            "start",
        )
        .await;
    }
    if lower.trim() == "book" {
        if let Some(appointment) = state
            .appointment_repo
            .claim_waitlist_offer(&salon_id, &normalized)
            .await?
        {
            let service_names = appointment
                .get("serviceNames")
                .and_then(|value| value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let appointment_id = appointment
                .get_object_id("_id")
                .map(|oid| oid.to_hex())
                .unwrap_or_default();
            let _ = send_whatsapp_message(
                state,
                &salon_id,
                &normalized,
                "confirmation",
                &format!(
                    "Booked. Your waitlist slot for {} is confirmed. Booking ID: {}",
                    service_names, appointment_id
                ),
                None,
                serde_json::json!({ "source": "waitlist_claimed", "appointmentId": appointment_id }),
            )
            .await;
            return Ok(());
        }
    }
    if handle_review_reply(state, &salon_id, &normalized, &lower).await? {
        return Ok(());
    }
    if state
        .whatsapp
        .get_booking_session(&salon_id, &normalized)
        .await?
        .is_none()
    {
        if let Some(reply) = concierge_reply(state, &salon_id, &normalized, &message.text).await? {
            let _ = send_whatsapp_message(
                state,
                &salon_id,
                &normalized,
                "utility",
                &reply,
                None,
                serde_json::json!({ "source": "openai_concierge" }),
            )
            .await;
            return Ok(());
        }
    }
    drive_booking_step(state, &salon_id, &normalized, &message.profile_name, &lower).await
}

async fn handle_review_reply(
    state: &Arc<AppState>,
    salon_id: &str,
    wa_phone: &str,
    lower: &str,
) -> Result<bool, AppError> {
    let positive = [
        "5",
        "4",
        "great",
        "good",
        "excellent",
        "love",
        "happy",
        "thanks",
    ]
    .iter()
    .any(|needle| lower.split_whitespace().any(|part| part == *needle) || lower.contains(needle));
    let negative = [
        "1", "2", "bad", "poor", "terrible", "unhappy", "angry", "issue", "problem",
    ]
    .iter()
    .any(|needle| lower.split_whitespace().any(|part| part == *needle) || lower.contains(needle));
    if !positive && !negative {
        return Ok(false);
    }
    let outbounds = state
        .store
        .database
        .collection::<Document>("whatsappoutbounds");
    let recent_cutoff =
        DateTime::from_millis(DateTime::now().timestamp_millis() - 7 * 24 * 60 * 60_000);
    let recent_request = outbounds
        .find_one(
            doc! {
                "salonId": salon_id,
                "toPhone": wa_phone,
                "metadata.source": "review_request",
                "createdAt": { "$gte": recent_cutoff },
            },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    if recent_request.is_none() {
        return Ok(false);
    }
    if negative {
        let _ = state
            .whatsapp
            .add_customer_tags(
                salon_id,
                wa_phone,
                vec![
                    "service_recovery".to_string(),
                    "negative_feedback".to_string(),
                ],
            )
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            "Thank you for telling us. I’ve flagged this for the salon team so they can follow up and make it right.",
            None,
            serde_json::json!({ "source": "review_reply", "sentiment": "negative" }),
        )
        .await;
        return Ok(true);
    }
    let _ = state
        .whatsapp
        .add_customer_tags(
            salon_id,
            wa_phone,
            vec!["happy_customer".to_string(), "rebook_candidate".to_string()],
        )
        .await;
    let _ = send_whatsapp_message(
        state,
        salon_id,
        wa_phone,
        "utility",
        "Thank you! We’re glad you liked it. Want to rebook in a few weeks? Send REBOOK anytime.",
        None,
        serde_json::json!({ "source": "review_reply", "sentiment": "positive" }),
    )
    .await;
    Ok(true)
}

async fn concierge_reply(
    state: &Arc<AppState>,
    salon_id: &str,
    wa_phone: &str,
    text: &str,
) -> Result<Option<String>, AppError> {
    if !state.config.whatsapp_concierge_enabled || text.trim().is_empty() {
        return Ok(None);
    }
    let Some(api_key) = state.config.openai_api_key.as_deref() else {
        return Ok(None);
    };
    if obvious_booking_signal(text) {
        return Ok(None);
    }
    let customer_name = state
        .whatsapp
        .customer_by_normalized_phone(salon_id, wa_phone, 1)
        .await
        .ok()
        .and_then(|customers| customers.into_iter().next())
        .and_then(|doc| doc.get_str("name").ok().map(str::to_string))
        .unwrap_or_else(|| "there".to_string());
    let model = state
        .config
        .whatsapp_concierge_model
        .clone()
        .unwrap_or_else(|| state.config.openai_model.clone());
    let prompt = format!(
        "You are a multilingual salon WhatsApp receptionist for salon id {salon_id}. Customer: {customer_name}. Reply in the same language/script as the user, keep it short, and do not invent prices, staff names, hours, or availability. For booking, cancellation, rescheduling, or detailed pricing, direct them to reply BOOK or MENU. User message: {}",
        text.chars().take(500).collect::<String>()
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "temperature": 0,
            "messages": [
                { "role": "system", "content": "Return only the WhatsApp reply text. No markdown." },
                { "role": "user", "content": prompt }
            ]
        }))
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    let reply = payload
        .pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok((!reply.is_empty()).then_some(reply.chars().take(900).collect()))
}

fn obvious_booking_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "book",
        "appointment",
        "service",
        "price",
        "rate",
        "cancel",
        "reschedule",
        "slot",
        "hair",
        "facial",
        "spa",
        "nail",
        "wax",
        "massage",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

async fn drive_booking_step(
    state: &Arc<AppState>,
    salon_id: &str,
    wa_phone: &str,
    profile_name: &str,
    input: &str,
) -> Result<(), AppError> {
    let session = state
        .whatsapp
        .get_booking_session(salon_id, wa_phone)
        .await?;
    let session_state = session
        .as_ref()
        .and_then(|doc| doc.get_str("state").ok())
        .unwrap_or("")
        .to_string();

    if input.trim().eq_ignore_ascii_case("cancel") {
        let _ = state
            .whatsapp
            .clear_booking_session(salon_id, wa_phone)
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            "Booking cancelled. Send another message anytime to book again.",
            None,
            serde_json::json!({ "source": "booking_cancel" }),
        )
        .await;
        return Ok(());
    }

    let branches = state
        .self_booking
        .branches(solastio_application::self_booking::SalonQuery {
            salon_id: salon_id.to_string(),
        })
        .await
        .unwrap_or_else(|_| solastio_application::self_booking::BranchesResponse {
            branches: vec![],
        });

    if session_state.is_empty() || session_state == "start" {
        if branches.branches.is_empty() {
            return Ok(());
        }
        if branches.branches.len() == 1 {
            let branch = &branches.branches[0];
            let _ = state
                .whatsapp
                .upsert_booking_session(
                    salon_id,
                    wa_phone,
                    doc! { "state": "select_service", "branchId": branch.id.clone(), "branchName": branch.name.clone() },
                )
                .await;
            return prompt_services(state, salon_id, wa_phone, &branch.id).await;
        }
        let _ = state
            .whatsapp
            .upsert_booking_session(salon_id, wa_phone, doc! { "state": "select_branch" })
            .await;
        let list: Vec<String> = branches
            .branches
            .iter()
            .enumerate()
            .map(|(index, branch)| format!("{}. {}", index + 1, branch.name))
            .collect();
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            &format!(
                "Welcome{}! Which branch would you like to visit?\n{}",
                greeting(profile_name),
                list.join("\n")
            ),
            None,
            serde_json::json!({ "source": "booking_branch" }),
        )
        .await;
        return Ok(());
    }

    if session_state == "select_branch" {
        let selected = parse_option(input)
            .and_then(|index| branches.branches.get(index))
            .or_else(|| {
                branches
                    .branches
                    .iter()
                    .find(|branch| input.contains(&branch.name.to_lowercase()))
            });
        let Some(branch) = selected else {
            let list: Vec<String> = branches
                .branches
                .iter()
                .enumerate()
                .map(|(index, branch)| format!("{}. {}", index + 1, branch.name))
                .collect();
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                &format!(
                    "I didn't catch that. Please choose a branch number:\n{}",
                    list.join("\n")
                ),
                None,
                serde_json::json!({ "source": "booking_branch" }),
            )
            .await;
            return Ok(());
        };
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "state": "select_service", "branchId": branch.id.clone(), "branchName": branch.name.clone() },
            )
            .await;
        return prompt_services(state, salon_id, wa_phone, &branch.id).await;
    }

    if session_state == "select_service" {
        let branch_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("branchId").ok())
            .unwrap_or_default();
        let services = state
            .self_booking
            .services(solastio_application::self_booking::BranchQuery {
                salon_id: salon_id.to_string(),
                branch_id: branch_id.to_string(),
            })
            .await
            .unwrap_or_else(|_| solastio_application::self_booking::ServicesResponse {
                services: vec![],
            });
        let parsed_index = parse_option_strict(input);
        let memory_service_id =
            if input.contains("same") || input.contains("last time") || input.contains("usual") {
                state
                    .whatsapp
                    .customer_by_normalized_phone(salon_id, wa_phone, 1)
                    .await
                    .ok()
                    .and_then(|customers| customers.into_iter().next())
                    .and_then(|customer| {
                        customer
                            .get("favoriteServiceIds")
                            .and_then(|value| value.as_array())
                            .and_then(|items| {
                                items
                                    .iter()
                                    .rev()
                                    .find_map(|item| item.as_str().map(str::to_string))
                            })
                    })
            } else {
                None
            };
        let selected = if let Some(index) = parsed_index {
            services.services.get(index)
        } else if let Some(service_id) = memory_service_id.as_deref() {
            services
                .services
                .iter()
                .find(|service| service.id == service_id)
        } else {
            services
                .services
                .iter()
                .find(|service| service_name_matches(input, &service.name))
        };
        let Some(service) = selected else {
            if input.trim() == "done"
                || input.trim().eq_ignore_ascii_case("confirm")
                || lower_starts(input, "book")
            {
                if services.services.is_empty() {
                    let _ = send_whatsapp_message(
                        state,
                        salon_id,
                        wa_phone,
                        "utility",
                        "Sorry, there are no bookable services in that branch right now. Please try another branch or message the salon directly.",
                        None,
                        serde_json::json!({ "source": "booking_service_empty" }),
                    )
                    .await;
                    return Ok(());
                }
                return prompt_staff(
                    state,
                    salon_id,
                    wa_phone,
                    branch_id,
                    &services.services[0].id,
                    &services.services[0].name,
                )
                .await;
            }
            let list: Vec<String> = services
                .services
                .iter()
                .enumerate()
                .map(|(index, service)| {
                    format!(
                        "{}. {} (Rs {:.0}, {} min)",
                        index + 1,
                        service.name,
                        service.price_paise as f64 / 100.0,
                        service.duration_minutes
                    )
                })
                .collect();
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                &format!(
                    "What service would you like?\n{}\nReply a number, or type to search.",
                    list.join("\n")
                ),
                None,
                serde_json::json!({ "source": "booking_service" }),
            )
            .await;
            return Ok(());
        };
        let service_id = service.id.clone();
        let service_name = service.name.clone();
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "state": "select_staff", "serviceId": service_id.clone(), "serviceName": service_name.clone(), "servicePricePaise": service.price_paise, "durationMinutes": service.duration_minutes },
            )
            .await;
        return prompt_staff(
            state,
            salon_id,
            wa_phone,
            branch_id,
            &service_id,
            &service_name,
        )
        .await;
    }

    if session_state == "select_staff" {
        let branch_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("branchId").ok())
            .unwrap_or_default();
        let service_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("serviceId").ok())
            .unwrap_or_default();
        let service_name = session
            .as_ref()
            .and_then(|doc| doc.get_str("serviceName").ok())
            .unwrap_or("")
            .to_string();
        let staff = state
            .self_booking
            .staff(solastio_application::self_booking::StaffQuery {
                salon_id: salon_id.to_string(),
                branch_id: branch_id.to_string(),
                service_id: Some(service_id.to_string()),
            })
            .await
            .unwrap_or_else(|_| solastio_application::self_booking::StaffResponse {
                staff: vec![],
            });
        let memory_staff_id =
            if input.contains("same") || input.contains("last") || input.contains("usual") {
                state
                    .whatsapp
                    .customer_by_normalized_phone(salon_id, wa_phone, 1)
                    .await
                    .ok()
                    .and_then(|customers| customers.into_iter().next())
                    .and_then(|customer| {
                        customer
                            .get("preferredStaffIds")
                            .and_then(|value| value.as_array())
                            .and_then(|items| {
                                items
                                    .iter()
                                    .rev()
                                    .find_map(|item| item.as_str().map(str::to_string))
                            })
                    })
            } else {
                None
            };
        let selected = if input.trim().eq_ignore_ascii_case("any")
            || input.trim() == "0"
            || input.trim().eq_ignore_ascii_case("anyone")
        {
            None
        } else if let Some(staff_id) = memory_staff_id.as_deref() {
            staff.staff.iter().find(|member| member.id == staff_id)
        } else {
            parse_option_strict(input)
                .and_then(|index| staff.staff.get(index))
                .or_else(|| {
                    staff
                        .staff
                        .iter()
                        .find(|member| service_name_matches(input, &member.name))
                })
        };
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "staffId": selected.map(|s| s.id.clone()).unwrap_or_default(), "staffName": selected.map(|s| s.name.clone()).unwrap_or_else(|| "Any".to_string()), "state": "select_date" },
            )
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            "Great! What date would you like? (e.g. 2026-09-10 or tomorrow)",
            None,
            serde_json::json!({ "source": "booking_date", "serviceName": service_name }),
        )
        .await;
        return Ok(());
    }

    if session_state == "select_date" {
        let branch_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("branchId").ok())
            .unwrap_or_default();
        let service_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("serviceId").ok())
            .unwrap_or_default();
        let date = resolve_date(input);
        let Some(date) = date else {
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                "I couldn't understand that date. Please reply in YYYY-MM-DD format.",
                None,
                serde_json::json!({ "source": "booking_date" }),
            )
            .await;
            return Ok(());
        };
        let slots = state
            .self_booking
            .slots(solastio_application::self_booking::SlotsQuery {
                salon_id: salon_id.to_string(),
                branch_id: branch_id.to_string(),
                service_id: service_id.to_string(),
                date: date.clone(),
                staff_id: session
                    .as_ref()
                    .and_then(|doc| doc.get_str("staffId").ok())
                    .filter(|id| !id.is_empty())
                    .map(str::to_string),
                max_slots: Some(12),
            })
            .await
            .unwrap_or_else(|_| solastio_application::self_booking::SlotsResponse {
                slots: vec![],
            });
        let slots_json = serde_json::json!(&slots.slots);
        let all_slot_values = slots_json.as_array().cloned().unwrap_or_default();
        let preference = parse_time_preference(input);
        let slot_values = if time_preference_active(&preference) {
            filter_slots_by_preference(all_slot_values.clone(), &preference)
        } else {
            all_slot_values.clone()
        };
        if slot_values.is_empty() {
            let service_name = session
                .as_ref()
                .and_then(|doc| doc.get_str("serviceName").ok())
                .unwrap_or_default()
                .to_string();
            let staff_id = session
                .as_ref()
                .and_then(|doc| doc.get_str("staffId").ok())
                .unwrap_or_default()
                .to_string();
            let preferred_time = preference.time.clone().unwrap_or_default();
            let added = state
                .whatsapp
                .add_waitlist_entry(
                    salon_id,
                    branch_id,
                    &staff_id,
                    vec![service_id.to_string()],
                    vec![service_name.clone()],
                    &date,
                    &preferred_time,
                    wa_phone,
                )
                .await
                .unwrap_or(false);
            let waitlist_reply = if added {
                format!(
                    "No free slots matched {}{}. I added you to the waitlist for {}. I'll message you if a spot opens.",
                    date,
                    if preferred_time.is_empty() {
                        "".to_string()
                    } else {
                        format!(" around {preferred_time}")
                    },
                    service_name
                )
            } else {
                "You're already on the waitlist for that service/date. I'll message you if a spot opens.".to_string()
            };
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                &waitlist_reply,
                None,
                serde_json::json!({ "source": "waitlist_added" }),
            )
            .await;
            return Ok(());
        }
        let slot_list: Vec<String> = slot_values
            .iter()
            .enumerate()
            .map(|(index, slot)| {
                let time = slot
                    .get("startAt")
                    .and_then(|value| value.as_str())
                    .map(format_time)
                    .unwrap_or_default();
                let staff_id = slot
                    .get("staffId")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                format!("{}. {} ({})", index + 1, time, staff_id)
            })
            .collect();
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "state": "select_time", "bookingDate": date.clone(), "availableSlots": mongodb::bson::to_bson(&slot_values).map_err(|_| AppError::Database)? },
            )
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            &format!(
                "Available times on {}:\n{}\nReply a number to choose.",
                date,
                slot_list.join("\n")
            ),
            None,
            serde_json::json!({ "source": "booking_time" }),
        )
        .await;
        return Ok(());
    }

    if session_state == "select_time" {
        let _branch_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("branchId").ok())
            .unwrap_or_default();
        let _service_id = session
            .as_ref()
            .and_then(|doc| doc.get_str("serviceId").ok())
            .unwrap_or_default();
        let service_name = session
            .as_ref()
            .and_then(|doc| doc.get_str("serviceName").ok())
            .unwrap_or("")
            .to_string();
        let booking_date = session
            .as_ref()
            .and_then(|doc| doc.get_str("bookingDate").ok())
            .unwrap_or_default()
            .to_string();
        let slots_value: Vec<serde_json::Value> = session
            .as_ref()
            .and_then(|doc| doc.get("availableSlots"))
            .and_then(mongodb::bson::Bson::as_array)
            .and_then(|array| {
                mongodb::bson::from_bson(mongodb::bson::Bson::Array(array.clone())).ok()
            })
            .unwrap_or_default();
        let selected = parse_option_strict(input)
            .and_then(|index| slots_value.get(index).cloned())
            .or_else(|| {
                filter_slots_by_preference(slots_value.clone(), &parse_time_preference(input))
                    .into_iter()
                    .next()
            });
        let Some(selected_slot) = selected else {
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                "Please reply the number of the time you'd like.",
                None,
                serde_json::json!({ "source": "booking_time" }),
            )
            .await;
            return Ok(());
        };
        let slot_start = selected_slot
            .get("startAt")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let slot_end = selected_slot
            .get("endAt")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let slot_staff = selected_slot
            .get("staffId")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let value_paise = session
            .as_ref()
            .and_then(|doc| doc.get_i64("servicePricePaise").ok())
            .unwrap_or(0);
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "state": "confirm", "startAt": slot_start.clone(), "endAt": slot_end.clone(), "chosenStaffId": slot_staff.clone() },
            )
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            &format!("Please confirm:\nService: {}\nDate: {}\nTime: {}\nPrice: Rs {:.0}\nReply CONFIRM to book, or CANCEL to change your mind.", service_name, booking_date, format_time(&slot_start), value_paise as f64 / 100.0),
            None,
            serde_json::json!({ "source": "booking_confirm" }),
        )
        .await;
        return Ok(());
    }

    if session_state == "confirm" {
        if input.trim().eq_ignore_ascii_case("confirm") {
            let branch_id = session
                .as_ref()
                .and_then(|doc| doc.get_str("branchId").ok())
                .unwrap_or_default();
            let service_id = session
                .as_ref()
                .and_then(|doc| doc.get_str("serviceId").ok())
                .unwrap_or_default();
            let start_at = session
                .as_ref()
                .and_then(|doc| doc.get_str("startAt").ok())
                .unwrap_or_default()
                .to_string();
            let service_name = session
                .as_ref()
                .and_then(|doc| doc.get_str("serviceName").ok())
                .unwrap_or("")
                .to_string();
            let customer_name = if profile_name.trim().is_empty() {
                "WhatsApp Guest".to_string()
            } else {
                profile_name.trim().to_string()
            };
            let book_request = solastio_application::self_booking::BookRequest {
                salon_id: salon_id.to_string(),
                branch_id: branch_id.to_string(),
                service_id: service_id.to_string(),
                start_at,
                customer_name: customer_name.clone(),
                phone: wa_phone.to_string(),
                preferred_staff_id: session
                    .as_ref()
                    .and_then(|doc| doc.get_str("chosenStaffId").ok())
                    .filter(|id| !id.is_empty())
                    .map(str::to_string),
            };
            match state.self_booking.book(book_request).await {
                Ok(booked) => {
                    let _ = state
                        .whatsapp
                        .clear_booking_session(salon_id, wa_phone)
                        .await;
                    let appointment_id = ObjectId::parse_str(&booked.appointment_id)
                        .map_err(|_| AppError::Database)?;
                    let value_paise = session
                        .as_ref()
                        .and_then(|doc| doc.get_i64("servicePricePaise").ok())
                        .unwrap_or(0);
                    if let Ok((enabled, mode, fixed, percent, minimum)) = state
                        .appointment_repo
                        .booking_deposit_config(salon_id, branch_id)
                        .await
                    {
                        let deposit_paise = if enabled && value_paise > 0 {
                            if mode == "fixed" {
                                value_paise.min(fixed.max(0))
                            } else {
                                value_paise.min(((value_paise * percent) / 100).max(minimum))
                            }
                        } else {
                            0
                        };
                        if deposit_paise > 0
                            && razorpay_configured(&state.config)
                            && !wa_phone.is_empty()
                        {
                            if let Ok(link) = create_razorpay_payment_link(
                                &state.config,
                                deposit_paise,
                                &customer_name,
                                wa_phone,
                                &booked.appointment_id,
                                salon_id,
                            )
                            .await
                            {
                                let _ = state
                                    .appointment_repo
                                    .apply_deposit_hold(
                                        salon_id,
                                        appointment_id,
                                        link.get_str("id").unwrap_or_default(),
                                        link.get_str("shortUrl").unwrap_or_default(),
                                        deposit_paise,
                                    )
                                    .await;
                                let _ = send_whatsapp_message(
                                    state,
                                    salon_id,
                                    wa_phone,
                                    "deposit",
                                    &format!(
                                        "Your slot is held for your appointment.\nAdvance deposit of Rs {:.2} is required.\nPay here: {}\nThe slot will be released in 30 minutes if not paid.",
                                        deposit_paise as f64 / 100.0,
                                        link.get_str("shortUrl").unwrap_or_default()
                                    ),
                                    None,
                                    serde_json::json!({ "source": "booking_deposit", "appointmentId": booked.appointment_id }),
                                )
                                .await;
                                return Ok(());
                            }
                        }
                    }
                    if let Ok(start_at) = chrono::DateTime::parse_from_rfc3339(&booked.start_at) {
                        let _ = state
                            .whatsapp
                            .record_customer_booking(
                                salon_id,
                                wa_phone,
                                &booked.staff_id,
                                vec![service_id.to_string()],
                                DateTime::from_millis(start_at.timestamp_millis()),
                            )
                            .await;
                    }
                    let _ = send_whatsapp_message(
                        state,
                        salon_id,
                        wa_phone,
                        "confirmation",
                        &format!("Your appointment is booked, {}!\nService: {}\nAt: {}\nBooking id: {}\nWe look forward to seeing you.", customer_name, service_name, format_time(&booked.start_at), booked.appointment_id),
                        None,
                        serde_json::json!({ "source": "booking_confirmed", "appointmentId": booked.appointment_id }),
                    )
                    .await;
                }
                Err(error) => {
                    let _ = send_whatsapp_message(
                        state,
                        salon_id,
                        wa_phone,
                        "utility",
                        &format!("Sorry, we couldn't book that: {}", error_message(&error)),
                        None,
                        serde_json::json!({ "source": "booking_error" }),
                    )
                    .await;
                }
            }
        } else {
            let _ = send_whatsapp_message(
                state,
                salon_id,
                wa_phone,
                "utility",
                "Reply CONFIRM to book, or CANCEL to change your mind.",
                None,
                serde_json::json!({ "source": "booking_confirm" }),
            )
            .await;
        }
        return Ok(());
    }

    Ok(())
}

fn greeting(profile_name: &str) -> String {
    if profile_name.is_empty() {
        return "".to_string();
    }
    format!(" Hi {},", profile_name)
}

fn parse_option(input: &str) -> Option<usize> {
    input
        .trim()
        .parse::<usize>()
        .ok()
        .and_then(|value| value.checked_sub(1))
}

fn parse_option_strict(input: &str) -> Option<usize> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .parse::<usize>()
        .ok()
        .and_then(|value| value.checked_sub(1))
}

fn lower_starts(input: &str, prefix: &str) -> bool {
    input.to_lowercase().starts_with(prefix)
}

fn normalized_name_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn service_name_matches(input: &str, name: &str) -> bool {
    let input_key = normalized_name_key(input);
    let name_key = normalized_name_key(name);
    !input_key.is_empty()
        && !name_key.is_empty()
        && (input_key.contains(&name_key) || name_key.contains(&input_key))
}

#[derive(Clone, Debug, Default)]
struct TimePreference {
    time: Option<String>,
    after: Option<i64>,
    before: Option<i64>,
    flexible: bool,
}

fn resolve_date(input: &str) -> Option<String> {
    let trimmed = input.trim().to_lowercase();
    let today = (chrono::Utc::now() + chrono::Duration::minutes(330)).date_naive();
    if ["day after tomorrow", "parso", "parson"]
        .iter()
        .any(|needle| trimmed.contains(needle))
    {
        return Some(
            (today + chrono::Duration::days(2))
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if [
        "tomorrow", "tomorow", "tommorow", "tmrw", "tmr", "2moro", "kal",
    ]
    .iter()
    .any(|needle| trimmed.contains(needle))
    {
        return Some(
            (today + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if ["today", "aaj", "aj", "ajj"]
        .iter()
        .any(|needle| trimmed.contains(needle))
    {
        return Some(today.format("%Y-%m-%d").to_string());
    }
    if let Ok(parsed) = chrono::NaiveDate::parse_from_str(
        trimmed.trim_end_matches(|c: char| !c.is_ascii_digit()),
        "%Y-%m-%d",
    ) {
        return Some(parsed.format("%Y-%m-%d").to_string());
    }
    let cleaned: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if cleaned.len() == 8 {
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(&cleaned, "%Y%m%d") {
            return Some(parsed.format("%Y-%m-%d").to_string());
        }
    }
    for separator in ['/', '-', '.'] {
        let parts: Vec<&str> = trimmed.split(separator).collect();
        if parts.len() == 3 {
            if let (Ok(day), Ok(month), Ok(year)) = (
                parts[0].parse::<u32>(),
                parts[1].parse::<u32>(),
                parts[2].parse::<i32>(),
            ) {
                if let Some(parsed) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
                    return Some(parsed.format("%Y-%m-%d").to_string());
                }
            }
        }
        if parts.len() == 2 {
            if let (Ok(day), Ok(month)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                if let Some(parsed) = chrono::NaiveDate::from_ymd_opt(today.year(), month, day) {
                    return Some(parsed.format("%Y-%m-%d").to_string());
                }
            }
        }
    }
    let weekdays = [
        ("sunday", 0),
        ("sun", 0),
        ("monday", 1),
        ("mon", 1),
        ("tuesday", 2),
        ("tue", 2),
        ("wednesday", 3),
        ("wed", 3),
        ("thursday", 4),
        ("thu", 4),
        ("friday", 5),
        ("fri", 5),
        ("saturday", 6),
        ("sat", 6),
    ];
    for (name, target) in weekdays {
        if trimmed.contains(name) {
use chrono::Datelike;
            let today_weekday = today.weekday().num_days_from_sunday() as i64;
            let mut offset = (target - today_weekday + 7) % 7;
            if offset == 0 || trimmed.contains("next") {
                offset = 7;
            }
            return Some(
                (today + chrono::Duration::days(offset))
                    .format("%Y-%m-%d")
                    .to_string(),
            );
        }
    }
    None
}

fn parse_time_preference(input: &str) -> TimePreference {
    let lower = input.to_lowercase();
    if [
        "first available",
        "earliest",
        "asap",
        "anytime",
        "any time",
        "koi bhi",
        "kabhi bhi",
        "jaldi",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return TimePreference {
            flexible: true,
            ..Default::default()
        };
    }
    if lower.contains("early morning") || lower.contains("subah jaldi") {
        return TimePreference {
            before: Some(10 * 60),
            ..Default::default()
        };
    }
    if lower.contains("morning") || lower.contains("subah") || lower.contains("subha") {
        return TimePreference {
            before: Some(12 * 60),
            ..Default::default()
        };
    }
    if lower.contains("afternoon") || lower.contains("noon") || lower.contains("lunch") {
        return TimePreference {
            after: Some(12 * 60),
            before: Some(16 * 60),
            ..Default::default()
        };
    }
    if lower.contains("evening") || lower.contains("shaam") {
        return TimePreference {
            after: Some(16 * 60),
            ..Default::default()
        };
    }
    if lower.contains("night") || lower.contains("raat") {
        return TimePreference {
            after: Some(18 * 60),
            ..Default::default()
        };
    }
    for word in lower.split_whitespace() {
        if let Some(time) = parse_clock_word(word, &lower) {
            let minutes = time_to_minutes(&time).unwrap_or(0);
            if lower.contains("after") || lower.contains("from") || lower.contains("post") {
                return TimePreference {
                    after: Some(minutes),
                    ..Default::default()
                };
            }
            if lower.contains("before")
                || lower.contains("till")
                || lower.contains("until")
                || lower.contains("by")
            {
                return TimePreference {
                    before: Some(minutes),
                    ..Default::default()
                };
            }
            return TimePreference {
                time: Some(time),
                ..Default::default()
            };
        }
    }
    TimePreference::default()
}

fn parse_clock_word(word: &str, full: &str) -> Option<String> {
    let cleaned = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':');
    let meridiem = if cleaned.ends_with("am") {
        Some("am")
    } else if cleaned.ends_with("pm") {
        Some("pm")
    } else {
        None
    };
    let stem = cleaned.trim_end_matches("am").trim_end_matches("pm");
    let (hour, minute) = if let Some((hour, minute)) = stem.split_once(':') {
        (hour.parse::<i64>().ok()?, minute.parse::<i64>().ok()?)
    } else {
        (stem.parse::<i64>().ok()?, 0)
    };
    let mut hour = hour;
    if meridiem == Some("pm") && hour < 12 {
        hour += 12;
    } else if meridiem == Some("am") && hour == 12 {
        hour = 0;
    } else if meridiem.is_none()
        && full.contains("baje")
        && (full.contains("raat") || full.contains("shaam"))
        && hour < 12
    {
        hour += 12;
    }
    if (0..24).contains(&hour) && (0..60).contains(&minute) {
        Some(format!("{:02}:{:02}", hour, minute))
    } else {
        None
    }
}

fn time_to_minutes(value: &str) -> Option<i64> {
    let (hour, minute) = value.split_once(':')?;
    Some(hour.parse::<i64>().ok()? * 60 + minute.parse::<i64>().ok()?)
}

fn time_preference_active(preference: &TimePreference) -> bool {
    preference.flexible
        || preference.time.is_some()
        || preference.after.is_some()
        || preference.before.is_some()
}

fn slot_minutes(value: &serde_json::Value) -> Option<i64> {
    value
        .get("startAt")
        .and_then(|item| item.as_str())
        .and_then(|start| time_to_minutes(&format_time(start)))
}

fn filter_slots_by_preference(
    slots: Vec<serde_json::Value>,
    preference: &TimePreference,
) -> Vec<serde_json::Value> {
    if preference.flexible
        || (preference.time.is_none() && preference.after.is_none() && preference.before.is_none())
    {
        return slots;
    }
    if let Some(target) = preference.time.as_deref().and_then(time_to_minutes) {
        let mut best_delta = 46;
        let mut best = Vec::new();
        for slot in slots {
            if let Some(minutes) = slot_minutes(&slot) {
                let delta = (minutes - target).abs();
                if delta < best_delta {
                    best_delta = delta;
                    best = vec![slot];
                } else if delta == best_delta {
                    best.push(slot);
                }
            }
        }
        return if best_delta <= 45 { best } else { vec![] };
    }
    slots
        .into_iter()
        .filter(|slot| {
            slot_minutes(slot).is_some_and(|minutes| {
                preference.after.is_none_or(|after| minutes >= after)
                    && preference.before.is_none_or(|before| minutes <= before)
            })
        })
        .collect()
}

fn format_time(rfc3339: &str) -> String {
    let ist = chrono::FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("valid offset");
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map(|value| value.with_timezone(&ist).format("%H:%M").to_string())
        .unwrap_or_else(|_| rfc3339.to_string())
}

fn error_message(error: &AppError) -> String {
    match error {
        AppError::Validation(message) => message.clone(),
        AppError::NotFound(message) => message.clone(),
        AppError::Conflict(message) => message.clone(),
        AppError::Authorization => "not authorized".to_string(),
        _ => "an unexpected error occurred".to_string(),
    }
}

async fn prompt_services(
    state: &Arc<AppState>,
    salon_id: &str,
    wa_phone: &str,
    branch_id: &str,
) -> Result<(), AppError> {
    let services = state
        .self_booking
        .services(solastio_application::self_booking::BranchQuery {
            salon_id: salon_id.to_string(),
            branch_id: branch_id.to_string(),
        })
        .await
        .unwrap_or_else(|_| solastio_application::self_booking::ServicesResponse {
            services: vec![],
        });
    if services.services.is_empty() {
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            "Sorry, there are no bookable services in that branch right now. Please try another branch or message the salon directly.",
            None,
            serde_json::json!({ "source": "booking_service_empty" }),
        )
        .await;
        return Ok(());
    }
    let list: Vec<String> = services
        .services
        .iter()
        .enumerate()
        .map(|(index, service)| {
            format!(
                "{}. {} (Rs {:.0}, {} min)",
                index + 1,
                service.name,
                service.price_paise as f64 / 100.0,
                service.duration_minutes
            )
        })
        .collect();
    let _ = send_whatsapp_message(
        state,
        salon_id,
        wa_phone,
        "utility",
        &format!(
            "What service would you like?\n{}\nReply a number, or type to search.",
            list.join("\n")
        ),
        None,
        serde_json::json!({ "source": "booking_service" }),
    )
    .await;
    Ok(())
}

async fn prompt_staff(
    state: &Arc<AppState>,
    salon_id: &str,
    wa_phone: &str,
    branch_id: &str,
    service_id: &str,
    service_name: &str,
) -> Result<(), AppError> {
    let staff = state
        .self_booking
        .staff(solastio_application::self_booking::StaffQuery {
            salon_id: salon_id.to_string(),
            branch_id: branch_id.to_string(),
            service_id: Some(service_id.to_string()),
        })
        .await
        .unwrap_or_else(|_| solastio_application::self_booking::StaffResponse { staff: vec![] });
    if staff.staff.is_empty() {
        let _ = state
            .whatsapp
            .upsert_booking_session(
                salon_id,
                wa_phone,
                doc! { "staffId": "", "staffName": "Any", "state": "select_date" },
            )
            .await;
        let _ = send_whatsapp_message(
            state,
            salon_id,
            wa_phone,
            "utility",
            "Great! What date would you like? (e.g. YYYY-MM-DD or tomorrow)",
            None,
            serde_json::json!({ "source": "booking_date", "serviceName": service_name }),
        )
        .await;
        return Ok(());
    }
    let list: Vec<String> = staff
        .staff
        .iter()
        .enumerate()
        .map(|(index, member)| format!("{}. {}", index + 1, member.name))
        .collect();
    let _ = send_whatsapp_message(
        state,
        salon_id,
        wa_phone,
        "utility",
        &format!("Which {} specialist would you prefer?\n{}\nReply a number, or 0 for the first available.", service_name, list.join("\n")),
        None,
        serde_json::json!({ "source": "booking_staff" }),
    )
    .await;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct WhatsAppConversationsQuery {
    #[serde(default)]
    search: String,
    #[serde(default = "default_whatsapp_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

#[derive(Debug, Deserialize)]
struct WhatsAppMessagesQuery {
    #[serde(default = "default_whatsapp_messages_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_whatsapp_limit() -> i64 {
    40
}

fn default_whatsapp_messages_limit() -> i64 {
    60
}

async fn whatsapp_conversations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<WhatsAppConversationsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if !has_permission(&context.permissions, "read:appointments") {
        return Err(AppError::Authorization);
    }
    let limit = query.limit.clamp(1, 100) as usize;
    let offset = query.offset.max(0) as usize;
    let customers = state
        .whatsapp
        .conversation_customers(&context.salon_id, &query.search, 300)
        .await?;
    let mut customer_map: std::collections::HashMap<String, Document> = customers
        .iter()
        .filter_map(|doc| {
            doc.get_str("normalizedPhone")
                .ok()
                .map(|phone| (phone.to_string(), doc.clone()))
        })
        .collect();
    let mut phone_set: std::collections::BTreeSet<String> = customer_map.keys().cloned().collect();
    let inbound = state
        .whatsapp
        .conversation_inbounds_by_phones(
            &context.salon_id,
            &customer_map.keys().cloned().collect::<Vec<_>>(),
            500,
        )
        .await?;
    let outbound = state
        .whatsapp
        .conversation_outbounds_by_phones(
            &context.salon_id,
            &customer_map.keys().cloned().collect::<Vec<_>>(),
            500,
        )
        .await?;
    for row in &inbound {
        if let Ok(phone) = row.get_str("waPhone") {
            phone_set.insert(phone.to_string());
        }
    }
    for row in &outbound {
        if let Ok(phone) = row.get_str("toPhone") {
            phone_set.insert(phone.to_string());
        }
    }
    let missing: Vec<String> = phone_set
        .iter()
        .filter(|phone| !customer_map.contains_key(*phone))
        .cloned()
        .collect();
    for phone in &missing {
        let extra = state
            .whatsapp
            .customer_by_normalized_phone(&context.salon_id, phone, 1)
            .await?;
        for doc in extra {
            if let Ok(normalized) = doc.get_str("normalizedPhone") {
                customer_map.entry(normalized.to_string()).or_insert(doc);
            }
        }
    }
    let mut counts: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();
    let mut last = std::collections::HashMap::<String, serde_json::Value>::new();
    for row in &inbound {
        let phone = row.get_str("waPhone").unwrap_or_default().to_string();
        if phone.is_empty() {
            continue;
        }
        counts.entry(phone.clone()).or_insert((0, 0)).0 += 1;
        let at_millis = doc_datetime(row, &["receivedAt", "timestamp", "createdAt"])
            .map(|value| value.timestamp_millis())
            .unwrap_or(0);
        let entry = last
            .entry(phone)
            .or_insert_with(|| serde_json::json!({ "at": 0 }));
        if at_millis > entry.get("at").and_then(|v| v.as_i64()).unwrap_or(0) {
            *entry = serde_json::json!({
                "at": at_millis,
                "direction": "inbound",
                "body": row.get_str("text").unwrap_or_default(),
                "status": "received",
                "appointmentId": row.get("appointmentId").cloned().and_then(bson_to_json)
            });
        }
    }
    for row in &outbound {
        let phone = row.get_str("toPhone").unwrap_or_default().to_string();
        if phone.is_empty() {
            continue;
        }
        counts.entry(phone.clone()).or_insert((0, 0)).1 += 1;
        let at_millis = doc_datetime(row, &["createdAt", "lastAttemptAt"])
            .map(|value| value.timestamp_millis())
            .unwrap_or(0);
        let entry = last
            .entry(phone)
            .or_insert_with(|| serde_json::json!({ "at": 0 }));
        if at_millis > entry.get("at").and_then(|v| v.as_i64()).unwrap_or(0) {
            *entry = serde_json::json!({
                "at": at_millis,
                "direction": "outbound",
                "body": row.get_str("body").unwrap_or_default(),
                "status": row.get_str("status").unwrap_or_default(),
                "appointmentId": row.get("appointmentId").cloned().and_then(bson_to_json)
            });
        }
    }
    let mut all: Vec<serde_json::Value> = Vec::new();
    for phone in phone_set {
        let customer = customer_map.get(&phone);
        let (inbound_count, outbound_count) = counts.get(&phone).copied().unwrap_or((0, 0));
        let last_at = last
            .get(&phone)
            .and_then(|value| value.get("at"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let last_direction = last
            .get(&phone)
            .and_then(|value| value.get("direction"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let last_body = last
            .get(&phone)
            .and_then(|value| value.get("body"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let last_status = last
            .get(&phone)
            .and_then(|value| value.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let appointment_id = last
            .get(&phone)
            .and_then(|value| value.get("appointmentId"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        all.push(serde_json::json!({
            "phone": phone,
            "customerId": customer.and_then(|doc| doc.get_object_id("_id").ok()).map(|id| id.to_hex()).unwrap_or_default(),
            "customerName": customer.and_then(|doc| doc.get_str("name").ok()).unwrap_or(&phone),
            "branchId": customer.and_then(|doc| doc.get_str("branchId").ok()).unwrap_or_default(),
            "interactionStatus": customer.and_then(|doc| doc.get_str("interactionStatus").ok()).unwrap_or("active"),
            "marketingOptOut": customer.and_then(|doc| doc.get_bool("marketingOptOut").ok()).unwrap_or(false),
            "lastMessageAt": iso_from_millis(last_at),
            "lastDirection": last_direction,
            "lastBody": last_body,
            "lastStatus": last_status,
            "inboundCount": inbound_count,
            "outboundCount": outbound_count,
            "appointmentId": appointment_id,
        }));
    }
    all.sort_by(|a, b| {
        let a_at = a
            .get("lastMessageAt")
            .and_then(|v| v.as_str())
            .and_then(iso_millis)
            .unwrap_or(0);
        let b_at = b
            .get("lastMessageAt")
            .and_then(|v| v.as_str())
            .and_then(iso_millis)
            .unwrap_or(0);
        b_at.cmp(&a_at)
    });
    let total = all.len();
    let items = all.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
    let last_page = total == 0 || offset + limit >= total;
    Ok(ok(serde_json::json!({
        "items": items,
        "page": { "total": total, "limit": limit, "offset": offset, "hasNext": !last_page }
    })))
}

async fn whatsapp_conversation_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(phone_path): Path<String>,
    Query(query): Query<WhatsAppMessagesQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if !has_permission(&context.permissions, "read:appointments") {
        return Err(AppError::Authorization);
    }
    let phone = normalize_phone(&phone_path);
    if phone.len() < 4 || phone.len() > 40 {
        return Err(AppError::Validation("Invalid phone number.".to_string()));
    }
    let limit = query.limit.clamp(1, 100) as usize;
    let offset = query.offset.max(0) as usize;
    let customer = state
        .whatsapp
        .customer_by_normalized_phone(&context.salon_id, &phone, 1)
        .await?
        .into_iter()
        .next();
    let customer = customer.as_ref();
    let inbound = state
        .whatsapp
        .conversation_inbounds_by_phone(&context.salon_id, &phone, 400)
        .await?;
    let outbound = state
        .whatsapp
        .conversation_outbounds_by_phone(&context.salon_id, &phone, 400)
        .await?;
    let mut timeline: Vec<serde_json::Value> = Vec::new();
    for row in &inbound {
        let at = doc_datetime(row, &["receivedAt", "timestamp", "createdAt"])
            .unwrap_or_else(DateTime::now);
        timeline.push(serde_json::json!({
            "id": row.get_object_id("_id").map(|id| id.to_hex()).unwrap_or_default(),
            "direction": "inbound",
            "body": row.get_str("text").unwrap_or_default(),
            "status": "received",
            "type": "message",
            "appointmentId": row.get("appointmentId").cloned().and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
            "providerMessageId": row.get_str("messageId").unwrap_or_default(),
            "at": iso_datetime_bson(&at),
        }));
    }
    for row in &outbound {
        let at = doc_datetime(row, &["createdAt", "lastAttemptAt"]).unwrap_or_else(DateTime::now);
        timeline.push(serde_json::json!({
            "id": row.get_object_id("_id").map(|id| id.to_hex()).unwrap_or_default(),
            "direction": "outbound",
            "body": row.get_str("body").unwrap_or_default(),
            "status": row.get_str("status").unwrap_or_default(),
            "type": row.get_str("type").unwrap_or("message"),
            "appointmentId": row.get("appointmentId").cloned().and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
            "providerMessageId": row.get_str("providerMessageId").unwrap_or_default(),
            "at": iso_datetime_bson(&at),
            "deliveredAt": row.get("deliveredAt").cloned().and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
            "readAt": row.get("readAt").cloned().and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
            "error": row.get("error").cloned().and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
        }));
    }
    timeline.sort_by(|a, b| {
        let a_at = a
            .get("at")
            .and_then(|v| v.as_str())
            .and_then(iso_millis)
            .unwrap_or(0);
        let b_at = b
            .get("at")
            .and_then(|v| v.as_str())
            .and_then(iso_millis)
            .unwrap_or(0);
        b_at.cmp(&a_at)
    });
    let total = timeline.len();
    let items = timeline
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let last_page = total == 0 || offset + limit >= total;
    let customer_json = serde_json::json!({
        "id": customer.and_then(|doc| doc.get_object_id("_id").ok()).map(|id| id.to_hex()).unwrap_or_default(),
        "name": customer.and_then(|doc| doc.get_str("name").ok()).unwrap_or(&phone),
        "phone": phone,
        "branchId": customer.and_then(|doc| doc.get_str("branchId").ok()).unwrap_or_default(),
        "interactionStatus": customer.and_then(|doc| doc.get_str("interactionStatus").ok()).unwrap_or("active"),
        "marketingOptOut": customer.and_then(|doc| doc.get_bool("marketingOptOut").ok()).unwrap_or(false),
        "lastBookedAt": customer.and_then(|doc| doc.get("lastBookedAt").cloned()).and_then(bson_to_json).unwrap_or(serde_json::Value::Null),
    });
    Ok(ok(serde_json::json!({
        "customer": customer_json,
        "items": items,
        "page": { "total": total, "limit": limit, "offset": offset, "hasNext": !last_page }
    })))
}

fn doc_datetime(row: &Document, keys: &[&str]) -> Option<DateTime> {
    for key in keys {
        if let Some(value) = row
            .get(key)
            .cloned()
            .and_then(|bson| bson.as_datetime().cloned())
        {
            return Some(value);
        }
    }
    None
}

fn iso_datetime_bson(value: &DateTime) -> serde_json::Value {
    serde_json::json!(value.to_owned().try_to_rfc3339_string().unwrap_or_default())
}

fn iso_from_millis(millis: i64) -> serde_json::Value {
    if millis <= 0 {
        return serde_json::Value::Null;
    }
    serde_json::json!(DateTime::from_millis(millis)
        .try_to_rfc3339_string()
        .unwrap_or_default())
}

fn iso_millis(value: &str) -> Option<i64> {
    mongodb::bson::DateTime::parse_rfc3339_str(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn bson_to_json(bson: mongodb::bson::Bson) -> Option<serde_json::Value> {
    mongodb::bson::from_bson(bson).ok()
}

#[derive(Debug, Deserialize)]
struct ShopifyLoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct ShopifyRefreshRequest {
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShopifyRowsRequest {
    rows: Vec<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct ShopifyOptOutRequest {
    phone: String,
}

#[derive(Debug, Deserialize)]
struct ShopifyCampaignWrite {
    name: String,
    #[serde(rename = "audienceId")]
    audience_id: String,
    #[serde(rename = "templateName")]
    template_name: String,
    #[serde(default = "default_language")]
    language: String,
    #[serde(rename = "scheduledAt")]
    scheduled_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShopifyAudienceWrite {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    conditions: serde_json::Map<String, serde_json::Value>,
    #[serde(default = "default_audience_source")]
    source: String,
}

#[derive(Debug, Deserialize)]
struct ShopifyInstallUrlRequest {
    shop: String,
}

#[derive(Debug, Deserialize)]
struct ShopifyConnectRequest {
    shop: String,
    code: String,
}

#[derive(Debug, Deserialize)]
struct ShopifyCallbackQuery {
    shop: String,
    code: String,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShopifyFlowWrite {
    name: String,
    #[serde(default)]
    description: String,
    trigger: String,
    #[serde(default = "default_flow_status")]
    status: String,
    #[serde(default)]
    nodes: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShopifyFlowPatch {
    name: Option<String>,
    description: Option<String>,
    trigger: Option<String>,
    status: Option<String>,
    nodes: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShopifyFlowNodeWrite {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    label: String,
    #[serde(default)]
    config: serde_json::Map<String, serde_json::Value>,
    next: Option<String>,
    yes: Option<String>,
    no: Option<String>,
}

#[derive(Debug, Serialize)]
struct ShopifyClaims {
    sub: String,
    sid: String,
    #[serde(rename = "shopDomain")]
    shop_domain: String,
    role: String,
    iss: String,
    exp: usize,
}

#[derive(Debug, Deserialize)]
struct ShopifyTokenClaims {
    sub: String,
    #[serde(rename = "shopDomain")]
    shop_domain: String,
    role: String,
    iss: String,
    exp: usize,
}

struct ShopifyContext {
    shop_domain: String,
}

#[derive(Debug, Serialize)]
struct ShopifyWebhookRegistration {
    registered: Vec<String>,
    existing: Vec<String>,
    failed: Vec<String>,
}

async fn shopify_login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ShopifyLoginRequest>,
) -> Result<axum::response::Response, AppError> {
    if request.email.trim().is_empty() || request.password.is_empty() {
        return Err(AppError::Authentication);
    }
    let login = request.email.trim().to_ascii_lowercase();
    let user = state
        .shopify_users
        .find_by_login(&login)
        .await?
        .ok_or(AppError::Authentication)?;
    if user.status != "active" {
        return Err(AppError::Authorization);
    }
    if !bcrypt::verify(request.password, &user.password_hash).map_err(|_| AppError::Internal)? {
        return Err(AppError::Authentication);
    }
    issue_shopify_session(&state, user).await
}

async fn shopify_refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyRefreshRequest>,
) -> Result<axum::response::Response, AppError> {
    let refresh_token = request
        .refresh_token
        .or_else(|| cookie_value(&headers, "shopifyRefresh"))
        .ok_or(AppError::Authentication)?;
    let token_hash = hash_token(&refresh_token);
    let user = state
        .shopify_users
        .find_by_refresh_hash(&token_hash)
        .await?
        .ok_or(AppError::Authentication)?;
    let record = user
        .refresh_tokens
        .iter()
        .find(|item| item.token_hash == token_hash)
        .ok_or(AppError::Authentication)?;
    if record.revoked_at.is_some() || DateTime::now() > record.expires_at || user.status != "active"
    {
        return Err(AppError::Authentication);
    }
    let replacement_hash = hash_token(&generate_refresh_token());
    state
        .shopify_users
        .revoke_refresh_token(&token_hash, Some(&replacement_hash))
        .await?;
    issue_shopify_session(&state, user).await
}

async fn shopify_logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyRefreshRequest>,
) -> Result<axum::response::Response, AppError> {
    if let Some(refresh_token) = request
        .refresh_token
        .or_else(|| cookie_value(&headers, "shopifyRefresh"))
    {
        state
            .shopify_users
            .revoke_refresh_token(&hash_token(&refresh_token), None)
            .await?;
    }
    let mut response = ok(serde_json::json!({ "loggedOut": true }));
    response.headers_mut().append(
        SET_COOKIE,
        "shopifyRefresh=; Path=/api/v1/shopify-api/auth; Max-Age=0; HttpOnly"
            .parse()
            .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

async fn shopify_admin_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(shopify_overview(&state, &context.shop_domain).await?))
}

async fn shopify_client_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "client")?;
    Ok(ok(shopify_overview(&state, &context.shop_domain).await?))
}

async fn shopify_admin_flows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("flows", &context.shop_domain, 500)
            .await?,
    )))
}

async fn shopify_admin_seed_flows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let mut items = Vec::new();
    for flow in ready_made_flows() {
        items.push(
            state
                .shopify_users
                .create_flow(flow_document(&context.shop_domain, "", flow)?)
                .await?,
        );
    }
    Ok(ok(documents_json(items)))
}

async fn shopify_admin_create_flow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyFlowWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    validate_flow_status(&request.status)?;
    let flow = state
        .shopify_users
        .create_flow(flow_document(&context.shop_domain, "", request)?)
        .await?;
    Ok(ok(document_json(flow)))
}

async fn shopify_admin_update_flow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ShopifyFlowPatch>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let flow_id = parse_object_id(&id)?;
    let mut update = doc! { "updatedAt": DateTime::now() };
    if let Some(name) = request.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Flow name is required.".to_string()));
        }
        update.insert("name", name);
    }
    if let Some(description) = request.description {
        update.insert("description", description);
    }
    if let Some(trigger) = request.trigger {
        if trigger.trim().is_empty() {
            return Err(AppError::Validation(
                "Flow trigger is required.".to_string(),
            ));
        }
        update.insert("trigger", trigger);
    }
    if let Some(status) = request.status {
        validate_flow_status(&status)?;
        update.insert("status", status);
    }
    if let Some(nodes) = request.nodes {
        update.insert(
            "nodes",
            mongodb::bson::to_bson(&nodes)
                .map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?,
        );
    }
    let flow = state
        .shopify_users
        .update_flow(&context.shop_domain, flow_id, update)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(flow)))
}

async fn shopify_admin_add_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ShopifyFlowNodeWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    validate_flow_node(&request)?;
    let flow_id = parse_object_id(&id)?;
    let flow = state
        .shopify_users
        .flow_by_id(&context.shop_domain, flow_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    let mut nodes = flow_nodes(&flow)?;
    if nodes
        .iter()
        .any(|node| node.get("id").and_then(|id| id.as_str()) == Some(&request.id))
    {
        return Err(AppError::Conflict("Flow node already exists.".to_string()));
    }
    nodes.push(serde_json::to_value(request).map_err(|_| AppError::Internal)?);
    let updated = state
        .shopify_users
        .update_flow(
            &context.shop_domain,
            flow_id,
            doc! {
                "nodes": mongodb::bson::to_bson(&nodes).map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?,
                "updatedAt": DateTime::now(),
            },
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn shopify_admin_update_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((flow_id, node_id)): Path<(String, String)>,
    Json(request): Json<serde_json::Map<String, serde_json::Value>>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let flow_id = parse_object_id(&flow_id)?;
    let flow = state
        .shopify_users
        .flow_by_id(&context.shop_domain, flow_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    let mut nodes = flow_nodes(&flow)?;
    let mut found = false;
    for node in &mut nodes {
        if node.get("id").and_then(|id| id.as_str()) == Some(&node_id) {
            let obj = node
                .as_object_mut()
                .ok_or_else(|| AppError::Validation("Invalid flow node.".to_string()))?;
            for (key, value) in &request {
                if key != "id" {
                    obj.insert(key.clone(), value.clone());
                }
            }
            found = true;
        }
    }
    if !found {
        return Err(AppError::NotFound("Flow node not found.".to_string()));
    }
    let updated = state
        .shopify_users
        .update_flow(
            &context.shop_domain,
            flow_id,
            doc! {
                "nodes": mongodb::bson::to_bson(&nodes).map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?,
                "updatedAt": DateTime::now(),
            },
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn shopify_admin_delete_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((flow_id, node_id)): Path<(String, String)>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let updated = state
        .shopify_users
        .delete_flow_node(&context.shop_domain, parse_object_id(&flow_id)?, &node_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn shopify_client_flows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "client")?;
    let flows = state
        .shopify_users
        .documents("flows", &context.shop_domain, 500)
        .await?;
    Ok(ok(serde_json::Value::Array(
        flows.into_iter().map(client_flow_json).collect(),
    )))
}

async fn shopify_admin_templates(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("templates", &context.shop_domain, 500)
            .await?,
    )))
}

async fn shopify_admin_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("logs", &context.shop_domain, 100)
            .await?,
    )))
}

async fn shopify_admin_customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("customers", &context.shop_domain, 200)
            .await?,
    )))
}

async fn shopify_admin_import_customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyRowsRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let mut imported = 0;
    for row in request.rows {
        let phone = string_field(&row, &["Phone", "phone"]);
        let normalized_phone = normalize_phone(&phone);
        if normalized_phone.is_empty() {
            continue;
        }
        state
            .shopify_users
            .upsert_customer(
                &context.shop_domain,
                &normalized_phone,
                doc! {
                    "salonId": &context.shop_domain,
                    "name": string_field(&row, &["Name", "name"]),
                    "phone": phone,
                    "normalizedPhone": &normalized_phone,
                    "email": string_field(&row, &["Email", "email"]),
                    "orderCount": number_field(&row, &["OrderCount", "orderCount"]),
                    "totalSpend": number_field(&row, &["TotalSpend", "totalSpend"]),
                    "tags": tags_field(&row),
                    "marketingConsent": bool_field(&row, &["MarketingConsent", "marketingConsent"]),
                    "source": "import",
                    "updatedAt": DateTime::now(),
                },
            )
            .await?;
        imported += 1;
    }
    Ok(ok(serde_json::json!({ "imported": imported })))
}

async fn shopify_admin_customer_opt_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyOptOutRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let normalized_phone = normalize_phone(&request.phone);
    if normalized_phone.is_empty() {
        return Err(AppError::Validation("Phone is required.".to_string()));
    }
    state
        .shopify_users
        .mark_customer_opt_out(&context.shop_domain, &normalized_phone)
        .await?;
    Ok(ok(
        serde_json::json!({ "phone": normalized_phone, "marketingOptOut": true }),
    ))
}

async fn shopify_admin_campaigns(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("campaigns", &context.shop_domain, 500)
            .await?,
    )))
}

async fn shopify_admin_audiences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("audiences", &context.shop_domain, 500)
            .await?,
    )))
}

async fn shopify_admin_create_audience(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyAudienceWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    if request.name.trim().is_empty() {
        return Err(AppError::Validation(
            "Audience name is required.".to_string(),
        ));
    }
    if !matches!(request.source.as_str(), "shopify" | "import" | "manual") {
        return Err(AppError::Validation("Invalid audience source.".to_string()));
    }
    let audience = state
        .shopify_users
        .create_audience(doc! {
            "salonId": &context.shop_domain,
            "name": request.name,
            "description": request.description,
            "conditions": mongodb::bson::to_bson(&request.conditions).map_err(|_| AppError::Validation("Invalid audience conditions.".to_string()))?,
            "source": request.source,
            "createdBy": "",
            "createdAt": DateTime::now(),
            "updatedAt": DateTime::now(),
        })
        .await?;
    Ok(ok(document_json(audience)))
}

async fn shopify_admin_campaign_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let total = state
        .shopify_users
        .count_customers(&context.shop_domain, doc! {})
        .await?;
    let eligible = state
        .shopify_users
        .count_customers(
            &context.shop_domain,
            doc! { "marketingConsent": true, "marketingOptOut": false },
        )
        .await?;
    Ok(ok(serde_json::json!({
        "audienceSize": total,
        "eligibleContacts": eligible,
        "excludedContacts": total.saturating_sub(eligible),
        "estimatedMessages": eligible,
    })))
}

async fn shopify_admin_create_campaign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyCampaignWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    if request.name.trim().is_empty()
        || request.audience_id.trim().is_empty()
        || request.template_name.trim().is_empty()
    {
        return Err(AppError::Validation(
            "Campaign fields are required.".to_string(),
        ));
    }
    let scheduled_at = request
        .scheduled_at
        .as_deref()
        .and_then(parse_bson_datetime);
    let campaign = state
        .shopify_users
        .create_campaign(doc! {
            "salonId": &context.shop_domain,
            "name": request.name,
            "audienceId": request.audience_id,
            "templateName": request.template_name,
            "language": request.language,
            "status": if scheduled_at.is_some() { "scheduled" } else { "draft" },
            "scheduledAt": scheduled_at,
            "createdAt": DateTime::now(),
            "updatedAt": DateTime::now(),
        })
        .await?;
    Ok(ok(document_json(campaign)))
}

async fn shopify_admin_send_campaign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    send_shopify_campaign_for_salon(&state, &context.shop_domain, &id).await
}

async fn shopify_admin_install_url(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyInstallUrlRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let shop = normalize_shop(&request.shop)?;
    let api_key = state
        .config
        .shopify_api_key
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let app_url = state.config.shopify_app_url.clone().unwrap_or_default();
    let redirect_uri = format!(
        "{}/api/v1/shopify-automation/shopify/callback",
        app_url.trim_end_matches('/')
    );
    let state_param = base64_url_encode(
        format!(
            "{{\"salonId\":\"{}\",\"userId\":\"{}\",\"ts\":{}}}",
            context.shop_domain,
            "",
            now_millis()
        )
        .as_bytes(),
    );
    let install_url = format!(
        "https://{}/admin/oauth/authorize?client_id={}&scope={}&redirect_uri={}&state={}",
        shop,
        url_component(api_key),
        url_component(&state.config.shopify_scopes),
        url_component(&redirect_uri),
        url_component(&state_param)
    );
    Ok(ok(
        serde_json::json!({ "shop": shop, "installUrl": install_url }),
    ))
}

async fn shopify_admin_disconnect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "admin")?;
    let modified = state
        .shopify_users
        .disconnect_stores(&context.shop_domain)
        .await?;
    Ok(ok(serde_json::json!({ "modifiedCount": modified })))
}

async fn shopify_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<axum::response::Response, AppError> {
    if !verify_shopify_webhook(&state.config, &headers, &body)? {
        return Err(AppError::Authorization);
    }
    let shop = headers
        .get("x-shopify-shop-domain")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let topic = headers
        .get("x-shopify-topic")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let webhook_id = headers
        .get("x-shopify-webhook-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !shopify_topic_allowed(&topic) {
        return Ok(ok(serde_json::json!({ "ignored": true })));
    }
    let Some(store) = state.shopify_users.connected_store_by_shop(&shop).await? else {
        return Ok(ok(serde_json::json!({ "ignored": true })));
    };
    let salon_id = store.get_str("salonId").unwrap_or_default().to_string();
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::Validation("Invalid Shopify webhook payload.".to_string()))?;
    let event = state
        .shopify_users
        .insert_event_once(doc! {
            "salonId": &salon_id,
            "shop": &shop,
            "topic": &topic,
            "externalEventId": &webhook_id,
            "payload": mongodb::bson::to_bson(&payload).map_err(|_| AppError::Validation("Invalid Shopify webhook payload.".to_string()))?,
            "processedAt": mongodb::bson::Bson::Null,
            "createdAt": DateTime::now(),
            "updatedAt": DateTime::now(),
        })
        .await?;
    let Some(event) = event else {
        return Ok(ok(
            serde_json::json!({ "accepted": true, "duplicate": true, "flows": 0 }),
        ));
    };
    let flows = state
        .shopify_users
        .active_flows_for_trigger(&salon_id, &topic)
        .await?;
    let event_id = event
        .get_object_id("_id")
        .map(|id| id.to_hex())
        .unwrap_or_default();
    let context = normalize_shopify_context(
        &payload,
        store
            .get_str("storeName")
            .ok()
            .filter(|name| !name.is_empty())
            .unwrap_or(&shop),
    );
    let context_bson = mongodb::bson::to_bson(&context)
        .map_err(|_| AppError::Validation("Invalid Shopify context.".to_string()))?;
    let now = DateTime::now();
    let mut queued = 0;
    for flow in &flows {
        let Some(flow_id) = flow.get_object_id("_id").ok() else {
            continue;
        };
        let current_node_id = flow
            .get_array("nodes")
            .ok()
            .and_then(|nodes| nodes.first())
            .and_then(|node| node.as_document())
            .and_then(|node| node.get_str("id").ok())
            .unwrap_or_default()
            .to_string();
        state
            .shopify_users
            .queue_flow_execution_once(doc! {
                "salonId": &salon_id,
                "flowId": flow_id.to_hex(),
                "eventId": &event_id,
                "externalEventId": &webhook_id,
                "status": "queued",
                "currentNodeId": current_node_id,
                "context": context_bson.clone(),
                "scheduledAt": now,
                "nextRunAt": now,
                "retryCount": 0,
                "isTest": false,
                "error": "",
                "createdAt": now,
                "updatedAt": now,
            })
            .await?;
        state
            .shopify_users
            .increment_flow_triggered(flow_id)
            .await?;
        queued += 1;
    }
    if queued > 0 {
        tokio::spawn({
            let state = state.clone();
            let salon_id = salon_id.clone();
            async move {
                let _ = run_due_shopify_executions(&state, Some(&salon_id)).await;
            }
        });
    }
    Ok(ok(serde_json::json!({ "accepted": true, "flows": queued })))
}

async fn shopify_automation_context(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<solastio_application::auth::RequestContext, AppError> {
    let context = context_from_headers(state, headers).await?;
    if !has_permission(&context.permissions, "read:appointments") {
        return Err(AppError::Authorization);
    }
    Ok(context)
}

async fn shopify_automation_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(shopify_overview(&state, &context.salon_id).await?))
}

async fn shopify_automation_flows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("flows", &context.salon_id, 500)
            .await?,
    )))
}

async fn shopify_automation_seed_flows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    let mut items = Vec::new();
    for flow in ready_made_flows() {
        items.push(
            state
                .shopify_users
                .create_flow(flow_document(&context.salon_id, &context.user_id, flow)?)
                .await?,
        );
    }
    Ok(ok(documents_json(items)))
}

async fn shopify_automation_create_flow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyFlowWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    let flow = state
        .shopify_users
        .create_flow(flow_document(&context.salon_id, &context.user_id, request)?)
        .await?;
    Ok(ok(document_json(flow)))
}

async fn shopify_automation_update_flow(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ShopifyFlowPatch>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    update_shopify_flow_for_salon(&state, &context.salon_id, &context.user_id, &id, request).await
}

async fn shopify_automation_add_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ShopifyFlowNodeWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    add_shopify_node_for_salon(&state, &context.salon_id, &id, request).await
}

async fn shopify_automation_update_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((flow_id, node_id)): Path<(String, String)>,
    Json(request): Json<serde_json::Map<String, serde_json::Value>>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    update_shopify_node_for_salon(&state, &context.salon_id, &flow_id, &node_id, request).await
}

async fn shopify_automation_delete_flow_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((flow_id, node_id)): Path<(String, String)>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    let updated = state
        .shopify_users
        .delete_flow_node(&context.salon_id, parse_object_id(&flow_id)?, &node_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn shopify_automation_templates(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("templates", &context.salon_id, 500)
            .await?,
    )))
}

async fn shopify_automation_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("logs", &context.salon_id, 100)
            .await?,
    )))
}

async fn shopify_automation_customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("customers", &context.salon_id, 200)
            .await?,
    )))
}

async fn shopify_automation_import_customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyRowsRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    import_shopify_customers_for_salon(&state, &context.salon_id, request).await
}

async fn shopify_automation_customer_opt_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyOptOutRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    opt_out_shopify_customer_for_salon(&state, &context.salon_id, request).await
}

async fn shopify_automation_audiences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("audiences", &context.salon_id, 500)
            .await?,
    )))
}

async fn shopify_automation_create_audience(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyAudienceWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    create_shopify_audience_for_salon(&state, &context.salon_id, &context.user_id, request).await
}

async fn shopify_automation_campaign_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    shopify_campaign_preview_for_salon(&state, &context.salon_id).await
}

async fn shopify_automation_campaigns(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    Ok(ok(documents_json(
        state
            .shopify_users
            .documents("campaigns", &context.salon_id, 500)
            .await?,
    )))
}

async fn shopify_automation_create_campaign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyCampaignWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    create_shopify_campaign_for_salon(&state, &context.salon_id, &context.user_id, request).await
}

async fn shopify_automation_send_campaign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    send_shopify_campaign_for_salon(&state, &context.salon_id, &id).await
}

async fn shopify_automation_install_url(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyInstallUrlRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    shopify_install_url_for_salon(&state, &context.salon_id, &context.user_id, request).await
}

async fn shopify_automation_connect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ShopifyConnectRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    connect_shopify_for_salon(
        &state,
        &context.salon_id,
        &context.user_id,
        &request.shop,
        &request.code,
    )
    .await
}

async fn shopify_automation_test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    test_shopify_for_salon(&state, &context.salon_id).await
}

async fn shopify_automation_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ShopifyCallbackQuery>,
) -> Result<axum::response::Redirect, AppError> {
    let decoded = base64_url_decode(&query.state)?;
    let value: serde_json::Value =
        serde_json::from_slice(&decoded).map_err(|_| AppError::Authorization)?;
    let salon_id = value
        .get("salonId")
        .and_then(|item| item.as_str())
        .ok_or(AppError::Authorization)?;
    let user_id = value
        .get("userId")
        .and_then(|item| item.as_str())
        .ok_or(AppError::Authorization)?;
    let ts = value
        .get("ts")
        .and_then(|item| item.as_i64())
        .ok_or(AppError::Authorization)?;
    if now_millis().saturating_sub(ts) > 10 * 60_000 {
        return Err(AppError::Authorization);
    }
    connect_shopify_raw(&state, salon_id, user_id, &query.shop, &query.code).await?;
    let frontend = state
        .config
        .cors_origins
        .iter()
        .find(|origin| origin.contains("staff-app-kappa.vercel.app"))
        .cloned()
        .unwrap_or_else(|| "https://staff-app-kappa.vercel.app".to_string());
    Ok(axum::response::Redirect::to(&format!(
        "{}/shopify-admin/dashboard?shopify=connected",
        frontend.trim_end_matches('/')
    )))
}

async fn shopify_automation_disconnect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_automation_context(&state, &headers).await?;
    let modified = state
        .shopify_users
        .disconnect_stores(&context.salon_id)
        .await?;
    Ok(ok(serde_json::json!({ "modifiedCount": modified })))
}

async fn update_shopify_flow_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    id: &str,
    request: ShopifyFlowPatch,
) -> Result<axum::response::Response, AppError> {
    let flow_id = parse_object_id(id)?;
    let mut update = doc! { "updatedAt": DateTime::now(), "updatedBy": user_id };
    if let Some(name) = request.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Flow name is required.".to_string()));
        }
        update.insert("name", name);
    }
    if let Some(description) = request.description {
        update.insert("description", description);
    }
    if let Some(trigger) = request.trigger {
        if trigger.trim().is_empty() {
            return Err(AppError::Validation(
                "Flow trigger is required.".to_string(),
            ));
        }
        update.insert("trigger", trigger);
    }
    if let Some(status) = request.status {
        validate_flow_status(&status)?;
        update.insert("status", status);
    }
    if let Some(nodes) = request.nodes {
        update.insert(
            "nodes",
            mongodb::bson::to_bson(&nodes)
                .map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?,
        );
    }
    let flow = state
        .shopify_users
        .update_flow(salon_id, flow_id, update)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(flow)))
}

async fn add_shopify_node_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    id: &str,
    request: ShopifyFlowNodeWrite,
) -> Result<axum::response::Response, AppError> {
    validate_flow_node(&request)?;
    let flow_id = parse_object_id(id)?;
    let flow = state
        .shopify_users
        .flow_by_id(salon_id, flow_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    let mut nodes = flow_nodes(&flow)?;
    if nodes
        .iter()
        .any(|node| node.get("id").and_then(|id| id.as_str()) == Some(&request.id))
    {
        return Err(AppError::Conflict("Flow node already exists.".to_string()));
    }
    nodes.push(serde_json::to_value(request).map_err(|_| AppError::Internal)?);
    let updated = state
        .shopify_users
        .update_flow(
            salon_id,
            flow_id,
            doc! { "nodes": mongodb::bson::to_bson(&nodes).map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?, "updatedAt": DateTime::now() },
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn update_shopify_node_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    flow_id: &str,
    node_id: &str,
    request: serde_json::Map<String, serde_json::Value>,
) -> Result<axum::response::Response, AppError> {
    let flow_id = parse_object_id(flow_id)?;
    let flow = state
        .shopify_users
        .flow_by_id(salon_id, flow_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    let mut nodes = flow_nodes(&flow)?;
    let mut found = false;
    for node in &mut nodes {
        if node.get("id").and_then(|id| id.as_str()) == Some(node_id) {
            let obj = node
                .as_object_mut()
                .ok_or_else(|| AppError::Validation("Invalid flow node.".to_string()))?;
            for (key, value) in &request {
                if key != "id" {
                    obj.insert(key.clone(), value.clone());
                }
            }
            found = true;
        }
    }
    if !found {
        return Err(AppError::NotFound("Flow node not found.".to_string()));
    }
    let updated = state
        .shopify_users
        .update_flow(
            salon_id,
            flow_id,
            doc! { "nodes": mongodb::bson::to_bson(&nodes).map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?, "updatedAt": DateTime::now() },
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Flow not found.".to_string()))?;
    Ok(ok(document_json(updated)))
}

async fn import_shopify_customers_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    request: ShopifyRowsRequest,
) -> Result<axum::response::Response, AppError> {
    let mut imported = 0;
    let mut invalid = 0;
    for row in request.rows.into_iter().take(2000) {
        let phone = string_field(&row, &["Phone", "phone"]);
        let normalized_phone = normalize_phone(&phone);
        if normalized_phone.len() < 10 {
            invalid += 1;
            continue;
        }
        state
            .shopify_users
            .upsert_customer(
                salon_id,
                &normalized_phone,
                doc! { "salonId": salon_id, "name": string_field(&row, &["Name", "name"]), "phone": phone, "normalizedPhone": &normalized_phone, "email": string_field(&row, &["Email", "email"]), "orderCount": number_field(&row, &["OrderCount", "orderCount"]), "totalSpend": number_field(&row, &["TotalSpend", "totalSpend"]), "tags": tags_field(&row), "marketingConsent": bool_field(&row, &["MarketingConsent", "marketingConsent"]), "source": "import", "updatedAt": DateTime::now() },
            )
            .await?;
        imported += 1;
    }
    Ok(ok(
        serde_json::json!({ "imported": imported, "invalid": invalid }),
    ))
}

async fn opt_out_shopify_customer_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    request: ShopifyOptOutRequest,
) -> Result<axum::response::Response, AppError> {
    let normalized_phone = normalize_phone(&request.phone);
    if normalized_phone.is_empty() {
        return Err(AppError::Validation("Phone is required.".to_string()));
    }
    state
        .shopify_users
        .mark_customer_opt_out(salon_id, &normalized_phone)
        .await?;
    Ok(ok(serde_json::json!({ "marketingOptOut": true })))
}

async fn create_shopify_audience_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    request: ShopifyAudienceWrite,
) -> Result<axum::response::Response, AppError> {
    if request.name.trim().is_empty() {
        return Err(AppError::Validation(
            "Audience name is required.".to_string(),
        ));
    }
    if !matches!(request.source.as_str(), "shopify" | "import" | "manual") {
        return Err(AppError::Validation("Invalid audience source.".to_string()));
    }
    let audience = state
        .shopify_users
        .create_audience(doc! { "salonId": salon_id, "name": request.name, "description": request.description, "conditions": mongodb::bson::to_bson(&request.conditions).map_err(|_| AppError::Validation("Invalid audience conditions.".to_string()))?, "source": request.source, "createdBy": user_id, "createdAt": DateTime::now(), "updatedAt": DateTime::now() })
        .await?;
    Ok(ok(document_json(audience)))
}

async fn shopify_campaign_preview_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
) -> Result<axum::response::Response, AppError> {
    let total = state
        .shopify_users
        .count_customers(salon_id, doc! {})
        .await?;
    let eligible = state
        .shopify_users
        .count_customers(
            salon_id,
            doc! { "marketingConsent": true, "marketingOptOut": false },
        )
        .await?;
    Ok(ok(
        serde_json::json!({ "audienceSize": total, "eligibleContacts": eligible, "excludedContacts": total.saturating_sub(eligible), "estimatedMessages": eligible }),
    ))
}

async fn create_shopify_campaign_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    request: ShopifyCampaignWrite,
) -> Result<axum::response::Response, AppError> {
    if request.name.trim().is_empty()
        || request.audience_id.trim().is_empty()
        || request.template_name.trim().is_empty()
    {
        return Err(AppError::Validation(
            "Campaign fields are required.".to_string(),
        ));
    }
    let scheduled_at = request
        .scheduled_at
        .as_deref()
        .and_then(parse_bson_datetime);
    let campaign = state
        .shopify_users
        .create_campaign(doc! { "salonId": salon_id, "name": request.name, "audienceId": request.audience_id, "templateName": request.template_name, "language": request.language, "status": if scheduled_at.is_some() { "scheduled" } else { "draft" }, "scheduledAt": scheduled_at, "createdBy": user_id, "sentCount": 0, "failedCount": 0, "confirmedAt": mongodb::bson::Bson::Null, "createdAt": DateTime::now(), "updatedAt": DateTime::now() })
        .await?;
    Ok(ok(document_json(campaign)))
}

async fn send_shopify_campaign_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    campaign_id: &str,
) -> Result<axum::response::Response, AppError> {
    let campaign_id = parse_object_id(campaign_id)?;
    let campaign = state
        .shopify_users
        .campaign_by_id(salon_id, campaign_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Campaign not found.".to_string()))?;
    let template_name = campaign
        .get_str("templateName")
        .map_err(|_| AppError::Validation("Campaign template is missing.".to_string()))?;
    let language = campaign.get_str("language").unwrap_or("en");
    let template = state
        .whatsapp
        .template(salon_id, template_name, language)
        .await?
        .filter(|doc| {
            doc.get_str("status")
                .map(|status| status.to_ascii_lowercase().contains("approved"))
                .unwrap_or(false)
        })
        .ok_or(AppError::ExternalService)?;
    state
        .shopify_users
        .update_campaign_fields(
            salon_id,
            campaign_id,
            doc! { "status": "running", "confirmedAt": DateTime::now(), "updatedAt": DateTime::now() },
        )
        .await?;
    let customers = state
        .shopify_users
        .eligible_campaign_customers(salon_id, 500)
        .await?;
    let mut sent = 0;
    let mut failed = 0;
    for customer in &customers {
        let to_phone = customer.get_str("normalizedPhone").unwrap_or_default();
        if to_phone.is_empty() {
            continue;
        }
        let name = customer.get_str("name").unwrap_or("Customer");
        let row = send_whatsapp_template_message(
            state,
            WhatsAppTemplateSend {
                salon_id,
                to_phone,
                template_name,
                language,
                category: template.get_str("category").unwrap_or("MARKETING"),
                body_parameters: vec![if name.is_empty() { "Customer" } else { name }.to_string()],
                metadata: serde_json::json!({
                    "source": "shopify_campaign",
                    "campaignId": campaign_id.to_hex(),
                    "customerId": customer.get_str("shopifyCustomerId").unwrap_or_default(),
                    "isTest": false,
                    "dedupeKey": format!("campaign:{}:{}", campaign_id.to_hex(), to_phone),
                }),
            },
        )
        .await?;
        if row.get_str("status").ok() == Some("failed") {
            failed += 1;
        } else {
            sent += 1;
        }
    }
    let campaign = state
        .shopify_users
        .update_campaign_fields(
            salon_id,
            campaign_id,
            doc! { "status": "completed", "sentCount": sent, "failedCount": failed, "updatedAt": DateTime::now() },
        )
        .await?
        .ok_or_else(|| AppError::NotFound("Campaign not found.".to_string()))?;
    Ok(ok(document_json(campaign)))
}

struct WhatsAppTemplateSend<'a> {
    salon_id: &'a str,
    to_phone: &'a str,
    template_name: &'a str,
    language: &'a str,
    category: &'a str,
    body_parameters: Vec<String>,
    metadata: serde_json::Value,
}

async fn send_whatsapp_template_message(
    state: &Arc<AppState>,
    input: WhatsAppTemplateSend<'_>,
) -> Result<Document, AppError> {
    let message_type = if input.category.eq_ignore_ascii_case("marketing") {
        "reminder"
    } else {
        "utility"
    };
    if message_type == "reminder"
        && state
            .whatsapp
            .customer_marketing_opt_out(input.salon_id, input.to_phone)
            .await?
    {
        return state
            .whatsapp
            .insert_outbound(whatsapp_outbound_doc(
                &state.config,
                input.salon_id,
                input.to_phone,
                message_type,
                &format!("Template {}", input.template_name),
                None,
                input.metadata.clone(),
                "failed",
                "recipient_opted_out",
            )?)
            .await;
    }
    let template_payload = whatsapp_template_payload(
        input.to_phone,
        input.template_name,
        input.language,
        &input.body_parameters,
    );
    let row = state
        .whatsapp
        .insert_outbound(whatsapp_outbound_doc(
            &state.config,
            input.salon_id,
            input.to_phone,
            message_type,
            &format!("Template {}", input.template_name),
            Some(template_payload.clone()),
            input.metadata.clone(),
            "queued",
            "",
        )?)
        .await?;
    let id = row.get_object_id("_id").map_err(|_| AppError::Database)?;
    if state.config.whatsapp_provider == "mock" {
        return state
            .whatsapp
            .update_outbound_send_result(id, "sent", &format!("mock_{}", id.to_hex()), "", false)
            .await;
    }
    match attempt_meta_send(state, input.salon_id, template_payload).await {
        Ok(provider_message_id) => {
            state
                .whatsapp
                .update_outbound_send_result(id, "sent", &provider_message_id, "", false)
                .await
        }
        Err(error) => {
            state
                .whatsapp
                .update_outbound_send_result(id, "failed", "", &error.to_string(), true)
                .await
        }
    }
}

fn whatsapp_template_payload(
    to_phone: &str,
    template_name: &str,
    language: &str,
    body_parameters: &[String],
) -> serde_json::Value {
    let components = if body_parameters.is_empty() {
        Vec::new()
    } else {
        vec![serde_json::json!({
            "type": "body",
            "parameters": body_parameters.iter().map(|value| serde_json::json!({ "type": "text", "text": value })).collect::<Vec<_>>()
        })]
    };
    serde_json::json!({
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "template",
        "template": { "name": template_name, "language": { "code": language }, "components": components }
    })
}

#[allow(clippy::too_many_arguments)]
fn whatsapp_outbound_doc(
    config: &AppConfig,
    salon_id: &str,
    to_phone: &str,
    message_type: &str,
    body: &str,
    template_payload: Option<serde_json::Value>,
    metadata: serde_json::Value,
    status: &str,
    error: &str,
) -> Result<Document, AppError> {
    let mut doc = doc! {
        "salonId": salon_id,
        "appointmentId": mongodb::bson::Bson::Null,
        "toPhone": to_phone,
        "type": message_type,
        "body": with_opt_out_footer(message_type, body),
        "interactive": mongodb::bson::Bson::Null,
        "metadata": mongodb::bson::to_bson(&metadata).map_err(|_| AppError::Validation("Invalid WhatsApp metadata.".to_string()))?,
        "provider": &config.whatsapp_provider,
        "providerMessageId": "",
        "status": status,
        "error": error,
        "retryCount": 0,
        "lastAttemptAt": DateTime::now(),
        "createdAt": DateTime::now(),
        "updatedAt": DateTime::now(),
    };
    doc.insert(
        "templatePayload",
        match template_payload {
            Some(value) => mongodb::bson::to_bson(&value).map_err(|_| {
                AppError::Validation("Invalid WhatsApp template payload.".to_string())
            })?,
            None => mongodb::bson::Bson::Null,
        },
    );
    Ok(doc)
}

fn with_opt_out_footer(message_type: &str, body: &str) -> String {
    if !matches!(
        message_type,
        "reminder" | "birthday" | "loyalty" | "feedback" | "rebooking"
    ) || body.contains("Reply STOP to opt out")
    {
        return body.to_string();
    }
    format!("{body}\n\nReply STOP to opt out.")
}

async fn resolve_meta_credentials(
    state: &Arc<AppState>,
    salon_id: &str,
) -> Result<(String, String), AppError> {
    if state.config.whatsapp_provider == "meta_test"
        || state.config.whatsapp_provider == "meta_production"
    {
        let connection = state
            .whatsapp
            .connected_connection(salon_id)
            .await?
            .ok_or(AppError::ExternalService)?;
        let encrypted = connection
            .get_str("encryptedAccessToken")
            .map_err(|_| AppError::ExternalService)?;
        let token = decrypt_secret(&state.config, encrypted)?;
        let phone_number_id = connection
            .get_str("phoneNumberId")
            .map_err(|_| AppError::ExternalService)?
            .to_string();
        return Ok((token, phone_number_id));
    }
    let token = state
        .config
        .meta_whatsapp_token
        .clone()
        .ok_or(AppError::ExternalService)?;
    let phone_number_id = state
        .config
        .meta_waba_phone_number_id
        .clone()
        .ok_or(AppError::ExternalService)?;
    Ok((token, phone_number_id))
}

async fn attempt_meta_send(
    state: &Arc<AppState>,
    salon_id: &str,
    payload: serde_json::Value,
) -> Result<String, AppError> {
    let (token, phone_number_id) = resolve_meta_credentials(state, salon_id).await?;
    let version = state
        .config
        .meta_api_version
        .as_deref()
        .unwrap_or(&state.config.meta_graph_api_version);
    let response = reqwest::Client::new()
        .post(format!(
            "{}/{}/{}/messages",
            state.config.meta_graph_api_base_url, version, phone_number_id
        ))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        return Err(AppError::Validation(
            payload
                .pointer("/error/message")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Meta send failed ({})", status.as_u16())),
        ));
    }
    Ok(payload
        .pointer("/messages/0/id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string())
}

async fn send_whatsapp_message(
    state: &Arc<AppState>,
    salon_id: &str,
    to_phone: &str,
    message_type: &str,
    body: &str,
    interactive: Option<serde_json::Value>,
    metadata: serde_json::Value,
) -> Result<Document, AppError> {
    if matches!(
        message_type,
        "reminder" | "birthday" | "loyalty" | "feedback" | "rebooking"
    ) && state
        .whatsapp
        .customer_marketing_opt_out(salon_id, to_phone)
        .await?
    {
        return state
            .whatsapp
            .insert_outbound(whatsapp_outbound_doc(
                &state.config,
                salon_id,
                to_phone,
                message_type,
                body,
                None,
                metadata.clone(),
                "failed",
                "recipient_opted_out",
            )?)
            .await;
    }
    let row = state
        .whatsapp
        .insert_outbound(whatsapp_outbound_doc(
            &state.config,
            salon_id,
            to_phone,
            message_type,
            body,
            None,
            metadata,
            "queued",
            "",
        )?)
        .await?;
    let id = row.get_object_id("_id").map_err(|_| AppError::Database)?;
    if state.config.whatsapp_provider == "mock" {
        return state
            .whatsapp
            .update_outbound_send_result(id, "sent", &format!("mock_{}", id.to_hex()), "", false)
            .await;
    }
    let mut payload_object = serde_json::Map::new();
    payload_object.insert(
        "messaging_product".to_string(),
        serde_json::json!("whatsapp"),
    );
    payload_object.insert("to".to_string(), serde_json::json!(to_phone));
    payload_object.insert("type".to_string(), serde_json::json!("text"));
    payload_object.insert("text".to_string(), serde_json::json!({ "body": body }));
    if let Some(interactive) = interactive {
        payload_object.insert("interactive".to_string(), interactive);
    }
    let payload = serde_json::Value::Object(payload_object);
    let provider_message_id = if state.config.whatsapp_provider == "mock" {
        format!("mock_{}", id.to_hex())
    } else {
        match attempt_meta_send(state, salon_id, payload).await {
            Ok(provider_message_id) => provider_message_id,
            Err(error) => {
                return state
                    .whatsapp
                    .update_outbound_send_result(id, "failed", "", &error.to_string(), true)
                    .await
            }
        }
    };
    state
        .whatsapp
        .update_outbound_send_result(id, "sent", &provider_message_id, "", false)
        .await
}

/// Formats an RFC3339 UTC timestamp as `YYYY-MM-DD HH:MM` in Asia/Kolkata (UTC+05:30).
fn lines_with_kolkata_time(rfc3339: &str) -> String {
    let ist = chrono::FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("valid offset");
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map(|dt| dt.with_timezone(&ist).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| rfc3339.to_string())
}

fn start_whatsapp_nudge_loop(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15 * 60));
        loop {
            interval.tick().await;
            if let Err(error) = run_whatsapp_nudge_jobs(&state).await {
                tracing::warn!(?error, "WhatsApp nudge jobs failed");
            }
        }
    });
}

async fn run_whatsapp_nudge_jobs(state: &Arc<AppState>) -> Result<(), AppError> {
    let _ = run_expired_hold_cleanup(state).await?;
    let _ = run_appointment_reminders(state).await?;
    let _ = run_rebooking_nudges(state).await?;
    let _ = run_abandoned_booking_nudges(state).await?;
    Ok(())
}

async fn already_sent_nudge(
    state: &Arc<AppState>,
    salon_id: &str,
    dedupe_key: &str,
) -> Result<bool, AppError> {
    let outbounds = state
        .store
        .database
        .collection::<Document>("whatsappoutbounds");
    Ok(outbounds
        .find_one(
            doc! { "salonId": salon_id, "metadata.dedupeKey": dedupe_key },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?
        .is_some())
}

async fn customer_doc_by_id(
    state: &Arc<AppState>,
    salon_id: &str,
    customer_id: &str,
) -> Result<Option<Document>, AppError> {
    let Ok(oid) = ObjectId::parse_str(customer_id) else {
        return Ok(None);
    };
    state
        .store
        .database
        .collection::<Document>("customers")
        .find_one(doc! { "_id": oid, "salonId": salon_id }, None)
        .await
        .map_err(|_| AppError::Database)
}

async fn run_rebooking_nudges(state: &Arc<AppState>) -> Result<usize, AppError> {
    let appointments = state.store.database.collection::<Document>("appointments");
    let now = DateTime::now();
    let since = DateTime::from_millis(now.timestamp_millis() - 60 * 24 * 60 * 60_000);
    let one_day_ago = DateTime::from_millis(now.timestamp_millis() - 24 * 60 * 60_000);
    let mut cursor = appointments
        .find(
            doc! {
                "status": "completed",
                "startAt": { "$gte": since, "$lte": one_day_ago },
                "customerId": { "$exists": true, "$ne": "" },
            },
            mongodb::options::FindOptions::builder()
                .sort(doc! { "startAt": -1 })
                .limit(200)
                .build(),
        )
        .await
        .map_err(|_| AppError::Database)?;
    let mut sent = 0;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let appointment: Document = cursor
            .deserialize_current()
            .map_err(|_| AppError::Database)?;
        let salon_id = appointment.get_str("salonId").unwrap_or_default();
        let customer_id = appointment.get_str("customerId").unwrap_or_default();
        let Some(customer) = customer_doc_by_id(state, salon_id, customer_id).await? else {
            continue;
        };
        if customer.get_bool("marketingOptOut").unwrap_or(false) {
            continue;
        }
        let phone = customer.get_str("normalizedPhone").unwrap_or_default();
        if phone.is_empty() {
            continue;
        }
        let service_ids = string_array(&appointment, "serviceIds");
        let dedupe_key = format!(
            "rebooking:{}:{}:{}",
            salon_id,
            customer_id,
            service_ids.join(",")
        );
        if already_sent_nudge(state, salon_id, &dedupe_key).await? {
            continue;
        }
        let service_names = string_array(&appointment, "serviceNames").join(", ");
        let customer_name = customer.get_str("name").unwrap_or("there");
        let start_at = appointment
            .get_datetime("startAt")
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(now.timestamp_millis());
        let next_due = DateTime::from_millis(start_at + 4 * 7 * 24 * 60 * 60_000)
            .try_to_rfc3339_string()
            .unwrap_or_default();
        let appointment_id = appointment
            .get_object_id("_id")
            .map(|oid| oid.to_hex())
            .unwrap_or_default();
        let _ = send_whatsapp_message(
            state,
            salon_id,
            phone,
            "rebooking",
            &format!(
                "It's about time for your next {} session, {}!\nIdeal next visit is around {}. Reply BOOK to schedule it now.",
                service_names,
                customer_name,
                lines_with_kolkata_time(&next_due)
            ),
            None,
            serde_json::json!({ "dedupeKey": dedupe_key, "source": "rebooking", "appointmentId": appointment_id }),
        )
        .await;
        sent += 1;
    }
    Ok(sent)
}

async fn run_expired_hold_cleanup(state: &Arc<AppState>) -> Result<usize, AppError> {
    let appointments = state.store.database.collection::<Document>("appointments");
    let waitlists = state.store.database.collection::<Document>("waitlists");
    let slot_locks = state
        .store
        .database
        .collection::<Document>("appointmentslotlocks");
    let now = DateTime::now();
    let mut expired = appointments
        .find(
            doc! { "status": "pending", "holdExpiresAt": { "$lte": now } },
            mongodb::options::FindOptions::builder().limit(200).build(),
        )
        .await
        .map_err(|_| AppError::Database)?;
    let mut count = 0;
    while expired.advance().await.map_err(|_| AppError::Database)? {
        let appointment: Document = expired
            .deserialize_current()
            .map_err(|_| AppError::Database)?;
        let appointment_id = appointment
            .get_object_id("_id")
            .map(|oid| oid.to_hex())
            .unwrap_or_default();
        let salon_id = appointment.get_str("salonId").unwrap_or_default();
        appointments
            .update_one(
                doc! { "_id": appointment.get_object_id("_id").map_err(|_| AppError::Database)?, "status": "pending" },
                doc! { "$set": { "status": "expired", "paymentStatus": "failed", "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let _ = slot_locks
            .delete_many(
                doc! { "salonId": salon_id, "appointmentId": &appointment_id },
                None,
            )
            .await;
        let _ = waitlists
            .update_one(
                doc! { "salonId": salon_id, "offeredAppointmentId": &appointment_id, "status": "offered" },
                doc! { "$set": { "status": "expired", "updatedAt": DateTime::now() } },
                None,
            )
            .await;
        count += 1;
    }
    Ok(count)
}

async fn run_appointment_reminders(state: &Arc<AppState>) -> Result<usize, AppError> {
    let appointments = state.store.database.collection::<Document>("appointments");
    let now = DateTime::now();
    let from = DateTime::from_millis(now.timestamp_millis() + 115 * 60_000);
    let to = DateTime::from_millis(now.timestamp_millis() + 125 * 60_000);
    let mut cursor = appointments
        .find(
            doc! {
                "status": { "$in": ["booked", "confirmed"] },
                "startAt": { "$gte": from, "$lte": to },
                "customerId": { "$exists": true, "$ne": "" },
            },
            mongodb::options::FindOptions::builder().limit(200).build(),
        )
        .await
        .map_err(|_| AppError::Database)?;
    let mut sent = 0;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let appointment: Document = cursor
            .deserialize_current()
            .map_err(|_| AppError::Database)?;
        let salon_id = appointment.get_str("salonId").unwrap_or_default();
        let customer_id = appointment.get_str("customerId").unwrap_or_default();
        let Some(customer) = customer_doc_by_id(state, salon_id, customer_id).await? else {
            continue;
        };
        if customer.get_bool("marketingOptOut").unwrap_or(false) {
            continue;
        }
        let phone = customer.get_str("normalizedPhone").unwrap_or_default();
        if phone.is_empty() {
            continue;
        }
        let appointment_id = appointment
            .get_object_id("_id")
            .map(|oid| oid.to_hex())
            .unwrap_or_default();
        let dedupe_key = format!("reminder:2h:{appointment_id}");
        if already_sent_nudge(state, salon_id, &dedupe_key).await? {
            continue;
        }
        let service_names = string_array(&appointment, "serviceNames").join(", ");
        let start = appointment
            .get_datetime("startAt")
            .ok()
            .and_then(|dt| dt.try_to_rfc3339_string().ok())
            .map(|value| lines_with_kolkata_time(&value))
            .unwrap_or_default();
        let _ = send_whatsapp_message(
            state,
            salon_id,
            phone,
            "reminder",
            &format!("Reminder: your {} appointment is at {}. See you soon!", service_names, start),
            None,
            serde_json::json!({ "dedupeKey": dedupe_key, "source": "appointment_reminder", "appointmentId": appointment_id }),
        )
        .await;
        sent += 1;
    }
    Ok(sent)
}

async fn run_abandoned_booking_nudges(state: &Arc<AppState>) -> Result<usize, AppError> {
    let appointments = state.store.database.collection::<Document>("appointments");
    let cutoff = DateTime::from_millis(DateTime::now().timestamp_millis() - 12 * 60_000);
    let mut cursor = appointments
        .find(
            doc! {
                "status": "pending",
                "holdExpiresAt": null,
                "paymentStatus": "pending",
                "createdAt": { "$lte": cutoff },
                "customerId": { "$exists": true, "$ne": "" },
            },
            mongodb::options::FindOptions::builder()
                .sort(doc! { "createdAt": -1 })
                .limit(200)
                .build(),
        )
        .await
        .map_err(|_| AppError::Database)?;
    let mut sent = 0;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let appointment: Document = cursor
            .deserialize_current()
            .map_err(|_| AppError::Database)?;
        let salon_id = appointment.get_str("salonId").unwrap_or_default();
        let customer_id = appointment.get_str("customerId").unwrap_or_default();
        let Some(customer) = customer_doc_by_id(state, salon_id, customer_id).await? else {
            continue;
        };
        if customer.get_bool("marketingOptOut").unwrap_or(false) {
            continue;
        }
        let phone = customer.get_str("normalizedPhone").unwrap_or_default();
        if phone.is_empty() {
            continue;
        }
        let appointment_id = appointment
            .get_object_id("_id")
            .map(|oid| oid.to_hex())
            .unwrap_or_default();
        let dedupe_key = format!("abandoned:{appointment_id}");
        if already_sent_nudge(state, salon_id, &dedupe_key).await? {
            continue;
        }
        let service_names = string_array(&appointment, "serviceNames").join(", ");
        let customer_name = customer.get_str("name").unwrap_or("there");
        let when = appointment
            .get_datetime("startAt")
            .ok()
            .and_then(|dt| dt.try_to_rfc3339_string().ok())
            .map(|value| format!(" for {}", lines_with_kolkata_time(&value)))
            .unwrap_or_default();
        let value = appointment
            .get_i64("value")
            .ok()
            .filter(|value| *value > 0)
            .map(|value| format!(" (Rs {:.2})", value as f64 / 100.0))
            .unwrap_or_default();
        let _ = send_whatsapp_message(
            state,
            salon_id,
            phone,
            "abandoned",
            &format!(
                "Still want {}{}{}, {}?\nReply YES to continue, RESCHEDULE to move it, or BOOK to pick another time.",
                service_names, value, when, customer_name
            ),
            None,
            serde_json::json!({ "dedupeKey": dedupe_key, "source": "abandoned_booking", "appointmentId": appointment_id }),
        )
        .await;
        sent += 1;
    }
    Ok(sent)
}

fn string_array(doc: &Document, key: &str) -> Vec<String> {
    doc.get(key)
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn start_shopify_execution_loop(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if let Err(error) = run_due_shopify_executions(&state, None).await {
                tracing::warn!(?error, "Shopify automation execution loop failed");
            }
        }
    });
}

async fn run_due_shopify_executions(
    state: &Arc<AppState>,
    salon_filter: Option<&str>,
) -> Result<usize, AppError> {
    let executions = state
        .store
        .database
        .collection::<Document>("shopifyflowexecutions");
    let flows = state.store.database.collection::<Document>("shopifyflows");
    let now = DateTime::now();
    let stale_lock = DateTime::from_millis(now.timestamp_millis() - 10 * 60_000);
    let mut attempted = 0;
    for _ in 0..50 {
        let mut filter = doc! {
            "status": { "$in": ["queued", "waiting", "failed"] },
            "retryCount": { "$lte": 3 },
            "$and": [
                { "nextRunAt": { "$lte": now } },
                { "$or": [{ "lockedAt": null }, { "lockedAt": { "$lte": stale_lock } }] },
            ],
        };
        if let Some(salon_id) = salon_filter {
            filter.insert("salonId", salon_id);
        }
        let Some(execution) = executions
            .find_one_and_update(
                filter,
                doc! { "$set": { "status": "running", "lockedAt": now, "updatedAt": now } },
                mongodb::options::FindOneAndUpdateOptions::builder()
                    .sort(doc! { "nextRunAt": 1, "scheduledAt": 1 })
                    .return_document(mongodb::options::ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
        else {
            break;
        };
        attempted += 1;
        let execution_id = execution
            .get_object_id("_id")
            .map_err(|_| AppError::Database)?;
        let salon_id = execution.get_str("salonId").unwrap_or_default().to_string();
        let flow_id = execution.get_str("flowId").unwrap_or_default().to_string();
        let flow_oid = ObjectId::parse_str(&flow_id).map_err(|_| AppError::Database)?;
        let Some(flow) = flows
            .find_one(
                doc! { "_id": flow_oid, "salonId": &salon_id, "status": "active" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?
        else {
            let _ = executions
                .update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "completed", "lockedAt": null, "updatedAt": DateTime::now() } }, None)
                .await;
            continue;
        };
        let current_node_id = execution.get_str("currentNodeId").unwrap_or_default();
        let node = flow
            .get_array("nodes")
            .ok()
            .and_then(|nodes| {
                nodes
                    .iter()
                    .filter_map(|item| item.as_document())
                    .find(|doc| doc.get_str("id").unwrap_or_default() == current_node_id)
                    .or_else(|| nodes.first().and_then(|item| item.as_document()))
            })
            .cloned();
        let Some(node) = node else {
            let _ = executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "completed", "lockedAt": null, "updatedAt": DateTime::now() } }, None).await;
            continue;
        };
        if let Err(error) = execute_shopify_node(
            state,
            &executions,
            &flows,
            execution_id,
            flow_oid,
            &execution,
            &node,
        )
        .await
        {
            let retry_count = execution.get_i64("retryCount").unwrap_or(0) + 1;
            let status = if retry_count <= 3 {
                "waiting"
            } else {
                "failed"
            };
            executions
                .update_one(
                    doc! { "_id": execution_id },
                    doc! { "$set": { "status": status, "nextRunAt": DateTime::from_millis(DateTime::now().timestamp_millis() + retry_count.min(5) * 60_000), "lockedAt": null, "error": error_message(&error), "updatedAt": DateTime::now() }, "$inc": { "retryCount": 1 } },
                    None,
                )
                .await
                .map_err(|_| AppError::Database)?;
        }
    }
    Ok(attempted)
}

async fn execute_shopify_node(
    state: &Arc<AppState>,
    executions: &mongodb::Collection<Document>,
    flows: &mongodb::Collection<Document>,
    execution_id: ObjectId,
    flow_oid: ObjectId,
    execution: &Document,
    node: &Document,
) -> Result<(), AppError> {
    let node_type = node.get_str("type").unwrap_or_default();
    let next = node.get_str("next").unwrap_or_default().to_string();
    if node_type == "stop"
        || execution
            .get_str("currentNodeId")
            .unwrap_or_default()
            .is_empty()
    {
        executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "completed", "lockedAt": null, "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        flows.update_one(doc! { "_id": flow_oid }, doc! { "$inc": { "metrics.completed": 1 }, "$set": { "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        return Ok(());
    }
    if node_type == "wait" {
        let minutes = node
            .get_document("config")
            .ok()
            .and_then(|cfg| cfg.get_i64("minutes").ok())
            .unwrap_or(1)
            .max(1);
        executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "waiting", "currentNodeId": next, "nextRunAt": DateTime::from_millis(DateTime::now().timestamp_millis() + minutes * 60_000), "lockedAt": null, "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        return Ok(());
    }
    if node_type == "condition" {
        let config = node.get_document("config").cloned().unwrap_or_default();
        let context = execution
            .get_document("context")
            .cloned()
            .unwrap_or_default();
        let branch = if evaluate_shopify_condition(&config, &context) {
            "yes"
        } else {
            "no"
        };
        let next_id = node.get_str(branch).unwrap_or_default().to_string();
        executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "queued", "currentNodeId": next_id, "nextRunAt": DateTime::now(), "lockedAt": null, "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        return Ok(());
    }
    if node_type == "whatsapp_template" {
        let config = node.get_document("config").cloned().unwrap_or_default();
        let context = execution
            .get_document("context")
            .cloned()
            .unwrap_or_default();
        let phone = context.get_str("phone").unwrap_or_default();
        if phone.is_empty() {
            return Err(AppError::Validation(
                "No customer phone number in Shopify event.".to_string(),
            ));
        }
        let template_name = config.get_str("templateName").unwrap_or_default();
        let language = config.get_str("language").unwrap_or("en");
        let row = send_whatsapp_template_message(state, WhatsAppTemplateSend {
            salon_id: execution.get_str("salonId").unwrap_or_default(),
            to_phone: phone,
            template_name,
            language,
            category: "MARKETING",
            body_parameters: vec![context.get_str("customerName").unwrap_or("Customer").to_string()],
            metadata: serde_json::json!({ "source": "shopify_automation", "flowId": execution.get_str("flowId").unwrap_or_default(), "executionId": execution_id.to_hex(), "nodeId": node.get_str("id").unwrap_or_default(), "templateName": template_name, "shopifyOrderId": context.get_str("orderId").unwrap_or_default(), "shopifyCheckoutId": context.get_str("checkoutId").unwrap_or_default(), "dedupeKey": format!("{}:{}:{}", execution.get_str("flowId").unwrap_or_default(), execution.get_str("externalEventId").unwrap_or_default(), node.get_str("id").unwrap_or_default()) }),
        }).await?;
        if row.get_str("status").unwrap_or_default() == "failed" {
            return Err(AppError::ExternalService);
        }
        executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "queued", "currentNodeId": next, "nextRunAt": DateTime::now(), "lockedAt": null, "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        flows.update_one(doc! { "_id": flow_oid }, doc! { "$inc": { "metrics.messagesSent": 1 }, "$set": { "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
        return Ok(());
    }
    executions.update_one(doc! { "_id": execution_id }, doc! { "$set": { "status": "queued", "currentNodeId": next, "nextRunAt": DateTime::now(), "lockedAt": null, "updatedAt": DateTime::now() } }, None).await.map_err(|_| AppError::Database)?;
    Ok(())
}

fn evaluate_shopify_condition(config: &Document, context: &Document) -> bool {
    let field = config.get_str("field").unwrap_or_default();
    let operator = config.get_str("operator").unwrap_or("equals");
    let expected = config
        .get("value")
        .map(|v| v.to_string())
        .unwrap_or_default()
        .trim_matches('"')
        .to_ascii_lowercase();
    let actual = context
        .get(field)
        .map(|v| v.to_string())
        .unwrap_or_default()
        .trim_matches('"')
        .to_ascii_lowercase();
    match operator {
        "contains" => actual.contains(&expected),
        "not_equals" => actual != expected,
        _ => actual == expected,
    }
}

fn razorpay_configured(config: &AppConfig) -> bool {
    config
        .razorpay_key_id
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        && config
            .razorpay_key_secret
            .as_deref()
            .is_some_and(|value| !value.is_empty())
}

fn verify_razorpay_webhook(
    config: &AppConfig,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<bool, AppError> {
    let Some(secret) = config.razorpay_webhook_secret.as_deref() else {
        return Ok(config.env != "production");
    };
    let Some(received) = headers
        .get("x-razorpay-signature")
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(false);
    };
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).map_err(|_| AppError::Internal)?;
    mac.update(body);
    Ok(constant_time_equal(
        &hex_lower(&mac.finalize().into_bytes()).into_bytes(),
        received.as_bytes(),
    ))
}

fn razorpay_auth_header(config: &AppConfig) -> Result<String, AppError> {
    let key_id = config
        .razorpay_key_id
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let key_secret = config
        .razorpay_key_secret
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let pair = format!("{}:{}", key_id, key_secret);
    Ok(format!("Basic {}", base64_encode(pair.as_bytes())))
}

async fn create_razorpay_payment_link(
    config: &AppConfig,
    amount_paise: i64,
    customer_name: &str,
    customer_phone: &str,
    appointment_id: &str,
    salon_id: &str,
) -> Result<Document, AppError> {
    if !razorpay_configured(config) {
        return Err(AppError::ExternalService);
    }
    let auth = razorpay_auth_header(config)?;
    let body = serde_json::json!({
        "amount": amount_paise,
        "currency": "INR",
        "accept_partial": false,
        "description": "Solastio booking deposit",
        "customer": { "name": customer_name, "contact": customer_phone },
        "notify": { "sms": false, "email": false },
        "notes": { "appointmentId": appointment_id, "salonId": salon_id, "source": "whatsapp" }
    });
    let response = reqwest::Client::new()
        .post("https://api.razorpay.com/v1/payment_links")
        .header("Authorization", auth)
        .json(&body)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        return Err(AppError::ExternalService);
    }
    let id = payload
        .pointer("/id")
        .and_then(|value| value.as_str())
        .ok_or(AppError::ExternalService)?;
    let short_url = payload
        .pointer("/short_url")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    Ok(doc! { "id": id, "shortUrl": short_url })
}

async fn whatsapp_razorpay_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<axum::response::Response, AppError> {
    if !verify_razorpay_webhook(&state.config, &headers, &body)? {
        return Err(AppError::Authorization);
    }
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::Validation("Invalid Razorpay webhook payload.".to_string()))?;
    let event = payload.get("event").and_then(|value| value.as_str());
    let link_id = payload
        .pointer("/payload/payment_link/entity/id")
        .and_then(|value| value.as_str());
    let notes_appointment = payload
        .pointer("/payload/payment_link/entity/notes/appointmentId")
        .and_then(|value| value.as_str());
    let notes_salon = payload
        .pointer("/payload/payment_link/entity/notes/salonId")
        .and_then(|value| value.as_str());
    let payment_id = payload
        .pointer("/payload/payment/entity/id")
        .and_then(|value| value.as_str());
    if event != Some("payment_link.paid")
        || link_id.is_none()
        || notes_appointment.is_none()
        || notes_salon.is_none()
    {
        return Ok(ok(serde_json::json!({ "ignored": true })));
    }
    let salon_id = notes_salon.unwrap().to_string();
    let appointment_id = ObjectId::parse_str(notes_appointment.unwrap())
        .map_err(|_| AppError::Validation("Invalid appointment id in webhook.".to_string()))?;
    let reference = payment_id.unwrap_or(link_id.unwrap()).to_string();
    let outcome = state
        .appointment_repo
        .confirm_deposit_payment(&salon_id, appointment_id, link_id.unwrap(), &reference)
        .await
        .map_err(|_| AppError::Database)?;
    if outcome != "confirmed" {
        return Ok(ok(serde_json::json!({
            "confirmed": outcome == "confirmed",
            "expired": outcome == "expired",
            "appointmentId": appointment_id.to_hex(),
        })));
    }
    let appointment_doc = state
        .appointment_repo
        .deposit_appointment(&salon_id, appointment_id)
        .await
        .ok()
        .flatten();
    let customer_phone = match appointment_doc
        .as_ref()
        .and_then(|doc| doc.get_str("customerId").ok())
    {
        Some(customer_id) => state
            .appointment_repo
            .customer_phone(customer_id)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    if let Some(phone) = customer_phone {
        let appointment = appointment_doc.unwrap_or_default();
        let service_names = appointment
            .get("serviceNames")
            .and_then(|value| value.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| entry.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let service_ids: Vec<String> = appointment
            .get("serviceIds")
            .and_then(|value| value.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| entry.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if let (Ok(staff_id), Ok(start_at)) = (
            appointment.get_str("staffId"),
            appointment.get_datetime("startAt"),
        ) {
            let _ = state
                .whatsapp
                .record_customer_booking(&salon_id, &phone, staff_id, service_ids, *start_at)
                .await;
        }
        let value_paise = appointment.get_i64("value").unwrap_or(0);
        let body_msg = format!(
            "Your appointment is confirmed.\nService: {}\nPrice: Rs {:.2}",
            service_names,
            value_paise as f64 / 100.0
        );
        let _ = send_whatsapp_message(
            &state,
            &salon_id,
            &phone,
            "confirmation",
            &body_msg,
            None,
            serde_json::json!({ "appointmentId": appointment_id.to_hex(), "source": "razorpay_webhook" }),
        )
            .await;
    }
    Ok(ok(
        serde_json::json!({ "confirmed": true, "appointmentId": appointment_id.to_hex() }),
    ))
}

async fn shopify_install_url_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    request: ShopifyInstallUrlRequest,
) -> Result<axum::response::Response, AppError> {
    let shop = normalize_shop(&request.shop)?;
    let api_key = state
        .config
        .shopify_api_key
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let app_url = state.config.shopify_app_url.clone().unwrap_or_default();
    let redirect_uri = format!(
        "{}/api/v1/shopify-automation/shopify/callback",
        app_url.trim_end_matches('/')
    );
    let state_param = base64_url_encode(
        format!(
            "{{\"salonId\":\"{}\",\"userId\":\"{}\",\"ts\":{}}}",
            salon_id,
            user_id,
            now_millis()
        )
        .as_bytes(),
    );
    let install_url = format!(
        "https://{}/admin/oauth/authorize?client_id={}&scope={}&redirect_uri={}&state={}",
        shop,
        url_component(api_key),
        url_component(&state.config.shopify_scopes),
        url_component(&redirect_uri),
        url_component(&state_param)
    );
    Ok(ok(
        serde_json::json!({ "shop": shop, "installUrl": install_url }),
    ))
}

async fn connect_shopify_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    shop: &str,
    code: &str,
) -> Result<axum::response::Response, AppError> {
    Ok(ok(connect_shopify_raw(
        state, salon_id, user_id, shop, code,
    )
    .await?))
}

async fn connect_shopify_raw(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    shop: &str,
    code: &str,
) -> Result<serde_json::Value, AppError> {
    let shop = normalize_shop(shop)?;
    let api_key = state
        .config
        .shopify_api_key
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let api_secret = state
        .config
        .shopify_api_secret
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let response = reqwest::Client::new()
        .post(format!("https://{shop}/admin/oauth/access_token"))
        .json(
            &serde_json::json!({ "client_id": api_key, "client_secret": api_secret, "code": code }),
        )
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let token = payload
        .get("access_token")
        .and_then(|item| item.as_str())
        .ok_or_else(|| AppError::Validation("Shopify authorization failed.".to_string()))?;
    let scopes = payload
        .get("scope")
        .and_then(|item| item.as_str())
        .unwrap_or(&state.config.shopify_scopes)
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let encrypted = encrypt_secret(&state.config, token)?;
    let store = state
        .shopify_users
        .upsert_connected_store(
            salon_id,
            &shop,
            doc! { "salonId": salon_id, "shop": &shop, "encryptedAccessToken": encrypted, "scopes": scopes, "status": "connected", "connectedAt": DateTime::now(), "createdBy": user_id, "storeName": &shop, "updatedAt": DateTime::now() },
        )
        .await?;
    let (webhooks, webhook_error) =
        match register_shopify_webhooks(&state.config, &shop, token).await {
            Ok(result) => (
                serde_json::to_value(result).map_err(|_| AppError::Internal)?,
                serde_json::Value::Null,
            ),
            Err(error) => (
                serde_json::Value::Null,
                serde_json::Value::String(error.to_string()),
            ),
        };
    Ok(serde_json::json!({
        "shop": store.get_str("shop").unwrap_or(&shop),
        "status": store.get_str("status").unwrap_or("connected"),
        "connectedAt": bson_field_json(&store, "connectedAt"),
        "webhooks": webhooks,
        "webhookError": webhook_error
    }))
}

async fn test_shopify_for_salon(
    state: &Arc<AppState>,
    salon_id: &str,
) -> Result<axum::response::Response, AppError> {
    let store = state
        .shopify_users
        .connected_store_for_salon(salon_id)
        .await?
        .ok_or_else(|| AppError::NotFound("No connected Shopify store.".to_string()))?;
    let shop = store.get_str("shop").map_err(|_| AppError::Database)?;
    let encrypted = store
        .get_str("encryptedAccessToken")
        .map_err(|_| AppError::Database)?;
    let token = decrypt_secret(&state.config, encrypted)?;
    let response = reqwest::Client::new()
        .get(format!("https://{shop}/admin/api/2025-07/shop.json"))
        .header("X-Shopify-Access-Token", token)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    if !response.status().is_success() {
        return Err(AppError::Validation(format!(
            "Shopify test failed ({}).",
            response.status().as_u16()
        )));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| AppError::ExternalService)?;
    Ok(ok(serde_json::json!({
        "shop": shop,
        "storeName": payload.pointer("/shop/name").and_then(|item| item.as_str()).unwrap_or(store.get_str("storeName").unwrap_or(shop)),
        "status": store.get_str("status").unwrap_or("connected"),
        "lastSyncAt": DateTime::now().try_to_rfc3339_string().ok(),
    })))
}

async fn register_shopify_webhooks(
    config: &AppConfig,
    shop: &str,
    access_token: &str,
) -> Result<ShopifyWebhookRegistration, AppError> {
    let app_url = config.shopify_app_url.clone().unwrap_or_default();
    if app_url.trim().is_empty() {
        return Err(AppError::ExternalService);
    }
    let webhook_uri = format!("{}/shopify/webhooks", app_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let list_response = client
        .get(format!("https://{shop}/admin/api/2025-07/webhooks.json"))
        .header("X-Shopify-Access-Token", access_token)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    if !list_response.status().is_success() {
        return Err(AppError::Validation(format!(
            "Failed to list existing webhooks ({}).",
            list_response.status().as_u16()
        )));
    }
    let payload: serde_json::Value = list_response
        .json()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let existing = payload
        .get("webhooks")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|webhook| {
            webhook.get("callback_url").and_then(|value| value.as_str()) == Some(&webhook_uri)
        })
        .filter_map(|webhook| {
            webhook
                .get("topic")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let mut registered = Vec::new();
    let mut failed = Vec::new();
    for topic in shopify_topics() {
        if existing.iter().any(|item| item == topic) {
            continue;
        }
        let create_response = client
            .post(format!("https://{shop}/admin/api/2025-07/webhooks.json"))
            .header("Content-Type", "application/json")
            .header("X-Shopify-Access-Token", access_token)
            .json(&serde_json::json!({ "webhook": { "topic": topic, "address": webhook_uri, "format": "json" } }))
            .send()
            .await
            .map_err(|_| AppError::ExternalService)?;
        if create_response.status().is_success() {
            registered.push(topic.to_string());
        } else {
            failed.push(topic.to_string());
        }
    }
    Ok(ShopifyWebhookRegistration {
        registered,
        existing,
        failed,
    })
}

async fn shopify_client_activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = shopify_context(&state, &headers, "client")?;
    let logs = state
        .shopify_users
        .documents("logs", &context.shop_domain, 20)
        .await?;
    Ok(ok(serde_json::Value::Array(
        logs.into_iter().map(client_activity_json).collect(),
    )))
}

async fn shopify_overview(
    state: &Arc<AppState>,
    shop_domain: &str,
) -> Result<serde_json::Value, AppError> {
    let store = state.shopify_users.latest_store(shop_domain).await?;
    let flows = state
        .shopify_users
        .documents("flows", shop_domain, 500)
        .await?;
    let today = chrono::Utc::now().date_naive();
    let today_start = today
        .and_hms_opt(0, 0, 0)
        .ok_or(AppError::Internal)?
        .and_utc();
    let sent_today = state
        .shopify_users
        .count_outbounds(
            shop_domain,
            doc! { "createdAt": { "$gte": DateTime::from_millis(today_start.timestamp_millis()) } },
        )
        .await?;
    let delivered = state
        .shopify_users
        .count_outbounds(shop_domain, doc! { "status": "delivered" })
        .await?;
    let failed = state
        .shopify_users
        .count_outbounds(shop_domain, doc! { "status": "failed" })
        .await?;
    let active_flows = flows
        .iter()
        .filter(|flow| flow.get_str("status").ok() == Some("active"))
        .count();
    Ok(serde_json::json!({
        "store": store.map(store_json),
        "stats": {
            "activeFlows": active_flows,
            "totalFlows": flows.len(),
            "sentToday": sent_today,
            "delivered": delivered,
            "failed": failed,
        }
    }))
}

fn shopify_context(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    required_role: &str,
) -> Result<ShopifyContext, AppError> {
    let token = headers
        .get("x-auth-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .map(str::to_string)
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim)
                .map(str::to_string)
        })
        .ok_or(AppError::Authentication)?;
    let mut validation = Validation::default();
    validation.set_issuer(&["shopify-automation"]);
    let data = decode::<ShopifyTokenClaims>(
        &token,
        &DecodingKey::from_secret(state.config.shopify_jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Authentication)?;
    if data.claims.iss != "shopify-automation"
        || data.claims.role != required_role
        || data.claims.sub.is_empty()
        || data.claims.exp == 0
    {
        return Err(AppError::Authorization);
    }
    Ok(ShopifyContext {
        shop_domain: data.claims.shop_domain,
    })
}

async fn issue_shopify_session(
    state: &Arc<AppState>,
    user: ShopifyUserRecord,
) -> Result<axum::response::Response, AppError> {
    let refresh_token = generate_refresh_token();
    let now = DateTime::now();
    let expires_at = DateTime::from_millis(
        now.timestamp_millis() + state.config.refresh_token_ttl_days * 24 * 60 * 60 * 1000,
    );
    state
        .shopify_users
        .append_refresh_token(
            user.id,
            RefreshTokenRecord {
                token_hash: hash_token(&refresh_token),
                issued_at: now,
                expires_at,
                revoked_at: None,
                replaced_by_hash: None,
                device_type: "web".to_string(),
            },
        )
        .await?;
    let claims = ShopifyClaims {
        sub: user.id.to_hex(),
        sid: uuid::Uuid::new_v4().to_string(),
        shop_domain: user.shop_domain.clone(),
        role: user.role.clone(),
        iss: "shopify-automation".to_string(),
        exp: (chrono::Utc::now().timestamp() + state.config.access_token_ttl_minutes * 60) as usize,
    };
    let access_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.shopify_jwt_secret.as_bytes()),
    )
    .map_err(|_| AppError::Internal)?;
    let mut response = ok(serde_json::json!({
        "accessToken": access_token,
        "user": shopify_user_json(&user),
    }));
    response.headers_mut().append(
        SET_COOKIE,
        shopify_refresh_cookie(&state.config, &refresh_token)?,
    );
    Ok(response)
}

fn shopify_user_json(user: &ShopifyUserRecord) -> serde_json::Value {
    serde_json::json!({
        "id": user.id.to_hex(),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "shopDomain": user.shop_domain,
    })
}

fn store_json(doc: Document) -> serde_json::Value {
    serde_json::json!({
        "shop": doc.get_str("shop").unwrap_or_default(),
        "storeName": doc.get_str("storeName").unwrap_or_default(),
        "status": doc.get_str("status").unwrap_or_default(),
    })
}

fn client_flow_json(doc: Document) -> serde_json::Value {
    serde_json::json!({
        "name": doc.get_str("name").unwrap_or_default(),
        "description": doc.get_str("description").unwrap_or_default(),
        "trigger": doc.get_str("trigger").unwrap_or_default(),
        "status": doc.get_str("status").unwrap_or_default(),
        "metrics": bson_field_json(&doc, "metrics"),
    })
}

fn client_activity_json(doc: Document) -> serde_json::Value {
    let phone = doc.get_str("toPhone").unwrap_or_default();
    let masked = if phone.len() > 7 {
        format!("{}****{}", &phone[..4], &phone[phone.len() - 3..])
    } else {
        String::new()
    };
    serde_json::json!({
        "phone": masked,
        "status": doc.get_str("status").unwrap_or_default(),
        "time": bson_field_json(&doc, "createdAt"),
    })
}

fn documents_json(docs: Vec<Document>) -> serde_json::Value {
    serde_json::Value::Array(docs.into_iter().map(document_json).collect())
}

fn document_json(doc: Document) -> serde_json::Value {
    mongodb::bson::from_bson(mongodb::bson::Bson::Document(doc)).unwrap_or(serde_json::Value::Null)
}

fn bson_field_json(doc: &Document, key: &str) -> serde_json::Value {
    doc.get(key)
        .cloned()
        .and_then(|value| mongodb::bson::from_bson(value).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn default_language() -> String {
    "en".to_string()
}

fn default_audience_source() -> String {
    "shopify".to_string()
}

fn string_field(row: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| Some(value.to_string()))
        })
        .unwrap_or_default()
}

fn number_field(row: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str()?.parse::<i64>().ok())
        })
        .unwrap_or_default()
}

fn bool_field(row: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> bool {
    keys.iter()
        .find_map(|key| row.get(*key))
        .map(|value| {
            value
                .as_bool()
                .unwrap_or_else(|| value.as_str().map(truthy_text).unwrap_or(false))
        })
        .unwrap_or(false)
}

fn tags_field(row: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    string_field(row, &["Tags", "tags"])
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

fn truthy_text(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
}

fn normalize_phone(value: &str) -> String {
    solastio_shared::phone::normalize_phone_india(value)
}

fn normalize_shop(value: &str) -> Result<String, AppError> {
    let shop = value
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or_default()
        .to_string();
    let valid = shop.ends_with(".myshopify.com")
        && shop
            .trim_end_matches(".myshopify.com")
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-');
    if !valid {
        return Err(AppError::Validation(
            "Enter a valid myshopify.com store URL.".to_string(),
        ));
    }
    Ok(shop)
}

fn parse_bson_datetime(value: &str) -> Option<DateTime> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| DateTime::from_millis(date.timestamp_millis()))
}

fn default_flow_status() -> String {
    "draft".to_string()
}

fn validate_flow_status(status: &str) -> Result<(), AppError> {
    if !matches!(status, "draft" | "active" | "paused") {
        return Err(AppError::Validation(
            "Flow status must be draft, active, or paused.".to_string(),
        ));
    }
    Ok(())
}

fn validate_flow_node(node: &ShopifyFlowNodeWrite) -> Result<(), AppError> {
    if node.id.trim().is_empty() || node.label.trim().is_empty() {
        return Err(AppError::Validation(
            "Flow node id and label are required.".to_string(),
        ));
    }
    if !matches!(
        node.node_type.as_str(),
        "trigger" | "wait" | "condition" | "whatsapp_template" | "stop"
    ) {
        return Err(AppError::Validation("Invalid flow node type.".to_string()));
    }
    Ok(())
}

fn parse_object_id(id: &str) -> Result<mongodb::bson::oid::ObjectId, AppError> {
    mongodb::bson::oid::ObjectId::parse_str(id)
        .map_err(|_| AppError::Validation("Invalid id.".to_string()))
}

fn flow_document(
    salon_id: &str,
    user_id: &str,
    flow: ShopifyFlowWrite,
) -> Result<Document, AppError> {
    if flow.name.trim().is_empty() || flow.trigger.trim().is_empty() {
        return Err(AppError::Validation(
            "Flow name and trigger are required.".to_string(),
        ));
    }
    validate_flow_status(&flow.status)?;
    Ok(doc! {
        "salonId": salon_id,
        "name": flow.name,
        "description": flow.description,
        "trigger": flow.trigger,
        "status": flow.status,
        "nodes": mongodb::bson::to_bson(&flow.nodes).map_err(|_| AppError::Validation("Invalid flow nodes.".to_string()))?,
        "metrics": { "triggered": 0, "completed": 0, "messagesSent": 0, "failed": 0, "stopped": 0 },
        "createdBy": user_id,
        "updatedBy": "",
        "createdAt": DateTime::now(),
        "updatedAt": DateTime::now(),
    })
}

fn flow_nodes(flow: &Document) -> Result<Vec<serde_json::Value>, AppError> {
    Ok(flow
        .get("nodes")
        .cloned()
        .and_then(|value| mongodb::bson::from_bson(value).ok())
        .unwrap_or_else(Vec::new))
}

fn ready_made_flows() -> Vec<ShopifyFlowWrite> {
    vec![
        ready_flow(
            "Abandoned Cart",
            "Three-step abandoned checkout recovery with purchase checks.",
            "checkouts/create",
            vec![
                node("trigger", "trigger", "Checkout Abandoned", serde_json::json!({}), None, None, None),
                node("wait-30", "wait", "Wait 30 minutes", serde_json::json!({ "minutes": 30 }), Some("wa-1"), None, None),
                node("wa-1", "whatsapp_template", "Abandoned Cart #1", serde_json::json!({ "templateName": "abandoned_cart_1", "language": "en" }), Some("wait-6h"), None, None),
                node("wait-6h", "wait", "Wait 6 hours", serde_json::json!({ "minutes": 360 }), Some("order-exists-1"), None, None),
                node("order-exists-1", "condition", "Order exists?", serde_json::json!({ "field": "orderExists", "operator": "equals", "value": true }), None, Some("stop"), Some("wa-2")),
                node("wa-2", "whatsapp_template", "Abandoned Cart #2", serde_json::json!({ "templateName": "abandoned_cart_2", "language": "en" }), Some("wait-18h"), None, None),
                node("wait-18h", "wait", "Wait 18 hours", serde_json::json!({ "minutes": 1080 }), Some("order-exists-2"), None, None),
                node("order-exists-2", "condition", "Order exists?", serde_json::json!({ "field": "orderExists", "operator": "equals", "value": true }), None, Some("stop"), Some("wa-3")),
                node("wa-3", "whatsapp_template", "Abandoned Cart #3", serde_json::json!({ "templateName": "abandoned_cart_3", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Order Confirmation",
            "Send order details when an order is created.",
            "orders/create",
            vec![
                node("trigger", "trigger", "Order Created", serde_json::json!({}), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Order Confirmation", serde_json::json!({ "templateName": "order_confirmation", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Payment Confirmation",
            "Confirm paid Shopify orders.",
            "orders/paid",
            vec![
                node("trigger", "trigger", "Order Paid", serde_json::json!({}), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Payment Confirmation", serde_json::json!({ "templateName": "payment_confirmation", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "COD Confirmation",
            "Branch only for cash-on-delivery orders.",
            "orders/create",
            vec![
                node("trigger", "trigger", "Order Created", serde_json::json!({}), Some("cod"), None, None),
                node("cod", "condition", "Payment method is COD", serde_json::json!({ "field": "paymentMethod", "operator": "contains", "value": "cod" }), None, Some("wa"), Some("stop")),
                node("wa", "whatsapp_template", "COD Confirmation", serde_json::json!({ "templateName": "cod_confirmation", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Order Shipped",
            "Send tracking details when fulfilled.",
            "orders/fulfilled",
            vec![
                node("trigger", "trigger", "Order Fulfilled", serde_json::json!({}), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Shipping Template", serde_json::json!({ "templateName": "order_shipped", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Delivery Follow-up",
            "Draft only; activate after reliable delivered events exist.",
            "orders/fulfilled",
            vec![
                node("trigger", "trigger", "Delivered", serde_json::json!({}), Some("wait"), None, None),
                node("wait", "wait", "Wait 3 days", serde_json::json!({ "minutes": 4320 }), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Delivery Follow-up", serde_json::json!({ "templateName": "delivery_followup", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Review Request",
            "Ask for a review after post-delivery delay.",
            "orders/fulfilled",
            vec![
                node("trigger", "trigger", "Fulfilled", serde_json::json!({}), Some("wait"), None, None),
                node("wait", "wait", "Wait 3 days", serde_json::json!({ "minutes": 4320 }), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Review Request", serde_json::json!({ "templateName": "review_request", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
        ready_flow(
            "Reorder Reminder",
            "Reminder template for repeat purchase audiences.",
            "manual/reorder",
            vec![
                node("trigger", "trigger", "Manual Audience", serde_json::json!({}), Some("wa"), None, None),
                node("wa", "whatsapp_template", "Reorder Reminder", serde_json::json!({ "templateName": "reorder_reminder", "language": "en" }), Some("stop"), None, None),
                node("stop", "stop", "Stop", serde_json::json!({}), None, None, None),
            ],
        ),
    ]
}

fn ready_flow(
    name: &str,
    description: &str,
    trigger: &str,
    nodes: Vec<serde_json::Value>,
) -> ShopifyFlowWrite {
    ShopifyFlowWrite {
        name: name.to_string(),
        description: description.to_string(),
        trigger: trigger.to_string(),
        status: "draft".to_string(),
        nodes,
    }
}

fn node(
    id: &str,
    node_type: &str,
    label: &str,
    config: serde_json::Value,
    next: Option<&str>,
    yes: Option<&str>,
    no: Option<&str>,
) -> serde_json::Value {
    let mut value = serde_json::json!({
        "id": id,
        "type": node_type,
        "label": label,
        "config": config,
    });
    if let Some(next) = next {
        value["next"] = serde_json::json!(next);
    }
    if let Some(yes) = yes {
        value["yes"] = serde_json::json!(yes);
    }
    if let Some(no) = no {
        value["no"] = serde_json::json!(no);
    }
    value
}

fn url_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn shopify_refresh_cookie(
    config: &AppConfig,
    token: &str,
) -> Result<axum::http::HeaderValue, AppError> {
    let max_age = config.refresh_token_ttl_days * 24 * 60 * 60;
    let secure = if config.cookie_secure { "; Secure" } else { "" };
    let cookie = format!(
        "shopifyRefresh={token}; Path=/api/v1/shopify-api/auth; Max-Age={max_age}; HttpOnly; SameSite={}{}",
        config.cookie_samesite, secure
    );
    cookie.parse().map_err(|_| AppError::Internal)
}

fn aura_refresh_cookie(
    config: &AppConfig,
    token: &str,
    clear: bool,
) -> Result<axum::http::HeaderValue, AppError> {
    let max_age = if clear { 0 } else { config.refresh_token_ttl_days * 24 * 60 * 60 };
    let secure = if config.cookie_secure { "; Secure" } else { "" };
    let domain = config
        .cookie_domain
        .as_deref()
        .map(|domain| format!("; Domain={domain}"))
        .unwrap_or_default();
    let cookie = format!(
        "auraRefresh={token}; Path=/api/v1/auth; Max-Age={max_age}; HttpOnly; SameSite={}{}{}",
        config.cookie_samesite, secure, domain
    );
    cookie.parse().map_err(|_| AppError::Internal)
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get("cookie")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value.split(';').find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                (key == name).then(|| value.to_string())
            })
        })
}

fn generate_refresh_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

fn hash_token(value: &str) -> String {
    hex_lower(&Sha256::digest(value.as_bytes()))
}

fn verify_meta_signature(
    config: &AppConfig,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<bool, AppError> {
    let Some(secret) = config
        .meta_webhook_app_secret
        .as_deref()
        .or(config.meta_app_secret.as_deref())
    else {
        return Ok(true);
    };
    let Some(header) = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(config.env == "test");
    };
    let Some(received) = header.strip_prefix("sha256=") else {
        return Ok(false);
    };
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).map_err(|_| AppError::Internal)?;
    mac.update(body);
    Ok(constant_time_equal(
        &hex_lower(&mac.finalize().into_bytes()).into_bytes(),
        received.as_bytes(),
    ))
}

fn verify_shopify_webhook(
    config: &AppConfig,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<bool, AppError> {
    let Some(secret) = config.shopify_api_secret.as_deref() else {
        return Ok(config.env != "production");
    };
    let Some(received) = headers
        .get("x-shopify-hmac-sha256")
        .and_then(|value| value.to_str().ok())
    else {
        return Ok(false);
    };
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).map_err(|_| AppError::Internal)?;
    mac.update(body);
    Ok(constant_time_equal(
        &base64_encode(&mac.finalize().into_bytes()).into_bytes(),
        received.as_bytes(),
    ))
}

fn shopify_topic_allowed(topic: &str) -> bool {
    shopify_topics().contains(&topic)
}

fn shopify_topics() -> &'static [&'static str] {
    &[
        "orders/create",
        "orders/paid",
        "orders/fulfilled",
        "orders/cancelled",
        "checkouts/create",
    ]
}

fn normalize_shopify_context(payload: &serde_json::Value, shop_name: &str) -> serde_json::Value {
    let customer = payload
        .get("customer")
        .or_else(|| payload.get("billing_address"))
        .or_else(|| payload.get("shipping_address"))
        .unwrap_or(&serde_json::Value::Null);
    let phone = normalize_phone(
        customer
            .get("phone")
            .or_else(|| payload.get("phone"))
            .or_else(|| payload.pointer("/shipping_address/phone"))
            .or_else(|| payload.pointer("/billing_address/phone"))
            .and_then(|value| value.as_str())
            .unwrap_or_default(),
    );
    let first = customer
        .get("first_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let last = customer
        .get("last_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let fallback_email = payload
        .get("email")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let customer_name = format!("{first} {last}").trim().to_string();
    let line_item = payload
        .get("line_items")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first());
    serde_json::json!({
        "shopName": shop_name,
        "customerName": if customer_name.is_empty() { fallback_email.to_string() } else { customer_name },
        "phone": phone,
        "email": customer.get("email").and_then(|value| value.as_str()).unwrap_or(fallback_email),
        "customerId": json_string(payload.get("customer_id").or_else(|| customer.get("id"))),
        "orderId": json_string(payload.get("name").or_else(|| payload.get("order_number")).or_else(|| payload.get("id"))),
        "orderTotal": json_string(payload.get("total_price").or_else(|| payload.get("current_total_price")).or_else(|| payload.pointer("/total_price_set/shop_money/amount"))),
        "paymentMethod": json_string(payload.get("payment_gateway_names").or_else(|| payload.get("gateway"))).to_ascii_lowercase(),
        "checkoutId": json_string(payload.get("checkout_id").or_else(|| payload.get("id")).or_else(|| payload.get("token"))),
        "checkoutUrl": payload.get("abandoned_checkout_url").or_else(|| payload.get("web_url")).or_else(|| payload.get("checkout_url")).and_then(|value| value.as_str()).unwrap_or_default(),
        "trackingUrl": payload.pointer("/fulfillments/0/tracking_url").and_then(|value| value.as_str()).unwrap_or_default(),
        "productName": line_item.and_then(|item| item.get("name").or_else(|| item.get("title"))).and_then(|value| value.as_str()).unwrap_or_default(),
        "orderExists": false,
    })
}

fn json_string(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Number(value)) => value.to_string(),
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .map(|value| json_string(Some(value)))
            .collect::<Vec<_>>()
            .join(","),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn base64_url_decode(value: &str) -> Result<Vec<u8>, AppError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::Validation("Invalid encoded value.".to_string()))
}

fn encryption_key(config: &AppConfig) -> [u8; 32] {
    let raw = config
        .meta_credential_encryption_key
        .as_deref()
        .unwrap_or(&config.jwt_refresh_secret);
    let digest = Sha256::digest(raw.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn encrypt_secret(config: &AppConfig, plain_text: &str) -> Result<String, AppError> {
    let key = encryption_key(config);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::Internal)?;
    let mut iv = [0u8; 12];
    OsRng.fill_bytes(&mut iv);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), plain_text.as_bytes())
        .map_err(|_| AppError::Internal)?;
    let split = encrypted.len().checked_sub(16).ok_or(AppError::Internal)?;
    let (cipher_text, tag) = encrypted.split_at(split);
    Ok(format!(
        "v1.{}.{}.{}",
        base64_url_encode(&iv),
        base64_url_encode(tag),
        base64_url_encode(cipher_text)
    ))
}

fn decrypt_secret(config: &AppConfig, value: &str) -> Result<String, AppError> {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != "v1" {
        return Err(AppError::Validation(
            "Unsupported encrypted secret format.".to_string(),
        ));
    }
    let iv = base64_url_decode(parts[1])?;
    let tag = base64_url_decode(parts[2])?;
    let mut encrypted = base64_url_decode(parts[3])?;
    encrypted.extend(tag);
    let key = encryption_key(config);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::Internal)?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&iv), encrypted.as_slice())
        .map_err(|_| AppError::Validation("Unable to decrypt secret.".to_string()))?;
    String::from_utf8(plain)
        .map_err(|_| AppError::Validation("Invalid decrypted secret.".to_string()))
}

#[derive(Clone)]
struct WhatsAppInboundMessage {
    phone_number_id: String,
    wa_phone: String,
    profile_name: String,
    message_id: String,
    text: String,
    timestamp_ms: i64,
    flow_response: serde_json::Value,
    interactive_id: String,
    message_type: String,
}

struct WhatsAppDeliveryStatus {
    provider_message_id: String,
    status: String,
    timestamp_ms: i64,
}

fn extract_whatsapp_message(payload: &serde_json::Value) -> Option<WhatsAppInboundMessage> {
    for entry in payload.get("entry")?.as_array()? {
        if let Some(change) = entry.get("changes")?.as_array()?.iter().next() {
            let value = change.get("value")?;
            let message = value.get("messages")?.as_array()?.first()?;
            let interactive = message.get("interactive");
            let interactive_id = interactive
                .and_then(|item| item.pointer("/button_reply/id"))
                .or_else(|| interactive.and_then(|item| item.pointer("/list_reply/id")))
                .and_then(|item| item.as_str())
                .unwrap_or("");
            let interactive_title = interactive
                .and_then(|item| item.pointer("/button_reply/title"))
                .or_else(|| interactive.and_then(|item| item.pointer("/list_reply/title")))
                .or_else(|| interactive.and_then(|item| item.pointer("/nfm_reply/body")))
                .and_then(|item| item.as_str())
                .unwrap_or("");
            let response_json = interactive
                .and_then(|item| item.pointer("/nfm_reply/response_json"))
                .and_then(|item| item.as_str());
            let flow_response = response_json
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or(serde_json::Value::Null);
            let message_type = message
                .get("type")
                .and_then(|item| item.as_str())
                .unwrap_or("unknown");
            let text = message
                .pointer("/text/body")
                .or_else(|| message.pointer("/image/caption"))
                .or_else(|| message.pointer("/document/caption"))
                .or_else(|| message.pointer("/video/caption"))
                .and_then(|item| item.as_str())
                .unwrap_or(if !interactive_id.is_empty() {
                    interactive_id
                } else {
                    interactive_title
                });
            return Some(WhatsAppInboundMessage {
                phone_number_id: value
                    .pointer("/metadata/phone_number_id")
                    .and_then(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
                wa_phone: message
                    .get("from")
                    .and_then(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
                profile_name: value
                    .get("contacts")
                    .and_then(|item| item.as_array())
                    .and_then(|items| items.first())
                    .and_then(|item| item.pointer("/profile/name"))
                    .and_then(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
                message_id: message
                    .get("id")
                    .and_then(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
                text: if text.is_empty() {
                    format!("[{message_type}]")
                } else {
                    text.to_string()
                },
                timestamp_ms: meta_timestamp_ms(message.get("timestamp")),
                flow_response,
                interactive_id: if !interactive_id.is_empty() {
                    interactive_id
                } else {
                    interactive_title
                }
                .to_string(),
                message_type: message_type.to_string(),
            });
        }
    }
    None
}

fn extract_whatsapp_statuses(payload: &serde_json::Value) -> Vec<WhatsAppDeliveryStatus> {
    let mut statuses = Vec::new();
    for entry in payload
        .get("entry")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        for change in entry
            .get("changes")
            .and_then(|item| item.as_array())
            .into_iter()
            .flatten()
        {
            let Some(items) = change
                .pointer("/value/statuses")
                .and_then(|item| item.as_array())
            else {
                continue;
            };
            for status in items {
                let Some(provider_message_id) = status.get("id").and_then(|item| item.as_str())
                else {
                    continue;
                };
                let Some(value) = status.get("status").and_then(|item| item.as_str()) else {
                    continue;
                };
                statuses.push(WhatsAppDeliveryStatus {
                    provider_message_id: provider_message_id.to_string(),
                    status: value.to_string(),
                    timestamp_ms: meta_timestamp_ms(status.get("timestamp")),
                });
            }
        }
    }
    statuses
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn meta_timestamp_ms(value: Option<&serde_json::Value>) -> i64 {
    value
        .and_then(|item| item.as_str())
        .and_then(|item| item.parse::<i64>().ok())
        .map(|seconds| seconds * 1000)
        .unwrap_or_else(now_millis)
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn team_chat_conversations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let conversations = state.team_chat.conversations(&context).await?;
    Ok(ok(conversations))
}

async fn team_chat_search(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let results = state.team_chat.search(&context, query).await?;
    Ok(ok(results))
}

async fn team_chat_search_in_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let results = state
        .team_chat
        .search_in_conversation(&context, &conversation_id, query)
        .await?;
    Ok(ok(results))
}

async fn team_chat_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let messages = state.team_chat.messages(&context, &conversation_id).await?;
    Ok(ok(messages))
}

async fn team_chat_send_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let message = state
        .team_chat
        .send_message(&context, &conversation_id, request)
        .await?;
    Ok(ok(message))
}

async fn team_chat_update_receipts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
    Json(request): Json<ReceiptRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let receipts = state
        .team_chat
        .update_receipts(&context, &conversation_id, request)
        .await?;
    Ok(ok(receipts))
}

async fn team_chat_private_owner(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.team_chat.private_owner(&context).await?;
    Ok(ok(result))
}

async fn owner_branches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let branches = state.owner.branches(&context).await?;
    Ok(ok(branches))
}

async fn owner_dashboard(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerAppointmentQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let dashboard = state.owner.dashboard(&context, query).await?;
    Ok(ok(dashboard))
}

async fn owner_appointments(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerAppointmentQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let appointments = state.owner.appointments(&context, query).await?;
    Ok(ok(appointments))
}

async fn owner_busy_hours(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<BusyHoursQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.busy_hours(&context, query).await?;
    Ok(ok(result))
}

async fn owner_whatsapp_bot_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SettingsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.whatsapp_bot_settings(&context, query).await?;
    Ok(ok(result))
}

async fn owner_whatsapp_intelligence(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<WhatsAppIntelligenceQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.whatsapp_intelligence(&context, query).await?;
    Ok(ok(result))
}

async fn owner_update_whatsapp_bot_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<BotSettingsUpdate>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .update_whatsapp_bot_settings(&context, request)
        .await?;
    Ok(ok(result))
}

async fn owner_create_appointment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<OwnerAppointmentWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.appointments.owner_create(&context, request).await?;
    Ok(ok(result))
}

async fn owner_appointment_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.appointments.owner_detail(&context, &id).await?;
    Ok(ok(result))
}

async fn owner_update_appointment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<OwnerAppointmentWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .appointments
        .owner_update(&context, &id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_reschedule_appointment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<OwnerAppointmentReschedule>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .appointments
        .owner_reschedule(&context, &id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_appointment_status_response(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    id: &str,
    status: &str,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(state, headers).await?;
    let appointment = state
        .appointments
        .transition_status_current(&context, id, status)
        .await?;
    state
        .finance
        .write_audit(
            &context,
            "appointment.status",
            "appointment",
            id,
            serde_json::json!({ "status": status }),
        )
        .await
        .ok();
    Ok(ok(serde_json::json!({ "appointment": appointment })))
}

async fn owner_appointment_cancel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, "cancelled").await
}

async fn owner_appointment_check_in(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, "arrived").await
}

async fn owner_appointment_start_service(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, "in_service").await
}

async fn owner_appointment_complete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, "completed").await
}

async fn owner_appointment_no_show(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, "no_show").await
}

async fn owner_appointment_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<StatusRequest>,
) -> Result<axum::response::Response, AppError> {
    owner_appointment_status_response(&state, &headers, &id, &request.status).await
}

async fn owner_appointment_branch_options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let branches = state.owner.branches(&context).await?;
    Ok(ok(branches))
}

async fn owner_appointment_client_options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let clients = state.owner.clients(&context, query).await?;
    Ok(ok(clients))
}

async fn owner_appointment_staff_options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let staff = state.owner.staff(&context, query).await?;
    Ok(ok(staff))
}

async fn owner_appointment_service_options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ServiceQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let services = state.catalog.services(&context, query).await?;
    Ok(ok(services))
}

async fn owner_staff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let staff = state.owner.staff(&context, query).await?;
    Ok(ok(staff))
}

async fn owner_people_staff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerStaffQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let staff = state.owner.people_staff(&context, query).await?;
    Ok(ok(staff))
}

async fn owner_people_leaves(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerLeaveQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leaves = state.owner.leaves(&context, query).await?;
    Ok(ok(leaves))
}

async fn owner_people_leave_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(leave_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leave = state.owner.leave_detail(&context, &leave_id).await?;
    Ok(ok(leave))
}

async fn owner_approve_leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(leave_id): Path<String>,
    Json(request): Json<OwnerLeaveDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leave = state
        .owner
        .decide_leave(&context, &leave_id, "approve", request)
        .await?;
    Ok(ok(leave))
}

async fn owner_reject_leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(leave_id): Path<String>,
    Json(request): Json<OwnerLeaveDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let leave = state
        .owner
        .decide_leave(&context, &leave_id, "reject", request)
        .await?;
    Ok(ok(leave))
}

async fn owner_admin_branches(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.catalog.admin_branches(&context).await?;
    Ok(ok(result))
}

async fn owner_admin_create_branch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateBranchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.catalog.admin_create_branch(&context, request).await?;
    Ok(ok(result))
}

async fn owner_admin_update_branch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
    Json(request): Json<UpdateBranchRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .catalog
        .admin_update_branch(&context, &branch_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_admin_update_branch_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
    Json(request): Json<StatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .catalog
        .admin_update_branch_status(&context, &branch_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_admin_services(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ServiceQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.catalog.admin_services(&context, query).await?;
    Ok(ok(result))
}

async fn owner_admin_create_service(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateServiceRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .catalog
        .admin_create_service(&context, request)
        .await?;
    Ok(ok(result))
}

async fn owner_admin_update_service(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(request): Json<UpdateServiceRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .catalog
        .admin_update_service(&context, &service_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_admin_update_service_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(request): Json<StatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .catalog
        .admin_update_service_status(&context, &service_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_admin_access(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.access(&context).await?;
    Ok(ok(result))
}

async fn owner_admin_create_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<OwnerUserWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.create_user(&context, request).await?;
    Ok(ok(result))
}

async fn owner_admin_update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(request): Json<OwnerUserWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.update_user(&context, &user_id, request).await?;
    Ok(ok(result))
}

async fn owner_admin_create_role(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .role_response(
            &context,
            body.get("role").and_then(|v| v.as_str()),
            body.get("branchId").and_then(|v| v.as_str()),
        )
        .await?;
    Ok(ok(result))
}

async fn owner_admin_restore_role_defaults(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(role): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .role_response(
            &context,
            Some(role.as_str()),
            body.get("branchId").and_then(|v| v.as_str()),
        )
        .await?;
    Ok(ok(result))
}

async fn owner_admin_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SettingsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.settings(&context, query).await?;
    Ok(ok(result))
}

async fn owner_admin_update_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let query = SettingsQuery {
        branch_id: body
            .get("branchId")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()),
    };
    let settings = body
        .get("settings")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let result = state
        .owner
        .update_settings(&context, query, SettingsUpdate { settings })
        .await?;
    Ok(ok(result))
}

async fn owner_clients(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let clients = state.owner.clients(&context, query).await?;
    Ok(ok(clients))
}

async fn owner_create_client(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<OwnerClientWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.owner.create_client(&context, request).await?;
    Ok(ok(result))
}

async fn owner_client_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Query(query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .client_detail(&context, &client_id, query)
        .await?;
    Ok(ok(result))
}

async fn owner_update_client(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(request): Json<OwnerClientWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .update_client(&context, &client_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_client_opt_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(request): Json<ClientOptOutRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .opt_out_client(&context, &client_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_inventory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerOperationsCompatQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if !has_permission(&context.permissions, "read:inventory")
        && !has_permission(&context.permissions, "read:operations")
        && !has_permission(&context.permissions, "admin:*")
    {
        return Err(AppError::Authorization);
    }
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.or(query.limit).unwrap_or(30);
    Ok(ok(serde_json::json!({
        "items": [],
        "metrics": { "products": 0, "lowStock": 0, "outOfStock": 0, "reorderCount": 0, "stockValuePaise": 0 },
        "facets": { "categories": [], "suppliers": [] },
        "page": { "page": page, "pageSize": page_size, "total": 0, "totalPages": 0, "hasMore": false },
        "metadata": { "timezone": "Asia/Kolkata", "partial": true, "unavailableSources": ["inventory-store"], "scopeNote": "Inventory catalogue is not configured for this salon yet." }
    })))
}

async fn owner_inventory_product(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(_product_id): Path<String>,
    Query(_query): Query<OwnerListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if !has_permission(&context.permissions, "read:inventory")
        && !has_permission(&context.permissions, "read:operations")
        && !has_permission(&context.permissions, "admin:*")
    {
        return Err(AppError::Authorization);
    }
    Err(AppError::NotFound(
        "Inventory product not found.".to_string(),
    ))
}

async fn owner_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerOperationsCompatQuery>,
) -> Result<axum::response::Response, AppError> {
    let _context = context_from_headers(&state, &headers).await?;
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.or(query.limit).unwrap_or(30);
    Ok(ok(serde_json::json!({
        "items": [],
        "page": { "page": page, "pageSize": page_size, "total": 0, "totalPages": 0, "hasMore": false },
        "metadata": { "timezone": "Asia/Kolkata", "partial": false, "unavailableSources": [], "unreadTotal": 0 }
    })))
}

#[derive(Debug, Deserialize)]
struct OwnerOperationsCompatQuery {
    #[serde(default)]
    page: Option<i64>,
    #[serde(default, rename = "pageSize")]
    page_size: Option<i64>,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct OwnerNotificationReceiptRequest {
    #[serde(default, rename = "read")]
    read: bool,
}

async fn owner_notification_receipt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(notification_id): Path<String>,
    Json(request): Json<OwnerNotificationReceiptRequest>,
) -> Result<axum::response::Response, AppError> {
    let _context = context_from_headers(&state, &headers).await?;
    Ok(ok(serde_json::json!({
        "notificationId": notification_id,
        "isRead": request.read,
        "readAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_notifications_mark_all_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(_body): Json<serde_json::Value>,
) -> Result<axum::response::Response, AppError> {
    let _context = context_from_headers(&state, &headers).await?;
    Ok(ok(serde_json::json!({
        "updated": 0,
        "readAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

#[derive(Debug, Deserialize)]
struct ClientReviewRequest {
    review_url: String,
    #[serde(rename = "message", default)]
    message: Option<String>,
}

async fn owner_client_review_request(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(request): Json<ClientReviewRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    if !solastio_auth::rbac::has_any_permission(
        &context.permissions,
        &[
            "create:clients".to_string(),
            "update:clients".to_string(),
            "admin:*".to_string(),
        ],
    ) {
        return Err(AppError::Authorization);
    }
    let review_url = request.review_url.trim().to_string();
    if review_url.is_empty() {
        return Err(AppError::Validation(
            "A valid review URL is required.".to_string(),
        ));
    }
    if request
        .message
        .as_deref()
        .is_some_and(|message| message.len() > 300)
    {
        return Err(AppError::Validation("Message is too long.".to_string()));
    }
    let customer_id = parse_object_id(&client_id)?;
    let customer = state
        .whatsapp
        .customer_by_id_in_branches(&context.salon_id, &customer_id, &context.branch_ids)
        .await?
        .ok_or_else(|| AppError::NotFound("Client not found.".to_string()))?;
    let phone = customer
        .get_str("normalizedPhone")
        .ok()
        .map(str::to_string)
        .filter(|phone| !phone.is_empty())
        .ok_or_else(|| {
            AppError::Validation("Client does not have a WhatsApp phone number.".to_string())
        })?;
    let message = request
        .message
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!("Thank you for visiting our salon. Please share your review: {review_url}")
        });
    let _row = send_whatsapp_message(
        &state,
        &context.salon_id,
        &phone,
        "utility",
        &message,
        None,
        serde_json::json!({ "source": "review_request", "reviewUrl": review_url }),
    )
    .await?;
    Ok(ok(serde_json::json!({ "id": client_id, "sent": true })))
}

async fn owner_add_client_photo(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(request): Json<ClientPhotoWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .add_client_photo(&context, &client_id, request)
        .await?;
    Ok(ok(result))
}

async fn owner_delete_client_photo(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((client_id, photo_id)): Path<(String, String)>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .owner
        .delete_client_photo(&context, &client_id, &photo_id)
        .await?;
    Ok(ok(result))
}

async fn owner_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SettingsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let settings = state.owner.settings(&context, query).await?;
    Ok(ok(settings))
}

async fn owner_update_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SettingsQuery>,
    Json(body): Json<SettingsUpdate>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let settings = state.owner.update_settings(&context, query, body).await?;
    Ok(ok(settings))
}

async fn finance_invoices(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<InvoiceListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let invoices = state.finance.invoices(&context, query).await?;
    Ok(ok(invoices))
}

async fn finance_invoice_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(invoice_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let invoice = state.finance.invoice_detail(&context, &invoice_id).await?;
    Ok(ok(invoice))
}

async fn finance_record_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(invoice_id): Path<String>,
    Json(request): Json<PaymentRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .record_payment(&context, &invoice_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_record_tip(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(invoice_id): Path<String>,
    Json(request): Json<TipRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .record_tip(&context, &invoice_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_void_invoice(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(invoice_id): Path<String>,
    Json(request): Json<VoidRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .void_invoice(&context, &invoice_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_invoice_from_appointment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .invoice_from_appointment(&context, &appointment_id)
        .await?;
    Ok(ok(result))
}

async fn finance_tax_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let settings = state.finance.tax_settings(&context).await?;
    Ok(ok(settings))
}

async fn finance_update_tax_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<TaxSettingsUpdate>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let settings = state.finance.update_tax_settings(&context, request).await?;
    Ok(ok(settings))
}

async fn finance_expenses(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ExpenseQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let expenses = state.finance.expenses(&context, query).await?;
    Ok(ok(expenses))
}

async fn finance_create_expense(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ExpenseWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let expense = state.finance.create_expense(&context, request).await?;
    Ok(ok(expense))
}

async fn finance_update_expense(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(expense_id): Path<String>,
    Json(request): Json<ExpenseWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let expense = state
        .finance
        .update_expense(&context, &expense_id, request)
        .await?;
    Ok(ok(expense))
}

async fn finance_delete_expense(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(expense_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.delete_expense(&context, &expense_id).await?;
    Ok(ok(result))
}

async fn finance_gst_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<GstReportQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let report = state.finance.gst_report(&context, query).await?;
    Ok(ok(report))
}

async fn finance_purchase_orders(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PurchaseOrderQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.purchase_orders(&context, query).await?;
    Ok(ok(result))
}

async fn finance_create_purchase_order(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PurchaseOrderWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .create_purchase_order(&context, request)
        .await?;
    Ok(ok(result))
}

async fn finance_update_purchase_order_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(purchase_order_id): Path<String>,
    Json(request): Json<PurchaseOrderStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .update_purchase_order_status(&context, &purchase_order_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_gift_cards(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<GiftCardQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.gift_cards(&context, query).await?;
    Ok(ok(result))
}

async fn finance_create_gift_card(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<GiftCardWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.create_gift_card(&context, request).await?;
    Ok(ok(result))
}

async fn finance_update_gift_card_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(gift_card_id): Path<String>,
    Json(request): Json<GiftCardStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .update_gift_card_status(&context, &gift_card_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_redeem_gift_card(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(gift_card_id): Path<String>,
    Json(request): Json<GiftCardRedeemRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .redeem_gift_card(&context, &gift_card_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_bundle_deals(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.bundle_deals(&context).await?;
    Ok(ok(result))
}

async fn finance_create_bundle_deal(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<BundleDealWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.create_bundle_deal(&context, request).await?;
    Ok(ok(result))
}

async fn finance_update_bundle_deal_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(bundle_id): Path<String>,
    Json(request): Json<BundleDealStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .update_bundle_deal_status(&context, &bundle_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_promos(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PromoQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.promos(&context, query).await?;
    Ok(ok(result))
}

async fn finance_create_promo(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PromoWrite>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.create_promo(&context, request).await?;
    Ok(ok(result))
}

async fn finance_promo_redemptions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(promo_id): Path<String>,
    Query(query): Query<PromoRedemptionQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .promo_redemptions(&context, &promo_id, query)
        .await?;
    Ok(ok(result))
}

async fn finance_update_promo_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(promo_id): Path<String>,
    Json(request): Json<PromoStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .update_promo_status(&context, &promo_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_redeem_promo(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PromoRedeemRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.redeem_promo(&context, request).await?;
    Ok(ok(result))
}

async fn finance_generate_payroll_run(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PayrollGenerateRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .generate_payroll_run(&context, request)
        .await?;
    Ok(ok(result))
}

async fn finance_payroll_runs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PayrollRunQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.payroll_runs(&context, query).await?;
    Ok(ok(result))
}

async fn finance_payroll_run(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.payroll_run(&context, &run_id).await?;
    Ok(ok(result))
}

async fn finance_update_payroll_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(request): Json<PayrollStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state
        .finance
        .update_payroll_status(&context, &run_id, request)
        .await?;
    Ok(ok(result))
}

async fn finance_payroll_payslip_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((run_id, staff_id)): Path<(String, String)>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let bytes = state
        .finance
        .payroll_payslip_pdf(&context, &run_id, &staff_id)
        .await?;
    Ok((
        [
            ("content-type", "application/pdf"),
            (
                "content-disposition",
                "attachment; filename=\"payslip.pdf\"",
            ),
        ],
        bytes,
    )
        .into_response())
}

async fn finance_audit_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AuditLogQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let result = state.finance.audit_logs(&context, query).await?;
    Ok(ok(result))
}

async fn finance_audit_logs_export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AuditLogExportQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let csv = state.finance.audit_log_csv(&context, query).await?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let response = axum::http::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            axum::http::header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"audit-logs-{date}.csv\""),
        )
        .body(axum::body::Body::from(csv))
        .map_err(|_| AppError::Internal)?;
    Ok(response)
}

use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerFinanceOverviewQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerFinanceDrilldownQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    source_type: Option<String>,
    #[serde(default)]
    #[serde(alias = "type")]
    drilldown_type: Option<String>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    search: Option<String>,
}

impl OwnerFinanceDrilldownQuery {
    fn type_of(&self) -> String {
        self.drilldown_type
            .clone()
            .or_else(|| self.source_type.clone())
            .or_else(|| self.source.clone())
            .unwrap_or_else(|| "sales".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerReportsQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
    #[serde(default)]
    report_key: Option<String>,
    #[serde(default)]
    format: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerAttendanceListQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    staff_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    search: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
    #[serde(default)]
    page: Option<i64>,
    #[serde(default)]
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerAttendanceCorrectionRequest {
    #[serde(default)]
    clock_out_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerAttendanceResetRequest {
    #[serde(default)]
    manual_minutes: Option<i64>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerStaffStatusRequest {
    status: String,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    version: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerStaffLoginRequest {
    login_id: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    branch_ids: Option<Vec<String>>,
    #[serde(default)]
    send_credentials: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerStaffTransferRequest {
    branch_id: String,
    #[serde(default)]
    effective_from: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerStaffScheduleRequest {
    schedule_date: String,
    start_time: String,
    end_time: String,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerStaffCommissionRequest {
    period: String,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerRealtimeTicketRequest {
    #[serde(default)]
    branch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerShiftSwapDecisionRequest {
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    version: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerShiftSwapListQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
    #[serde(default)]
    page: Option<i64>,
    #[serde(default)]
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerMarketingQuery {
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
    #[serde(default)]
    page: Option<i64>,
    #[serde(default)]
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttVerifyPolicyRequest {
    #[serde(default)]
    allow_face_auth: Option<bool>,
    #[serde(default)]
    allow_rfid: Option<bool>,
    #[serde(default)]
    verify_photo_on_clock_in: Option<bool>,
    #[serde(default)]
    max_clock_in_offset_minutes: Option<i64>,
    #[serde(default)]
    late_after_minutes: Option<i64>,
    #[serde(default)]
    overtime_grace_minutes: Option<i64>,
    #[serde(default)]
    auto_clock_out_enabled: Option<bool>,
    #[serde(default)]
    default_shift_start: Option<String>,
    #[serde(default)]
    default_shift_end: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttVerifyDeviceReviewRequest {
    verdict: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

fn require_owner_scope(context: &solastio_application::auth::RequestContext) -> Result<(), AppError> {
    if context.role == "owner"
        || context.role == "admin"
        || context.permissions.iter().any(|p| p == "admin:*")
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn require_staff_oversight(
    context: &solastio_application::auth::RequestContext,
) -> Result<(), AppError> {
    if context.role == "owner"
        || context.role == "admin"
        || context
            .permissions
            .iter()
            .any(|p| p == "admin:*" || p == "read:staff")
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn resolve_branch_ids(
    context: &solastio_application::auth::RequestContext,
    branch_id: Option<&str>,
) -> Result<Option<Vec<String>>, AppError> {
    let accessible: Vec<String> = context.branch_ids.clone();
    if let Some(requested) = branch_id {
        if accessible.is_empty() || accessible.iter().any(|b| b == requested) {
            return Ok(Some(vec![requested.to_string()]));
        }
        return Err(AppError::Authorization);
    }
    if accessible.is_empty() {
        Ok(None)
    } else {
        Ok(Some(accessible))
    }
}

fn parse_object_id_opt(id: &str) -> Option<ObjectId> {
    ObjectId::parse_str(id).ok()
}

fn ist_millis(day: &str, end_of_day: bool) -> Option<i64> {
    let naive = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let seconds = if end_of_day {
        let end = naive.and_hms_opt(23, 59, 59)?;
        i64::from(end.hour()) * 3600 + i64::from(end.minute()) * 60 + i64::from(end.second())
    } else {
        0
    };
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1)?;
    let days = naive.num_days_from_ce() - epoch.num_days_from_ce();
    let utc_seconds = days as i64 * 86_400 + seconds as i64 - 330 * 60;
    Some(utc_seconds * 1000)
}

fn date_range_bson(from: Option<&str>, to: Option<&str>) -> Option<Document> {
    let gte = ist_millis(from?, false)?;
    let lte = ist_millis(to?, true)?;
    Some(doc! { "$gte": DateTime::from_millis(gte), "$lte": DateTime::from_millis(lte) })
}

fn shift_day(day: &str, delta: i64) -> String {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .ok()
        .and_then(|d| {
            chrono::NaiveDate::from_num_days_from_ce_opt(d.num_days_from_ce() as i32 + delta as i32)
        })
        .map(|d| d.to_string())
        .unwrap_or_else(|| day.to_string())
}

fn default_range(from: Option<&str>, to: Option<&str>) -> (String, String) {
    let now = chrono::Utc::now().date_naive().to_string();
    let to = to.map(str::to_string).unwrap_or_else(|| now.clone());
    let from = from.map(str::to_string).unwrap_or_else(|| shift_day(&now, -30));
    (from, to)
}

fn days_between(start: &str, end: &str) -> Option<i64> {
    let a = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
    let b = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok()?;
    Some((b.num_days_from_ce() - a.num_days_from_ce()) as i64)
}

fn ist_date(millis: i64) -> String {
    let secs = millis.div_euclid(1000);
    let sub_sec = millis.rem_euclid(1000) as u32;
    let naive = chrono::DateTime::from_timestamp(secs, sub_sec * 1_000_000)
        .map(|t| t.naive_utc())
        .unwrap_or_default();
    (naive + chrono::Duration::minutes(330)).format("%Y-%m-%d").to_string()
}

fn doc_str(doc: &Document, key: &str) -> String {
    doc.get_str(key).map(str::to_string).unwrap_or_default()
}

fn doc_id_string(doc: &Document) -> String {
    doc.get_object_id("_id")
        .map(|id| id.to_hex())
        .unwrap_or_default()
}

fn doc_i64(doc: &Document, keys: &[&str]) -> i64 {
    for key in keys {
        if let Some(value) = doc.get(key) {
            if let Some(i) = value.as_i64() {
                return i;
            }
            if let Some(f) = value.as_f64() {
                return f as i64;
            }
        }
    }
    0
}

fn doc_dt_millis(doc: &Document, keys: &[&str]) -> i64 {
    for key in keys {
        if let Ok(dt) = doc.get_datetime(key) {
            return dt.timestamp_millis();
        }
    }
    0
}

fn doc_dt(doc: &Document, key: &str) -> String {
    match doc.get_datetime(key) {
        Ok(dt) => dt.try_to_rfc3339_string().unwrap_or_default(),
        Err(_) => doc_str(doc, key),
    }
}

fn ist_date_of_doc(doc: &Document, keys: &[&str]) -> String {
    let millis = doc_dt_millis(doc, keys);
    if millis == 0 {
        doc_str(doc, "businessDate")
    } else {
        ist_date(millis)
    }
}

fn metric(current: i64, previous: i64) -> serde_json::Value {
    let delta = if previous != 0 {
        ((current - previous) as f64 * 100.0) / previous as f64
    } else if current != 0 {
        100.0
    } else {
        0.0
    };
    serde_json::json!({
        "currentPaise": current,
        "previousPaise": previous,
        "deltaPercent": delta,
        "availability": { "available": true, "reason": serde_json::Value::Null },
    })
}

fn ops_page_json(limit: i64, offset: i64, total: u64) -> serde_json::Value {
    let page_no = offset.div_euclid(limit.max(1)) + 1;
    let total_pages = if total == 0 {
        0
    } else {
        ((total - 1) / limit.max(1) as u64) + 1
    };
    serde_json::json!({
        "page": page_no,
        "pageSize": limit,
        "total": total,
        "totalPages": total_pages,
        "hasMore": (offset as u64 + limit.max(1) as u64) < total,
    })
}

async fn branch_name_map(
    database: &mongodb::Database,
    salon_id: &str,
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(mut cursor) = database
        .collection::<Document>("branches")
        .find(doc! { "salonId": salon_id }, None)
        .await
    {
        while let Ok(true) = cursor.advance().await {
            if let Ok(d) = cursor.deserialize_current() {
                let name = doc_str(&d, "name");
                if name.is_empty() {
                    continue;
                }
                let id = doc_str(&d, "_id");
                if !id.is_empty() {
                    map.insert(id, name);
                } else {
                    let oid = doc_id_string(&d);
                    if !oid.is_empty() {
                        map.insert(oid, name);
                    }
                }
            }
        }
    }
    map
}

async fn staff_maps(
    database: &mongodb::Database,
    salon_id: &str,
) -> Result<HashMap<String, (String, String)>, AppError> {
    let mut map = HashMap::new();
    let mut cursor = database
        .collection::<Document>("users")
        .find(doc! { "salonId": salon_id }, None)
        .await
        .map_err(|_| AppError::Database)?;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let name = doc_str(&d, "name");
        let branch = doc_str(&d, "branchId");
        let id = doc_id_string(&d);
        if !id.is_empty() {
            map.insert(id, (name.clone(), branch.clone()));
        }
        let staff_id = doc_str(&d, "staffId");
        if !staff_id.is_empty() {
            map.insert(staff_id, (name.clone(), branch));
        }
    }
    Ok(map)
}

async fn find_staff_user(
    database: &mongodb::Database,
    salon_id: &str,
    staff_id: &str,
) -> Result<Option<Document>, AppError> {
    let collection = database.collection::<Document>("users");
    if let Some(oid) = parse_object_id_opt(staff_id) {
        if let Some(doc) = collection
            .find_one(
                doc! { "salonId": salon_id, "$or": [doc! { "_id": oid }, doc! { "staffId": staff_id }] },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?
        {
            return Ok(Some(doc));
        }
    }
    collection
        .find_one(
            doc! { "salonId": salon_id, "$or": [doc! { "staffId": staff_id }, doc! { "loginId": staff_id }] },
            None,
        )
        .await
        .map_err(|_| AppError::Database)
}

async fn find_attendance(
    database: &mongodb::Database,
    salon_id: &str,
    id: &ObjectId,
) -> Result<Document, AppError> {
    database
        .collection::<Document>("attendances")
        .find_one(doc! { "_id": id, "salonId": salon_id }, None)
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Attendance record not found.".to_string()))
}

fn ops_envelope(
    items: Vec<serde_json::Value>,
    limit: i64,
    offset: i64,
    total: u64,
    filters: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "items": items,
        "page": ops_page_json(limit, offset, total),
        "metadata": {
            "timezone": "Asia/Kolkata",
            "partial": false,
            "unavailableSources": [],
            "filters": filters,
            "unreadTotal": 0,
        },
    })
}

struct FinanceWindow {
    gross_sales: i64,
    taxes: i64,
    discounts: i64,
    cash_collected: i64,
    outstanding: i64,
    refunds: i64,
    expenses: i64,
    tips: i64,
    invoice_count: i64,
    refund_count: i64,
    expense_count: i64,
    branch_gross: HashMap<String, i64>,
    branch_net: HashMap<String, i64>,
    branch_count: HashMap<String, i64>,
    day_gross: HashMap<String, i64>,
    day_net: HashMap<String, i64>,
    day_paid: HashMap<String, i64>,
    day_tax: HashMap<String, i64>,
    day_count: HashMap<String, i64>,
    day_refunds: HashMap<String, i64>,
    payment_methods: HashMap<String, i64>,
    service_revenue: HashMap<String, (i64, i64)>,
    product_revenue: HashMap<String, (i64, i64)>,
}

impl FinanceWindow {
    fn empty() -> Self {
        FinanceWindow {
            gross_sales: 0,
            taxes: 0,
            discounts: 0,
            cash_collected: 0,
            outstanding: 0,
            refunds: 0,
            expenses: 0,
            tips: 0,
            invoice_count: 0,
            refund_count: 0,
            expense_count: 0,
            branch_gross: HashMap::new(),
            branch_net: HashMap::new(),
            branch_count: HashMap::new(),
            day_gross: HashMap::new(),
            day_net: HashMap::new(),
            day_paid: HashMap::new(),
            day_tax: HashMap::new(),
            day_count: HashMap::new(),
            day_refunds: HashMap::new(),
            payment_methods: HashMap::new(),
            service_revenue: HashMap::new(),
            product_revenue: HashMap::new(),
        }
    }
}

async fn finance_window(
    database: &mongodb::Database,
    salon_id: &str,
    branches: &Option<Vec<String>>,
    from: &str,
    to: &str,
) -> Result<FinanceWindow, AppError> {
    let mut w = FinanceWindow::empty();
    let mut filter = doc! { "salonId": salon_id };
    if let Some(ids) = branches {
        filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(range) = date_range_bson(Some(from), Some(to)) {
        filter.insert("createdAt", range);
    }
    let mut cursor = database
        .collection::<Document>("invoices")
        .find(filter, None)
        .await
        .map_err(|_| AppError::Database)?;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let status = doc_str(&d, "status");
        let voided = status == "void" || status == "refunded" || status == "cancelled";
        let paid = doc_i64(&d, &["paidAmountPaise"]);
        let grand = doc_i64(&d, &["grandTotalPaise"]);
        let tax = doc_i64(&d, &["taxPaise"]);
        let branch = doc_str(&d, "branchId");
        let date = ist_date_of_doc(&d, &["createdAt", "issuedAt"]);
        w.invoice_count += 1;
        if voided {
            w.refunds += paid;
            w.refund_count += 1;
            *w.day_refunds.entry(date).or_insert(0) += paid;
        } else {
            let discounts = doc_i64(&d, &["discountPaise", "discountAmountPaise"]);
            let net = grand - discounts;
            w.gross_sales += grand;
            w.taxes += tax;
            w.discounts += discounts;
            w.cash_collected += paid;
            w.outstanding += doc_i64(&d, &["dueAmountPaise"]);
            *w.branch_gross.entry(branch.clone()).or_insert(0) += grand;
            *w.branch_net.entry(branch.clone()).or_insert(0) += net;
            *w.branch_count.entry(branch.clone()).or_insert(0) += 1;
            *w.day_gross.entry(date.clone()).or_insert(0) += grand;
            *w.day_net.entry(date.clone()).or_insert(0) += net;
            *w.day_paid.entry(date.clone()).or_insert(0) += paid;
            *w.day_tax.entry(date.clone()).or_insert(0) += tax;
            *w.day_count.entry(date.clone()).or_insert(0) += 1;
            if let Ok(payments) = d.get_array("payments") {
                for p in payments {
                    if let Some(pd) = p.as_document() {
                        let method = doc_str(pd, "method");
                        *w.payment_methods
                            .entry(if method.is_empty() {
                                "unknown".to_string()
                            } else {
                                method
                            })
                            .or_insert(0) += doc_i64(pd, &["amountPaise"]);
                    }
                }
            }
            if let Ok(lines_value) = d.get_array("lines") {
                for line in lines_value {
                    if let Some(ld) = line.as_document() {
                        let product_id = doc_str(ld, "productId");
                        let service_id = doc_str(ld, "serviceId");
                        let label = doc_str(ld, "description");
                        if !label.is_empty() {
                            let amount = doc_i64(ld, &["totalPaise"]);
                            if !product_id.is_empty() && service_id.is_empty() {
                                let e = w.product_revenue.entry(label).or_insert((0, 0));
                                e.0 += 1;
                                e.1 += amount;
                            } else {
                                let e = w.service_revenue.entry(label).or_insert((0, 0));
                                e.0 += 1;
                                e.1 += amount;
                            }
                        }
                    }
                }
            }
        }
    }
    let mut exp_filter = doc! { "salonId": salon_id };
    if let Some(ids) = branches {
        exp_filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(range) = date_range_bson(Some(from), Some(to)) {
        exp_filter.insert("createdAt", range);
    }
    let mut cursor = database
        .collection::<Document>("expenses")
        .find(exp_filter, None)
        .await
        .map_err(|_| AppError::Database)?;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        w.expenses += doc_i64(&d, &["totalPaise", "amountPaise"]);
        w.expense_count += 1;
    }
    let mut tip_filter = doc! { "salonId": salon_id };
    if let Some(ids) = branches {
        tip_filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(range) = date_range_bson(Some(from), Some(to)) {
        tip_filter.insert("createdAt", range);
    }
    let mut cursor = database
        .collection::<Document>("tips")
        .find(tip_filter, None)
        .await
        .map_err(|_| AppError::Database)?;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        w.tips += doc_i64(&d, &["amountPaise"]);
    }
    Ok(w)
}

fn csv_cell(value: &serde_json::Value) -> String {
    let s = match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    };
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

fn rows_to_csv(
    columns: &[serde_json::Value],
    rows: &[serde_json::Map<String, serde_json::Value>],
) -> String {
    let keys: Vec<String> = columns
        .iter()
        .filter_map(|c| c.get("key").and_then(|k| k.as_str()))
        .map(str::to_string)
        .collect();
    let mut out = String::new();
    out.push_str(
        &columns
            .iter()
            .filter_map(|c| c.get("label").and_then(|l| l.as_str()))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push('\n');
    for row in rows {
        let cells: Vec<String> = keys
            .iter()
            .map(|key| row.get(key).map(csv_cell).unwrap_or_default())
            .collect();
        out.push_str(&cells.join(","));
        out.push('\n');
    }
    out
}

fn bytes_response(content_type: &str, filename: &str, bytes: Vec<u8>) -> Result<axum::response::Response, AppError> {
    axum::http::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header("content-type", content_type)
        .header(
            "content-disposition",
            format!("attachment; filename=\"{filename}\""),
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|_| AppError::Internal)
        .map(IntoResponse::into_response)
}

fn shift_swap_json(
    doc: &Document,
    names: &HashMap<String, (String, String)>,
) -> serde_json::Value {
    let from_id = doc_str(doc, "fromStaffId");
    let to_id = doc_str(doc, "toStaffId");
    let (from_name, _) = names
        .get(&from_id)
        .cloned()
        .unwrap_or_else(|| (from_id.clone(), String::new()));
    let (to_name, _) = names
        .get(&to_id)
        .cloned()
        .unwrap_or_else(|| (to_id.clone(), String::new()));
    let raw_status = doc_str(doc, "status");
    let status = match raw_status.as_str() {
        "approved" | "rejected" => raw_status,
        _ => "pending".to_string(),
    };
    let created = doc_dt_millis(doc, &["createdAt"]);
    let updated = doc_dt_millis(doc, &["updatedAt"]).max(created);
    let shift_type = doc_str(doc, "shiftType");
    serde_json::json!({
        "id": doc_id_string(doc),
        "branchId": doc_str(doc, "branchId"),
        "scheduleId": doc_str(doc, "scheduleId"),
        "fromStaffId": from_id,
        "toStaffId": to_id,
        "fromStaffName": from_name,
        "toStaffName": to_name,
        "scheduleDate": doc_str(doc, "scheduleDate"),
        "startTime": doc_str(doc, "startTime"),
        "endTime": doc_str(doc, "endTime"),
        "shiftType": if shift_type.is_empty() { "regular".to_string() } else { shift_type },
        "reason": doc_str(doc, "reason"),
        "status": status,
        "targetResponseNote": doc_str(doc, "targetResponseNote"),
        "rejectionReason": doc_str(doc, "rejectionReason"),
        "version": doc_i64(doc, &["version"]).max(1),
        "createdAt": if created > 0 { DateTime::from_millis(created).try_to_rfc3339_string().unwrap_or_default() } else { String::new() },
        "updatedAt": if updated > 0 { DateTime::from_millis(updated).try_to_rfc3339_string().unwrap_or_default() } else { String::new() },
    })
}

async fn owner_finance_overview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerFinanceOverviewQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let (from, to) = default_range(query.from.as_deref(), query.to.as_deref());
    let cur = finance_window(&state.store.database, &context.salon_id, &branches, &from, &to).await?;
    let (prev_from, prev_to) = match days_between(&from, &to) {
        Some(days) => (shift_day(&from, -(days.max(1))), shift_day(&from, -1)),
        None => (from.clone(), from.clone()),
    };
    let prev = finance_window(&state.store.database, &context.salon_id, &branches, &prev_from, &prev_to).await?;
    let net = cur.gross_sales - cur.discounts - cur.refunds;
    let prev_net = (prev.gross_sales - prev.discounts) - prev.refunds;
    let profit = net - cur.expenses;
    let prev_profit = prev_net - prev.expenses;
    let branch_names = branch_name_map(&state.store.database, &context.salon_id).await;
    let mut branch_ids: Vec<String> = cur.branch_gross.keys().cloned().collect();
    branch_ids.sort();
    branch_ids.dedup();
    let branch_comparison: Vec<serde_json::Value> = branch_ids
        .into_iter()
        .map(|id| {
            serde_json::json!({
                "branchId": id,
                "branchName": branch_names.get(&id).cloned().unwrap_or_else(|| id.clone()),
                "grossSalesPaise": cur.branch_gross.get(&id).copied().unwrap_or(0),
                "netRevenuePaise": cur.branch_net.get(&id).copied().unwrap_or(0),
                "invoiceCount": cur.branch_count.get(&id).copied().unwrap_or(0),
            })
        })
        .collect();
    let mut days: Vec<String> = Vec::new();
    let mut day = from.clone();
    while day <= to {
        days.push(day.clone());
        day = shift_day(&day, 1);
    }
    let trend: Vec<serde_json::Value> = days
        .into_iter()
        .map(|date| serde_json::json!({ "date": date, "netRevenuePaise": cur.day_net.get(&date).copied().unwrap_or(0) }))
        .collect();
    let mut methods: Vec<(String, i64)> = cur.payment_methods.iter().map(|(k, v)| (k.clone(), *v)).collect();
    methods.sort_by(|a, b| b.1.cmp(&a.1));
    let method_sum: i64 = methods.iter().map(|(_, v)| v).sum();
    if method_sum < cur.cash_collected {
        methods.push(("other".to_string(), cur.cash_collected - method_sum));
    }
    let payment_methods: Vec<serde_json::Value> = methods
        .into_iter()
        .map(|(method, amount)| serde_json::json!({ "method": method, "amountPaise": amount }))
        .collect();
    let service_revenue: i64 = cur.service_revenue.values().map(|(_, v)| v).sum();
    let product_revenue: i64 = cur.product_revenue.values().map(|(_, v)| v).sum();
    let branch_label = branches
        .as_ref()
        .map(|ids| {
            if ids.len() == 1 {
                ids[0].clone()
            } else {
                "All Branches".to_string()
            }
        })
        .unwrap_or_else(|| "All Branches".to_string());
    let generated_at = DateTime::now().try_to_rfc3339_string().unwrap_or_default();
    Ok(ok(serde_json::json!({
        "context": {
            "branchId": branches.as_ref().map(|ids| ids.join(",")).unwrap_or_default(),
            "branchLabel": branch_label,
            "from": from,
            "to": to,
            "timezone": query.timezone.unwrap_or_else(|| "Asia/Kolkata".to_string()),
            "generatedAt": generated_at,
            "currency": "INR",
            "availableBranches": branches.clone().unwrap_or_default(),
        },
        "kpis": {
            "grossSales": metric(cur.gross_sales, prev.gross_sales),
            "netRevenue": metric(net, prev_net),
            "cashCollected": metric(cur.cash_collected, prev.cash_collected),
            "outstanding": metric(cur.outstanding, prev.outstanding),
            "refunds": metric(cur.refunds, prev.refunds),
            "expenses": metric(cur.expenses, prev.expenses),
            "taxes": metric(cur.taxes, prev.taxes),
            "discounts": metric(cur.discounts, prev.discounts),
            "profit": metric(profit, prev_profit),
            "tips": metric(cur.tips, prev.tips),
        },
        "trend": trend,
        "paymentMethods": payment_methods,
        "breakdown": {
            "grossSalesPaise": cur.gross_sales,
            "discountsPaise": cur.discounts,
            "taxesPaise": cur.taxes,
            "netRevenuePaise": net,
            "cashCollectedPaise": cur.cash_collected,
            "outstandingPaise": cur.outstanding,
            "refundsPaise": cur.refunds,
            "expensesPaise": cur.expenses,
            "creditNotesPaise": 0,
            "serviceRevenuePaise": service_revenue,
            "productRevenuePaise": product_revenue,
            "membershipRevenuePaise": 0,
            "packageRevenuePaise": 0,
        },
        "branchComparison": branch_comparison,
        "drilldowns": {
            "sales": { "count": cur.invoice_count, "totalPaise": cur.gross_sales, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=sales" },
            "payments": { "count": cur.invoice_count, "totalPaise": cur.cash_collected, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=payments" },
            "outstanding": { "count": cur.invoice_count, "totalPaise": cur.outstanding, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=outstanding" },
            "refunds": { "count": cur.refund_count, "totalPaise": cur.refunds, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=refunds" },
            "expenses": { "count": cur.expense_count, "totalPaise": cur.expenses, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=expenses" },
            "creditNotes": { "count": 0, "totalPaise": 0, "dataUrl": "/api/v1/owner-console/finance/drilldown?type=creditNotes" },
        },
    })))
}

async fn owner_finance_drilldown(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerFinanceDrilldownQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let (from, to) = default_range(query.from.as_deref(), query.to.as_deref());
    let drilldown = query.type_of();
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let offset = query.offset.unwrap_or(0).max(0);
    let database = &state.store.database;
    let mut filter = doc! { "salonId": &context.salon_id };
    if let Some(ids) = &branches {
        filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(range) = date_range_bson(Some(from.as_str()), Some(to.as_str())) {
        if drilldown == "expenses" {
            filter.insert("createdAt", range);
        } else {
            filter.insert("createdAt", range);
        }
    }
    let mut summary = serde_json::json!({ "totalCount": 0, "totalPaise": 0 });
    if drilldown == "expenses" {
        let total = database
            .collection::<Document>("expenses")
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(offset as u64)
            .limit(limit)
            .build();
        let mut cursor = database
            .collection::<Document>("expenses")
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        let mut total_paise = 0i64;
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
            let amount = doc_i64(&d, &["totalPaise", "amountPaise"]);
            total_paise += amount;
            items.push(serde_json::json!({
                "id": doc_id_string(&d),
                "branchId": doc_str(&d, "branchId"),
                "date": doc_str(&d, "date"),
                "category": doc_str(&d, "category"),
                "vendor": doc_str(&d, "vendor"),
                "description": doc_str(&d, "description"),
                "amountPaise": amount,
                "taxPaise": doc_i64(&d, &["taxPaise"]),
                "totalPaise": amount,
                "notes": doc_str(&d, "notes"),
                "createdAt": doc_dt(&d, "createdAt"),
            }));
        }
        summary = serde_json::json!({ "totalCount": total, "totalPaise": total_paise });
        return Ok(ok(serde_json::json!({
            "type": drilldown,
            "from": from,
            "to": to,
            "items": items,
            "page": ops_page_json(limit, offset, total),
            "summary": summary,
        })));
    }
    if drilldown == "creditNotes" {
        return Ok(ok(serde_json::json!({
            "type": drilldown,
            "from": from,
            "to": to,
            "items": [],
            "page": ops_page_json(limit, offset, 0),
            "summary": { "totalCount": 0, "totalPaise": 0 },
        })));
    }
    match phase_invoice_filter(&mut filter, &drilldown) {
        Ok(()) => {}
        Err(e) => return Err(e),
    }
    let total = database
        .collection::<Document>("invoices")
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "createdAt": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = database
        .collection::<Document>("invoices")
        .find(filter, options)
        .await
        .map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    let mut total_paise = 0i64;
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let grand = doc_i64(&d, &["grandTotalPaise"]);
        let paid = doc_i64(&d, &["paidAmountPaise"]);
        if drilldown == "payments" {
            if let Ok(payments) = d.get_array("payments") {
                for p in payments {
                    if let Some(pd) = p.as_document() {
                        let amount = doc_i64(pd, &["amountPaise"]);
                        total_paise += amount;
                        items.push(serde_json::json!({
                            "id": format!("{}:{}", doc_id_string(&d), doc_str(pd, "method")),
                            "invoiceId": doc_id_string(&d),
                            "invoiceNumber": doc_str(&d, "invoiceNumber"),
                            "method": doc_str(pd, "method"),
                            "amountPaise": amount,
                            "receivedAt": doc_dt(pd, "receivedAt"),
                            "branchId": doc_str(&d, "branchId"),
                            "customerName": doc_str(&d, "customerName"),
                        }));
                    }
                }
            }
        } else {
            total_paise += if drilldown == "refunds" { paid } else { grand };
            items.push(serde_json::json!({
                "id": doc_id_string(&d),
                "invoiceId": doc_id_string(&d),
                "invoiceNumber": doc_str(&d, "invoiceNumber"),
                "date": ist_date_of_doc(&d, &["createdAt", "issuedAt"]),
                "branchId": doc_str(&d, "branchId"),
                "customerId": doc_str(&d, "customerId"),
                "customerName": doc_str(&d, "customerName"),
                "amountPaise": grand,
                "paidPaise": paid,
                "duePaise": doc_i64(&d, &["dueAmountPaise"]),
                "status": doc_str(&d, "status"),
                "paymentStatus": doc_str(&d, "paymentStatus"),
            }));
        }
    }
    Ok(ok(serde_json::json!({
        "type": drilldown,
        "from": from,
        "to": to,
        "items": items,
        "page": ops_page_json(limit, offset, total),
        "summary": { "totalCount": total, "totalPaise": total_paise },
    })))
}

fn phase_invoice_filter(filter: &mut Document, drilldown: &str) -> Result<(), AppError> {
    match drilldown {
        "sales" => {
            filter.insert("status", doc! { "$ne": "void" });
        }
        "payments" => {
            filter.insert("paidAmountPaise", doc! { "$gt": 0 });
        }
        "outstanding" => {
            filter.insert("status", doc! { "$ne": "void" });
            filter.insert("dueAmountPaise", doc! { "$gt": 0 });
        }
        "refunds" => {
            filter.insert("status", doc! { "$in": ["void", "refunded", "cancelled"] });
        }
        _ => return Err(AppError::NotFound("Unknown drilldown type.".to_string())),
    }
    Ok(())
}

fn report_column(key: &str, label: &str, column_type: &str) -> serde_json::Value {
    serde_json::json!({
        "key": key,
        "label": label,
        "type": column_type,
        "sortable": true,
    })
}

async fn invoice_docs(
    database: &mongodb::Database,
    salon_id: &str,
    branches: &Option<Vec<String>>,
    from: &str,
    to: &str,
) -> Result<Vec<Document>, AppError> {
    let mut filter = doc! { "salonId": salon_id };
    if let Some(ids) = branches {
        filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(range) = date_range_bson(Some(from), Some(to)) {
        filter.insert("createdAt", range);
    }
    let mut cursor = database
        .collection::<Document>("invoices")
        .find(filter, None)
        .await
        .map_err(|_| AppError::Database)?;
    let mut docs = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        docs.push(cursor.deserialize_current().map_err(|_| AppError::Database)?);
    }
    Ok(docs)
}

fn share_pct(value: i64, total: i64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((value as f64 * 100.0) / total as f64 * 10.0).round() / 10.0
    }
}

async fn build_report(
    database: &mongodb::Database,
    salon_id: &str,
    branches: &Option<Vec<String>>,
    from: &str,
    to: &str,
    key: &str,
) -> Result<Option<(String, Vec<serde_json::Value>, Vec<serde_json::Map<String, serde_json::Value>>, i64)>, AppError> {
    let window = finance_window(database, salon_id, branches, from, to).await?;
    let mut days: Vec<String> = Vec::new();
    let mut day = from.to_string();
    while day <= to.to_string() {
        days.push(day.clone());
        day = shift_day(&day, 1);
    }
    let total_sales = window.gross_sales;
    match key {
        "daily-sales" => {
            let columns = vec![
                report_column("date", "Date", "date"),
                report_column("invoiceCount", "Invoices", "number"),
                report_column("grossSalesPaise", "Gross Sales", "money"),
                report_column("discountsPaise", "Discounts", "money"),
                report_column("taxesPaise", "Taxes", "money"),
                report_column("netRevenuePaise", "Net Revenue", "money"),
                report_column("cashCollectedPaise", "Cash Collected", "money"),
                report_column("refundsPaise", "Refunds", "money"),
                report_column("outstandingPaise", "Outstanding", "money"),
            ];
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = days
                .into_iter()
                .map(|date| {
                    let count = window.day_count.get(&date).copied().unwrap_or(0);
                    let gross = window.day_gross.get(&date).copied().unwrap_or(0);
                    let paid = window.day_paid.get(&date).copied().unwrap_or(0);
                    let refunds = window.day_refunds.get(&date).copied().unwrap_or(0);
                    let net = window.day_net.get(&date).copied().unwrap_or(0);
                    let tax = window.day_tax.get(&date).copied().unwrap_or(0);
                    let outstanding = (gross - paid - refunds).max(0);
                    serde_json::json!({
                        "date": date,
                        "invoiceCount": count,
                        "grossSalesPaise": gross,
                        "discountsPaise": 0,
                        "taxesPaise": tax,
                        "netRevenuePaise": net,
                        "cashCollectedPaise": paid,
                        "refundsPaise": refunds,
                        "outstandingPaise": outstanding,
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default()
                })
                .collect();
            Ok(Some(("Daily Sales Report".to_string(), columns, rows, total_sales)))
        }
        "revenue-by-service" => {
            let columns = vec![
                report_column("service", "Service", "text"),
                report_column("itemsSold", "Items Sold", "number"),
                report_column("revenuePaise", "Revenue", "money"),
                report_column("shareOfTotalPct", "Share %", "number"),
            ];
            let mut services: Vec<(String, (i64, i64))> = window
                .service_revenue
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect();
            services.sort_by(|a, b| (b.1).1.cmp(&(a.1).1));
            let service_total: i64 = services.iter().map(|(_, v)| v.1).sum();
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = services
                .into_iter()
                .map(|(name, (count, amount))| {
                    serde_json::json!({
                        "service": name,
                        "itemsSold": count,
                        "revenuePaise": amount,
                        "shareOfTotalPct": share_pct(amount, service_total),
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default()
                })
                .collect();
            Ok(Some(("Revenue by Service".to_string(), columns, rows, service_total)))
        }
        "revenue-by-staff" => {
            let columns = vec![
                report_column("staffName", "Staff", "text"),
                report_column("staffId", "Staff ID", "text"),
                report_column("appointmentCount", "Appointments", "number"),
                report_column("revenuePaise", "Revenue", "money"),
                report_column("shareOfTotalPct", "Share %", "number"),
            ];
            let mut appt_staff: HashMap<String, String> = HashMap::new();
            {
                let mut a_filter = doc! { "salonId": salon_id };
                if let Some(range) = date_range_bson(Some(from), Some(to)) {
                    a_filter.insert("startAt", range);
                }
                let mut cursor = database
                    .collection::<Document>("appointments")
                    .find(a_filter, None)
                    .await
                    .map_err(|_| AppError::Database)?;
                while cursor.advance().await.map_err(|_| AppError::Database)? {
                    let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
                    appt_staff.insert(doc_id_string(&d), doc_str(&d, "staffId"));
                }
            }
            let names = staff_maps(database, salon_id).await?;
            let mut staff_sales: HashMap<String, (i64, i64)> = HashMap::new();
            for d in invoice_docs(database, salon_id, branches, from, to).await? {
                let status = doc_str(&d, "status");
                if status == "void" || status == "refunded" || status == "cancelled" {
                    continue;
                }
                let appointment_id = doc_str(&d, "appointmentId");
                if let Some(staff_id) = appt_staff.get(&appointment_id) {
                    let e = staff_sales.entry(staff_id.clone()).or_insert((0, 0));
                    e.0 += 1;
                    e.1 += doc_i64(&d, &["grandTotalPaise"]);
                }
            }
            let staff_total: i64 = staff_sales.values().map(|(_, v)| v).sum();
            let mut staff_rows: Vec<(String, String)> = staff_sales
                .keys()
                .map(|id| (id.clone(), names.get(id).map(|(n, _)| n.clone()).unwrap_or_else(|| id.clone())))
                .collect();
            staff_rows.sort_by(|a, b| b.0.cmp(&a.0));
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = staff_rows
                .into_iter()
                .map(|(id, name)| {
                    let (count, amount) = staff_sales.get(&id).copied().unwrap_or((0, 0));
                    serde_json::json!({
                        "staffName": name,
                        "staffId": id,
                        "appointmentCount": count,
                        "revenuePaise": amount,
                        "shareOfTotalPct": share_pct(amount, staff_total),
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default()
                })
                .collect();
            Ok(Some(("Revenue by Staff".to_string(), columns, rows, staff_total)))
        }
        "payment-mix" => {
            let columns = vec![
                report_column("method", "Payment Method", "text"),
                report_column("amountPaise", "Amount", "money"),
                report_column("shareOfTotalPct", "Share %", "number"),
            ];
            let mut methods: Vec<(String, i64)> = window.payment_methods.iter().map(|(k, v)| (k.clone(), *v)).collect();
            methods.sort_by(|a, b| b.1.cmp(&a.1));
            let method_total: i64 = methods.iter().map(|(_, v)| v).sum();
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = methods
                .into_iter()
                .map(|(method, amount)| {
                    serde_json::json!({
                        "method": method,
                        "amountPaise": amount,
                        "shareOfTotalPct": share_pct(amount, method_total),
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default()
                })
                .collect();
            Ok(Some(("Payment Mix Report".to_string(), columns, rows, method_total)))
        }
        "tax-summary" => {
            let columns = vec![
                report_column("date", "Date", "date"),
                report_column("invoiceNumber", "Invoice", "text"),
                report_column("customerName", "Customer", "text"),
                report_column("taxablePaise", "Taxable", "money"),
                report_column("taxPaise", "Tax", "money"),
                report_column("totalPaise", "Total", "money"),
            ];
            let mut tax_total = 0i64;
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = invoice_docs(database, salon_id, branches, from, to)
                .await?
                .into_iter()
                .filter(|d| {
                    let status = doc_str(d, "status");
                    status != "void" && status != "refunded" && status != "cancelled"
                })
                .filter_map(|d| {
                    let tax = doc_i64(&d, &["taxPaise"]);
                    if tax <= 0 {
                        None
                    } else {
                        tax_total += tax;
                        Some(
                            serde_json::json!({
                                "date": ist_date_of_doc(&d, &["createdAt", "issuedAt"]),
                                "invoiceNumber": doc_str(&d, "invoiceNumber"),
                                "customerName": doc_str(&d, "customerName"),
                                "taxablePaise": doc_i64(&d, &["subtotalPaise"]),
                                "taxPaise": tax,
                                "totalPaise": doc_i64(&d, &["grandTotalPaise"]),
                            })
                            .as_object()
                            .cloned()
                            .unwrap_or_default(),
                        )
                    }
                })
                .collect();
            Ok(Some(("Tax Summary".to_string(), columns, rows, tax_total)))
        }
        "expense-summary" => {
            let columns = vec![
                report_column("date", "Date", "date"),
                report_column("category", "Category", "text"),
                report_column("vendor", "Vendor", "text"),
                report_column("description", "Description", "text"),
                report_column("amountPaise", "Amount", "money"),
                report_column("taxPaise", "Tax", "money"),
                report_column("totalPaise", "Total", "money"),
            ];
            let mut rows = Vec::new();
            let mut expense_total = 0i64;
            let mut filter = doc! { "salonId": salon_id };
            if let Some(ids) = branches {
                filter.insert("branchId", doc! { "$in": ids });
            }
            if let Some(range) = date_range_bson(Some(from), Some(to)) {
                filter.insert("createdAt", range);
            }
            let mut cursor = database
                .collection::<Document>("expenses")
                .find(filter, None)
                .await
                .map_err(|_| AppError::Database)?;
            while cursor.advance().await.map_err(|_| AppError::Database)? {
                let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
                let amount = doc_i64(&d, &["totalPaise", "amountPaise"]);
                expense_total += amount;
                rows.push(
                    serde_json::json!({
                        "date": doc_str(&d, "date"),
                        "category": doc_str(&d, "category"),
                        "vendor": doc_str(&d, "vendor"),
                        "description": doc_str(&d, "description"),
                        "amountPaise": amount,
                        "taxPaise": doc_i64(&d, &["taxPaise"]),
                        "totalPaise": amount,
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
                );
            }
            Ok(Some(("Expense Summary".to_string(), columns, rows, expense_total)))
        }
        "product-sales" => {
            let columns = vec![
                report_column("product", "Product", "text"),
                report_column("unitsSold", "Units Sold", "number"),
                report_column("revenuePaise", "Revenue", "money"),
                report_column("shareOfTotalPct", "Share %", "number"),
            ];
            let mut products: Vec<(String, (i64, i64))> = window
                .product_revenue
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect();
            products.sort_by(|a, b| (b.1).1.cmp(&(a.1).1));
            let product_total: i64 = products.iter().map(|(_, v)| v.1).sum();
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = products
                .into_iter()
                .map(|(name, (count, amount))| {
                    serde_json::json!({
                        "product": name,
                        "unitsSold": count,
                        "revenuePaise": amount,
                        "shareOfTotalPct": share_pct(amount, product_total),
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default()
                })
                .collect();
            Ok(Some(("Product Sales Report".to_string(), columns, rows, product_total)))
        }
        "client-history" => {
            let columns = vec![
                report_column("clientId", "Client ID", "text"),
                report_column("clientName", "Client", "text"),
                report_column("visitCount", "Visits", "number"),
                report_column("grossPaise", "Gross Sales", "money"),
                report_column("paidPaise", "Paid", "money"),
                report_column("outstandingPaise", "Outstanding", "money"),
                report_column("lastVisit", "Last Visit", "date"),
            ];
            let mut clients: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for d in invoice_docs(database, salon_id, branches, from, to).await? {
                let status = doc_str(&d, "status");
                if status == "void" || status == "refunded" || status == "cancelled" {
                    continue;
                }
                let id = {
                    let raw = doc_str(&d, "customerId");
                    if raw.is_empty() {
                        "walk-in".to_string()
                    } else {
                        raw
                    }
                };
                let entry = clients.entry(id.clone()).or_insert_with(|| {
                    serde_json::json!({
                        "clientId": id.clone(),
                        "clientName": doc_str(&d, "customerName"),
                        "visitCount": 0,
                        "grossPaise": 0,
                        "paidPaise": 0,
                        "outstandingPaise": 0,
                        "lastVisit": "",
                    })
                });
                let name = doc_str(&d, "customerName");
                entry["clientName"] = serde_json::Value::String(if name.is_empty() {
                    entry["clientName"].as_str().unwrap_or_default().to_string()
                } else {
                    name
                });
                entry["visitCount"] = serde_json::Value::Number(
                    (entry["visitCount"].as_i64().unwrap_or(0) + 1).into(),
                );
                entry["grossPaise"] = serde_json::Value::Number(
                    (entry["grossPaise"].as_i64().unwrap_or(0) + doc_i64(&d, &["grandTotalPaise"])).into(),
                );
                entry["paidPaise"] = serde_json::Value::Number(
                    (entry["paidPaise"].as_i64().unwrap_or(0) + doc_i64(&d, &["paidAmountPaise"])).into(),
                );
                entry["outstandingPaise"] = serde_json::Value::Number(
                    (entry["outstandingPaise"].as_i64().unwrap_or(0) + doc_i64(&d, &["dueAmountPaise"])).into(),
                );
                let date = ist_date_of_doc(&d, &["createdAt", "issuedAt"]);
                if date > entry["lastVisit"].as_str().unwrap_or_default().to_string() {
                    entry["lastVisit"] = serde_json::Value::String(date);
                }
            }
            let mut rows: Vec<serde_json::Map<String, serde_json::Value>> = clients
                .into_values()
                .map(|v| v.as_object().cloned().unwrap_or_default())
                .collect();
            rows.sort_by(|a, b| {
                b.get("grossPaise")
                    .and_then(|v| v.as_i64())
                    .cmp(&a.get("grossPaise").and_then(|v| v.as_i64()))
            });
            let client_total: i64 = rows.iter().map(|r| r.get("grossPaise").and_then(|v| v.as_i64()).unwrap_or(0)).sum();
            Ok(Some(("Client History Report".to_string(), columns, rows, client_total)))
        }
        "walkin-vs-booking" => {
            let columns = vec![
                report_column("channel", "Channel", "text"),
                report_column("invoiceCount", "Invoices", "number"),
                report_column("grossSalesPaise", "Gross Sales", "money"),
                report_column("collectedPaise", "Collected", "money"),
                report_column("shareOfTotalPct", "Share %", "number"),
            ];
            let mut bookings = (0i64, 0i64, 0i64);
            let mut walkins = (0i64, 0i64, 0i64);
            for d in invoice_docs(database, salon_id, branches, from, to).await? {
                let status = doc_str(&d, "status");
                if status == "void" || status == "refunded" || status == "cancelled" {
                    continue;
                }
                let grand = doc_i64(&d, &["grandTotalPaise"]);
                let paid = doc_i64(&d, &["paidAmountPaise"]);
                if doc_str(&d, "appointmentId").is_empty() {
                    walkins.0 += 1;
                    walkins.1 += grand;
                    walkins.2 += paid;
                } else {
                    bookings.0 += 1;
                    bookings.1 += grand;
                    bookings.2 += paid;
                }
            }
            let total = bookings.1 + walkins.1;
            let rows: Vec<serde_json::Map<String, serde_json::Value>> = vec![
                serde_json::json!({
                    "channel": "Booking",
                    "invoiceCount": bookings.0,
                    "grossSalesPaise": bookings.1,
                    "collectedPaise": bookings.2,
                    "shareOfTotalPct": share_pct(bookings.1, total),
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
                serde_json::json!({
                    "channel": "Walk-in",
                    "invoiceCount": walkins.0,
                    "grossSalesPaise": walkins.1,
                    "collectedPaise": walkins.2,
                    "shareOfTotalPct": share_pct(walkins.1, total),
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
            ];
            Ok(Some(("Walk-in vs Booking".to_string(), columns, rows, total)))
        }
        _ => Ok(None),
    }
}

async fn owner_report_run(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(report_key): Path<String>,
    Query(query): Query<OwnerReportsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let (from, to) = default_range(query.from.as_deref(), query.to.as_deref());
    let report = build_report(
        &state.store.database,
        &context.salon_id,
        &branches,
        &from,
        &to,
        &report_key,
    )
    .await?;
    let (title, columns, rows, total_sales) =
        report.ok_or_else(|| AppError::NotFound("Unknown report key.".to_string()))?;
    Ok(ok(serde_json::json!({
        "reportKey": report_key,
        "title": title,
        "generatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
        "timezone": "Asia/Kolkata",
        "filters": {
            "branchIds": branches.clone().unwrap_or_default(),
            "from": from,
            "to": to,
            "reportKey": report_key,
        },
        "columns": columns,
        "rows": rows,
        "summary": { "totalRows": rows.len(), "totalSalesPaise": total_sales },
        "meta": {
            "paginationAvailable": false,
            "exportFormats": ["csv", "xlsx", "pdf"],
        },
    })))
}

async fn owner_reports_catalogue(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(_query): Query<OwnerReportsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let catalogue = vec![
        serde_json::json!({ "id": "daily-sales", "title": "Daily Sales Report", "description": "Sales, collections and outstanding by business day.", "category": "finance", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "revenue-by-service", "title": "Revenue by Service", "description": "Revenue and item count grouped by service.", "category": "finance", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "revenue-by-staff", "title": "Revenue by Staff", "description": "Sales attributed to each staff member via appointments.", "category": "people", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "payment-mix", "title": "Payment Mix Report", "description": "Breakdown of collections by payment method.", "category": "finance", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "tax-summary", "title": "Tax Summary", "description": "Taxable value and tax collected per invoice.", "category": "finance", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "expense-summary", "title": "Expense Summary", "description": "All expenses with category and vendor.", "category": "finance", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "product-sales", "title": "Product Sales Report", "description": "Revenue from product (retail) line items.", "category": "inventory", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "client-history", "title": "Client History Report", "description": "Lifetime summary per client including visits and spend.", "category": "clients", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
        serde_json::json!({ "id": "walkin-vs-booking", "title": "Walk-in vs Booking", "description": "Compares invoices from appointments with walk-in invoices.", "category": "operations", "formats": ["csv", "xlsx", "pdf"], "defaultDateRange": "last_30_days", "params": ["branchId", "from", "to"], "available": true }),
    ];
    Ok(ok(catalogue))
}

async fn owner_report_export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerReportsQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let report_key = query
        .report_key
        .clone()
        .unwrap_or_else(|| "daily-sales".to_string());
    let format = query.format.clone().unwrap_or_else(|| "csv".to_string());
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let (from, to) = default_range(query.from.as_deref(), query.to.as_deref());
    let report = build_report(
        &state.store.database,
        &context.salon_id,
        &branches,
        &from,
        &to,
        &report_key,
    )
    .await?;
    let (_title, columns, rows, _total) =
        report.ok_or_else(|| AppError::NotFound("Unknown report key.".to_string()))?;
    let csv = rows_to_csv(&columns, &rows);
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let slug = report_key.replace(' ', "-");
    let filename = format!("{slug}-{date}.{format}");
    match format.as_str() {
        "xlsx" => bytes_response(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            &filename,
            csv.into_bytes(),
        ),
        "pdf" => bytes_response("application/pdf", &filename, csv.into_bytes()),
        _ => bytes_response("text/csv; charset=utf-8", &filename, csv.into_bytes()),
    }
}

async fn owner_attendance_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerAttendanceListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let limit = query
        .limit
        .or(query.page_size)
        .unwrap_or(50)
        .clamp(1, 200);
    let offset = query.offset.map(|o| o.max(0)).unwrap_or_else(|| {
        (query.page.unwrap_or(1).max(1) - 1) * limit
    });
    let staff = staff_maps(&state.store.database, &context.salon_id).await?;
    let branch_names = branch_name_map(&state.store.database, &context.salon_id).await;
    let mut filter = doc! { "salonId": &context.salon_id };
    let mut date_criteria = Document::new();
    if let Some(from) = query.from.as_deref().filter(|s| !s.is_empty()) {
        date_criteria.insert("$gte", from);
    }
    if let Some(to) = query.to.as_deref().filter(|s| !s.is_empty()) {
        date_criteria.insert("$lte", to);
    }
    if !date_criteria.is_empty() {
        filter.insert("businessDate", date_criteria);
    }
    let mut scoped_staff_ids: Vec<String> = Vec::new();
    if let Some(ids) = &branches {
        for (staff_id, (_, branch)) in &staff {
            if ids.iter().any(|b| b == branch) {
                scoped_staff_ids.push(staff_id.clone());
            }
        }
        scoped_staff_ids.sort();
        scoped_staff_ids.dedup();
        if scoped_staff_ids.is_empty() {
            let filters = serde_json::json!({
                "branchId": query.branch_id,
                "from": query.from,
                "to": query.to,
                "staffId": query.staff_id,
                "status": query.status,
                "search": query.search,
            });
            return Ok(ok(ops_envelope(Vec::new(), limit, offset, 0, filters)));
        }
        filter.insert("staffId", doc! { "$in": scoped_staff_ids });
    }
    if let Some(staff_id) = query.staff_id.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("staffId", staff_id);
    }
    let collection = state.store.database.collection::<Document>("attendances");
    let total = collection
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "businessDate": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = collection.find(filter, options).await.map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let staff_id = doc_str(&d, "staffId");
        let (staff_name, staff_branch) = staff
            .get(&staff_id)
            .cloned()
            .unwrap_or_else(|| (staff_id.clone(), String::new()));
        let branch_id = doc_str(&d, "branchId");
        let branch_id = if branch_id.is_empty() {
            staff_branch
        } else {
            branch_id
        };
        let clock_in = doc_dt(&d, "clockInAt");
        let clock_out = doc_dt(&d, "clockOutAt");
        let missing_clock_out = !clock_in.is_empty() && clock_out.is_empty();
        let derived_status = if missing_clock_out {
            "ongoing"
        } else if !clock_in.is_empty() && !clock_out.is_empty() {
            "completed"
        } else {
            "absent"
        };
        let doc_status = doc_str(&d, "status");
        let derived_status_string = derived_status.to_string();
        let attendance_status = if doc_status.is_empty() {
            derived_status_string
        } else {
            doc_status
        };
        let source = doc_str(&d, "source");
        let source = if source.is_empty() {
            "manual".to_string()
        } else {
            source
        };
        let clock_in_millis = doc_dt_millis(&d, &["clockInAt"]);
        let clock_out_millis = doc_dt_millis(&d, &["clockOutAt"]);
        let worked = if clock_in_millis > 0 && clock_out_millis > clock_in_millis {
            (clock_out_millis - clock_in_millis) / 60000
        } else {
            0
        };
        let worked_minutes = doc_i64(&d, &["netMinutes", "workedMinutes"]).max(worked);
        let status_field = attendance_status.clone();
        items.push(serde_json::json!({
            "id": doc_id_string(&d),
            "branchId": branch_id,
            "branchName": branch_names.get(&branch_id).cloned().unwrap_or_default(),
            "staffId": staff_id,
            "staffName": staff_name,
            "businessDate": doc_str(&d, "businessDate"),
            "clockInAt": clock_in,
            "clockOutAt": clock_out,
            "status": status_field,
            "attendanceStatus": attendance_status,
            "overtimeMinutes": doc_i64(&d, &["overtimeMinutes"]),
            "workedMinutes": worked_minutes,
            "lateMinutes": doc_i64(&d, &["lateMinutes"]),
            "missingClockOut": missing_clock_out,
            "source": source,
            "version": doc_i64(&d, &["version"]).max(1),
        }));
    }
    let filters = serde_json::json!({
        "branchId": query.branch_id,
        "from": query.from,
        "to": query.to,
        "staffId": query.staff_id,
        "status": query.status,
        "search": query.search,
    });
    Ok(ok(ops_envelope(items, limit, offset, total, filters)))
}

async fn owner_attendance_corrections(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attendance_id): Path<String>,
    Json(request): Json<OwnerAttendanceCorrectionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let attendance = parse_object_id(&attendance_id)?;
    let existing = find_attendance(&state.store.database, &context.salon_id, &attendance).await?;
    if request.clock_out_at.is_none() && request.reason.is_none() && request.note.is_none() {
        return Err(AppError::Validation(
            "Provide a new clock-out time or a reason for the correction.".to_string(),
        ));
    }
    let mut set = Document::new();
    set.insert("updatedBy", &context.user_id);
    if let Some(clock_out_at) = request.clock_out_at.as_deref() {
        let parsed = chrono::DateTime::parse_from_rfc3339(clock_out_at)
            .map_err(|_| {
                AppError::Validation("clockOutAt must be an RFC3339 timestamp.".to_string())
            })?
            .with_timezone(&chrono::Utc);
        let clock_in_millis = doc_dt_millis(&existing, &["clockInAt"]);
        let out_millis = parsed.timestamp_millis();
        let gross = if clock_in_millis > 0 && out_millis > clock_in_millis {
            (out_millis - clock_in_millis) / 60000
        } else {
            0
        };
        let break_minutes = doc_i64(&existing, &["breakMinutes"]).max(0);
        let net = (gross - break_minutes).max(0);
        set.insert("clockOutAt", DateTime::from_millis(out_millis));
        set.insert("status", "clocked_out");
        set.insert("grossMinutes", gross);
        set.insert("netMinutes", net);
        set.insert("missingClockOut", false);
        set.insert("correctedAt", DateTime::now());
    }
    let collection = state.store.database.collection::<Document>("attendances");
    collection
        .update_one(
            doc! { "_id": &attendance, "salonId": &context.salon_id },
            doc! { "$set": set.clone() },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    let correction = doc! {
        "attendanceId": attendance.to_hex().clone(),
        "salonId": &context.salon_id,
        "staffId": doc_str(&existing, "staffId"),
        "type": "punch-time",
        "oldClockOutAt": doc_dt(&existing, "clockOutAt"),
        "newClockOutAt": request.clock_out_at.clone().unwrap_or_default(),
        "reason": request.reason.clone().unwrap_or_default(),
        "note": request.note.clone().unwrap_or_default(),
        "requestedByUserId": &context.user_id,
        "status": "applied",
        "createdAt": DateTime::now(),
        "updatedAt": DateTime::now(),
    };
    state
        .store
        .database
        .collection::<Document>("attendancecorrections")
        .insert_one(correction, None)
        .await
        .map_err(|_| AppError::Database)?;
    Ok(ok(serde_json::json!({
        "id": attendance.to_hex(),
        "attendanceId": attendance.to_hex(),
        "type": "punch-time",
        "applied": true,
        "status": "applied",
        "correctedClockOutAt": request.clock_out_at.clone().unwrap_or_default(),
        "reason": request.reason.clone().unwrap_or_default(),
        "updatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_attendance_reset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(attendance_id): Path<String>,
    Json(request): Json<OwnerAttendanceResetRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let attendance = parse_object_id(&attendance_id)?;
    let existing = find_attendance(&state.store.database, &context.salon_id, &attendance).await?;
    let mut set = Document::new();
    set.insert("updatedBy", &context.user_id);
    set.insert("missingClockOut", true);
    let reset_kind = if let Some(manual) = request.manual_minutes {
        set.insert("grossMinutes", manual);
        set.insert("netMinutes", manual);
        set.insert("status", "clocked_out");
        "manual-minutes"
    } else {
        set.insert("status", "active");
        "clear-clock-out"
    };
    let collection = state.store.database.collection::<Document>("attendances");
    if reset_kind == "clear-clock-out" {
        collection
            .update_one(
                doc! { "_id": &attendance, "salonId": &context.salon_id },
                doc! { "$set": set.clone(), "$unset": { "clockOutAt": "" } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
    } else {
        collection
            .update_one(
                doc! { "_id": &attendance, "salonId": &context.salon_id },
                doc! { "$set": set.clone() },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
    }
    state
        .store
        .database
        .collection::<Document>("attendancecorrections")
        .insert_one(
            doc! {
                "attendanceId": attendance.to_hex().clone(),
                "salonId": &context.salon_id,
                "staffId": doc_str(&existing, "staffId"),
                "type": "reset",
                "manualMinutes": request.manual_minutes.unwrap_or_default(),
"reason": request.reason.clone().unwrap_or_default(),
        "note": request.note.clone().unwrap_or_default(),
        "requestedByUserId": &context.user_id,
        "status": "applied",
        "createdAt": DateTime::now(),
        "updatedAt": DateTime::now(),
    },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    Ok(ok(serde_json::json!({
        "id": attendance.to_hex(),
        "attendanceId": attendance.to_hex(),
        "type": "reset",
        "applied": true,
        "manualMinutes": request.manual_minutes.unwrap_or_default(),
        "status": "applied",
        "reason": request.reason.clone().unwrap_or_default(),
        "updatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_staff_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let result = state
        .owner
        .staff(&context, OwnerListQuery { branch_id: None, limit: None })
        .await?;
    let found = result
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(staff_id.as_str()));
    let mut staff_json = found.ok_or_else(|| AppError::NotFound("Staff member not found.".to_string()))?;
    let branch_ids: Vec<String> = {
        let user = find_staff_user(&state.store.database, &context.salon_id, &staff_id).await?;
        user.as_ref()
            .map(|u| {
                let mut ids: Vec<String> = u
                    .get_array("branchIds")
                    .map(|a| {
                        a.iter()
                            .filter_map(|b| b.as_str().map(str::to_string))
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                let branch = doc_str(u, "branchId");
                if !branch.is_empty() && !ids.contains(&branch) {
                    ids.push(branch);
                }
                ids
            })
            .unwrap_or_default()
    };
    let branch_names = branch_name_map(&state.store.database, &context.salon_id).await;
    let branches: Vec<serde_json::Value> = branch_ids
        .clone()
        .into_iter()
        .map(|id| {
            serde_json::json!({
                "id": id,
                "name": branch_names.get(&id).cloned().unwrap_or_else(|| id.clone()),
            })
        })
        .collect();
    if let Some(obj) = staff_json.as_object_mut() {
        obj.insert("branches".to_string(), serde_json::json!(branches));
        obj.insert("branchIds".to_string(), serde_json::json!(branch_ids));
        obj.insert(
            "capabilities".to_string(),
            serde_json::json!({ "loginEnabled": true, "schedulingEnabled": true, "transferEnabled": true }),
        );
    }
    Ok(ok(staff_json))
}

async fn owner_staff_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<OwnerStaffStatusRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let status = request.status.trim().to_string();
    if !["active", "disabled", "suspended"].contains(&status.as_str()) {
        return Err(AppError::Validation(
            "status must be active, disabled, or suspended.".to_string(),
        ));
    }
    let user = find_staff_user(&state.store.database, &context.salon_id, &staff_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Staff member not found.".to_string()))?;
    let user_id = doc_id_string(&user);
    state
        .store
        .database
        .collection::<Document>("users")
        .update_one(
            doc! { "_id": parse_object_id(&user_id)?, "salonId": &context.salon_id },
            doc! {
                "$set": {
                    "status": status.clone(),
                    "statusChangedBy": &context.user_id,
                    "statusChangedAt": DateTime::now(),
                    "statusChangeReason": request.reason.clone().unwrap_or_default(),
                    "updatedAt": DateTime::now(),
                }
            },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    Ok(ok(serde_json::json!({
        "id": user_id,
        "loginId": doc_str(&user, "loginId"),
        "status": status,
        "reason": request.reason.clone().unwrap_or_default(),
        "updatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_staff_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<OwnerStaffLoginRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let login_id = request.login_id.trim().to_string();
    if login_id.is_empty() {
        return Err(AppError::Validation("loginId is required.".to_string()));
    }
    let generated_password = request
        .password
        .clone()
        .unwrap_or_else(|| {
            rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect()
        });
    if !request.password.is_none() && request.password.as_deref().unwrap_or("").len() < 4 {
        return Err(AppError::Validation(
            "password must be at least 4 characters.".to_string(),
        ));
    }
    let password_hash =
        bcrypt::hash(&generated_password, bcrypt::DEFAULT_COST).map_err(|_| AppError::Internal)?;
    let role = request.role.clone().unwrap_or_else(|| "staff".to_string());
    let status = request.status.clone().unwrap_or_else(|| "active".to_string());
    let branch_ids = request.branch_ids.clone().unwrap_or_default();
    let branch_id = branch_ids.first().cloned().unwrap_or_else(|| context.branch_id.clone());
    let existing = find_staff_user(&state.store.database, &context.salon_id, &staff_id).await?;
    let now = DateTime::now();
    let id = if let Some(user) = existing {
        let user_oid = parse_object_id(&doc_id_string(&user))?;
        state
            .store
            .database
            .collection::<Document>("users")
            .update_one(
                doc! { "_id": user_oid, "salonId": &context.salon_id },
                doc! {
                    "$set": {
                        "loginId": login_id.clone(),
                        "loginIdNormalized": login_id.to_lowercase(),
                        "role": role.clone(),
                        "status": status.clone(),
                        "branchIds": &branch_ids,
                        "branchId": &branch_id,
                        "passwordHash": &password_hash,
                        "email": request.email.clone(),
                        "updatedAt": now.clone(),
                    }
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        user_oid.to_hex()
    } else {
        let staff_permissions =
            default_user_permissions_from_salon(&state.store.database, &context.salon_id).await?;
        let refresh_tokens: Vec<Document> = Vec::new();
        let insert = doc! {
            "salonId": &context.salon_id,
            "loginId": &login_id,
            "loginIdNormalized": login_id.to_lowercase(),
            "name": &login_id,
            "email": request.email.clone(),
            "passwordHash": &password_hash,
            "role": &role,
            "staffId": &staff_id,
            "branchId": &branch_id,
            "branchIds": &branch_ids,
            "status": &status,
            "staffAppPermissions": staff_permissions,
            "crmPermissions": Vec::<String>::new(),
            "totpEnabled": false,
            "recoveryCodes": Vec::<String>::new(),
            "refreshTokens": refresh_tokens,
            "hourlyRatePaise": 0,
            "createdAt": now.clone(),
            "updatedAt": now.clone(),
        };
        let result = state
            .store
            .database
            .collection::<Document>("users")
            .insert_one(insert, None)
            .await
            .map_err(|_| AppError::Database)?;
        result
            .inserted_id
            .as_object_id()
            .map(|oid| oid.to_hex())
            .unwrap_or_default()
    };
    Ok(ok(serde_json::json!({
        "id": id,
        "staffId": staff_id,
        "loginId": login_id,
        "email": request.email.unwrap_or_default(),
        "role": role,
        "status": status,
        "branchIds": branch_ids,
        "branchId": branch_id,
        "loginStatus": "active",
        "tempPassword": generated_password,
        "credentialsChanged": false,
        "sendCredentials": request.send_credentials.unwrap_or_default(),
        "updatedAt": now.try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn default_user_permissions_from_salon(database: &mongodb::Database, salon_id: &str) -> Result<Vec<String>, AppError> {
    let owner = database
        .collection::<Document>("users")
        .find_one(
            doc! { "salonId": salon_id, "role": "owner" },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    if let Some(doc) = owner {
        if let Ok(perms) = doc.get_array("staffAppPermissions") {
            let perms: Vec<String> = perms
                .iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .take(8)
                .collect();
            if !perms.is_empty() {
                return Ok(perms);
            }
        }
    }
    Ok(["read:appointments", "create:appointments", "update:appointments", "read:clients", "create:clients", "update:clients"]
        .iter()
        .map(|p| p.to_string())
        .collect())
}

async fn owner_staff_transfer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<OwnerStaffTransferRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let to_branch = request.branch_id.trim().to_string();
    if to_branch.is_empty() {
        return Err(AppError::Validation("branchId is required.".to_string()));
    }
    let branches = resolve_branch_ids(&context, Some(&to_branch))?;
    if !branches.map(|ids| ids.contains(&to_branch)).unwrap_or(true) {
        return Err(AppError::Authorization);
    }
    let user = find_staff_user(&state.store.database, &context.salon_id, &staff_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Staff member not found.".to_string()))?;
    let user_oid = parse_object_id(&doc_id_string(&user))?;
    let from_branch = doc_str(&user, "branchId");
    state
        .store
        .database
        .collection::<Document>("users")
        .update_one(
            doc! { "_id": user_oid, "salonId": &context.salon_id },
            doc! {
                "$set": {
                    "branchId": &to_branch,
                    "branchIds": vec![&to_branch],
                    "updatedAt": DateTime::now(),
                },
                "$push": {
                    "organizationalChanges": doc! {
                        "type": "transfer",
                        "fromBranchId": &from_branch,
                        "toBranchId": &to_branch,
                        "effectiveFrom": request.effective_from.clone().unwrap_or_default(),
                        "note": request.note.clone().unwrap_or_default(),
                        "changedByUserId": &context.user_id,
                        "at": DateTime::now(),
                    }
                }
            },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    Ok(ok(serde_json::json!({
        "id": doc_id_string(&user),
        "fromBranchId": from_branch,
        "toBranchId": to_branch,
        "effectiveFrom": request.effective_from.unwrap_or_default(),
        "note": request.note.unwrap_or_default(),
        "updatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_staff_schedules(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<OwnerStaffScheduleRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    if chrono::NaiveDate::parse_from_str(&request.schedule_date, "%Y-%m-%d").is_err() {
        return Err(AppError::Validation(
            "scheduleDate must be in YYYY-MM-DD format.".to_string(),
        ));
    }
    if !is_time_string(&request.start_time) || !is_time_string(&request.end_time) {
        return Err(AppError::Validation(
            "startTime and endTime must be in HH:MM format.".to_string(),
        ));
    }
    let user = find_staff_user(&state.store.database, &context.salon_id, &staff_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Staff member not found.".to_string()))?;
    let status = request.status.clone().unwrap_or_else(|| "scheduled".to_string());
    let now = DateTime::now();
    let insert = doc! {
        "salonId": &context.salon_id,
        "branchId": doc_str(&user, "branchId"),
        "staffId": &staff_id,
        "scheduleDate": &request.schedule_date,
        "startTime": &request.start_time,
        "endTime": &request.end_time,
        "status": &status,
        "version": 1,
        "createdAt": now.clone(),
        "updatedAt": now.clone(),
        "createdByUserId": &context.user_id,
    };
    let result = state
        .store
        .database
        .collection::<Document>("schedules")
        .insert_one(insert, None)
        .await
        .map_err(|_| AppError::Database)?;
    let id = result.inserted_id.as_object_id().map(|o| o.to_hex()).unwrap_or_default();
    Ok(ok(serde_json::json!({
        "id": id,
        "branchId": doc_str(&user, "branchId"),
        "staffId": staff_id,
        "scheduleDate": request.schedule_date,
        "startTime": request.start_time,
        "endTime": request.end_time,
        "status": status,
        "version": 1,
        "createdAt": now.try_to_rfc3339_string().unwrap_or_default(),
        "updatedAt": now.try_to_rfc3339_string().unwrap_or_default(),
    })))
}

fn is_time_string(value: &str) -> bool {
    let mut parts = value.split(':');
    let hours = parts.next().and_then(|p| p.parse::<u32>().ok());
    let minutes = parts.next().and_then(|p| p.parse::<u32>().ok());
    match (hours, minutes, parts.next()) {
        (Some(h), Some(m), None) => h < 24 && m < 60,
        _ => false,
    }
}

async fn owner_staff_commissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<OwnerStaffCommissionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    if request.period.trim().is_empty() {
        return Err(AppError::Validation("period is required.".to_string()));
    }
    let now = chrono::Utc::now().date_naive().to_string();
    let to = request.to.clone().unwrap_or_else(|| now.clone());
    let from = request
        .from
        .clone()
        .unwrap_or_else(|| shift_day(&now, -30));
    let _ = finance_window(&state.store.database, &context.salon_id, &None, &from, &to).await?;
    let staff_sales = {
        let mut appt_staff: HashMap<String, String> = HashMap::new();
        {
            let mut cursor = state
                .store
                .database
                .collection::<Document>("appointments")
                .find(doc! { "salonId": &context.salon_id, "staffId": &staff_id }, None)
                .await
                .map_err(|_| AppError::Database)?;
            while cursor.advance().await.map_err(|_| AppError::Database)? {
                let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
                appt_staff.insert(doc_id_string(&d), doc_str(&d, "staffId"));
            }
        }
        let mut total = 0i64;
        let mut invoice_count = 0i64;
        for d in invoice_docs(&state.store.database, &context.salon_id, &None, &from, &to).await? {
            let status = doc_str(&d, "status");
            if status == "void" || status == "refunded" || status == "cancelled" {
                continue;
            }
            let appointment_id = doc_str(&d, "appointmentId");
            if !appointment_id.is_empty() && appt_staff.contains_key(&appointment_id) {
                total += doc_i64(&d, &["grandTotalPaise"]);
                invoice_count += 1;
            }
        }
        (total, invoice_count)
    };
    let (sales, invoice_count) = staff_sales;
    Ok(ok(serde_json::json!({
        "staffId": staff_id,
        "period": request.period,
        "from": from,
        "to": to,
        "revenuePaise": sales,
        "invoiceCount": invoice_count,
        "serviceRevenuePaise": sales,
        "productRevenuePaise": 0,
        "commissionPaise": 0,
        "commissionRatePct": 0,
        "currency": "INR",
        "generatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn owner_marketing_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerMarketingQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let _branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let limit = query.limit.or(query.page_size).unwrap_or(50).clamp(1, 200);
    let offset = query.offset.map(|o| o.max(0)).unwrap_or_else(|| (query.page.unwrap_or(1).max(1) - 1) * limit);
    let mut filter = doc! { "salonId": &context.salon_id };
    if let Some(status) = query.status.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("status", status);
    }
    let collection = state.store.database.collection::<Document>("campaigns");
    let total = collection
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "createdAt": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = collection.find(filter, options).await.map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let mut item = document_json(d.clone());
        if let Some(obj) = item.as_object_mut() {
            obj.insert("id".to_string(), serde_json::json!(doc_id_string(&d)));
            obj.shift_remove("_id");
            obj.entry("name").or_insert_with(|| {
                serde_json::Value::Null
            });
            obj.entry("campaignType").or_insert(serde_json::json!("whatsapp"));
            obj.entry("bounceRatePct").or_insert(serde_json::json!(0));
            obj.entry("openRatePct").or_insert(serde_json::json!(0));
            obj.entry("conversionRatePct").or_insert(serde_json::json!(0));
            obj.entry("recipients").or_insert(serde_json::json!(0));
            obj.entry("createdBy").or_insert(serde_json::json!(""));
        }
        items.push(item);
    }
    let filters = serde_json::json!({
        "branchId": query.branch_id,
        "status": query.status,
    });
    Ok(ok(ops_envelope(items, limit, offset, total, filters)))
}

async fn owner_appointment_pos_handoff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_owner_scope(&context)?;
    let oid = parse_object_id(&id)?;
    let collection = state.store.database.collection::<Document>("appointments");
    let found = collection
        .find_one(doc! { "_id": oid, "salonId": &context.salon_id }, None)
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    let now = DateTime::now().timestamp_millis();
    let expiry = now + 30 * 60 * 1000;
    collection
        .update_one(
            doc! { "_id": oid, "salonId": &context.salon_id },
            doc! {
                "$set": {
                    "posHandoff": {
                        "token": &token,
                        "createdAt": DateTime::from_millis(now),
                        "expiresAt": DateTime::from_millis(expiry),
                        "createdByUserId": &context.user_id,
                    }
                }
            },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    let _ = doc_str(&found, "branchId");
    Ok(ok(serde_json::json!({
        "targetUrl": format!("/pos?handoff={}", token),
        "token": token,
        "expiresAt": DateTime::from_millis(expiry).try_to_rfc3339_string().unwrap_or_default(),
        "appointmentId": id,
        "branchId": doc_str(&found, "branchId"),
        "staffId": doc_str(&found, "staffId"),
        "createdAt": DateTime::from_millis(now).try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn realtime_issue_ticket(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<OwnerRealtimeTicketRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    let branch_id = body
        .branch_id
        .or_else(|| {
            if context.branch_id.is_empty() {
                None
            } else {
                Some(context.branch_id.clone())
            }
        })
        .unwrap_or_default();
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    let now = DateTime::now().timestamp_millis();
    let expiry = now + 10 * 60 * 1000;
    state
        .store
        .database
        .collection::<Document>("realtimetickets")
        .insert_one(
            doc! {
                "token": &token,
                "salonId": &context.salon_id,
                "branchId": &branch_id,
                "userId": &context.user_id,
                "createdAt": DateTime::from_millis(now),
                "expiresAt": DateTime::from_millis(expiry),
                "used": false,
            },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    Ok(ok(serde_json::json!({
        "ticket": token,
        "salonId": context.salon_id,
        "branchId": branch_id,
        "expiresAt": DateTime::from_millis(expiry).try_to_rfc3339_string().unwrap_or_default(),
        "transport": "polling-compatible",
        "serverTime": DateTime::from_millis(now).try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn staff_os_shift_swaps(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerShiftSwapListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let branches = resolve_branch_ids(&context, query.branch_id.as_deref())?;
    let limit = query.limit.or(query.page_size).unwrap_or(50).clamp(1, 200);
    let offset = query.offset.map(|o| o.max(0)).unwrap_or_else(|| (query.page.unwrap_or(1).max(1) - 1) * limit);
    let mut filter = doc! { "salonId": &context.salon_id };
    if let Some(ids) = &branches {
        filter.insert("branchId", doc! { "$in": ids });
    }
    if let Some(status) = query.status.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("status", status);
    }
    let names = staff_maps(&state.store.database, &context.salon_id).await?;
    let collection = state.store.database.collection::<Document>("shiftswaps");
    let total = collection
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "createdAt": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = collection.find(filter, options).await.map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        items.push(shift_swap_json(&d, &names));
    }
    let filters = serde_json::json!({
        "branchId": query.branch_id,
        "status": query.status,
    });
    Ok(ok(ops_envelope(items, limit, offset, total, filters)))
}

async fn staff_os_decide_shift_swap(
    state: &Arc<AppState>,
    context: &solastio_application::auth::RequestContext,
    swap_id: &str,
    request: &OwnerShiftSwapDecisionRequest,
    action: &str,
) -> Result<serde_json::Value, AppError> {
    let oid = parse_object_id(swap_id)?;
    let collection = state.store.database.collection::<Document>("shiftswaps");
    let existing = collection
        .find_one(doc! { "_id": oid, "salonId": &context.salon_id }, None)
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Shift swap request not found.".to_string()))?;
    if doc_str(&existing, "status") != "pending" {
        return Err(AppError::Conflict(
            "This shift swap request is no longer pending.".to_string(),
        ));
    }
    let set = if action == "approved" {
        doc! {
            "status": "approved",
            "targetResponseNote": request.reason.clone().or_else(|| request.note.clone()).unwrap_or_else(|| "Approved by owner".to_string()),
            "decidedBy": &context.user_id,
            "decidedAt": DateTime::now(),
            "updatedAt": DateTime::now(),
        }
    } else {
        doc! {
            "status": "rejected",
            "rejectionReason": request.reason.clone().or_else(|| request.note.clone()).unwrap_or_else(|| "Rejected by owner".to_string()),
            "decidedBy": &context.user_id,
            "decidedAt": DateTime::now(),
            "updatedAt": DateTime::now(),
        }
    };
    let updated = collection
        .find_one_and_update(
            doc! { "_id": oid, "salonId": &context.salon_id, "status": "pending" },
            doc! { "$set": set, "$inc": { "version": 1 } },
            mongodb::options::FindOneAndUpdateOptions::builder()
                .return_document(mongodb::options::ReturnDocument::After)
                .build(),
        )
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::Conflict("This shift swap request is no longer pending.".to_string()))?;
    let names = staff_maps(&state.store.database, &context.salon_id).await?;
    Ok(shift_swap_json(&updated, &names))
}

async fn staff_os_approve_shift_swap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(swap_id): Path<String>,
    Json(request): Json<OwnerShiftSwapDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let result = staff_os_decide_shift_swap(&state, &context, &swap_id, &request, "approved").await?;
    Ok(ok(result))
}

async fn staff_os_reject_shift_swap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(swap_id): Path<String>,
    Json(request): Json<OwnerShiftSwapDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let result = staff_os_decide_shift_swap(&state, &context, &swap_id, &request, "rejected").await?;
    Ok(ok(result))
}

async fn staff_os_decide_leave(
    state: &Arc<AppState>,
    context: &solastio_application::auth::RequestContext,
    leave_id: &str,
    request: &OwnerLeaveDecisionRequest,
    decision: &str,
) -> Result<serde_json::Value, AppError> {
    let oid = parse_object_id(leave_id)?;
    let collection = state.store.database.collection::<Document>("leaves");
    let existing = collection
        .find_one(doc! { "_id": oid, "salonId": &context.salon_id }, None)
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Leave request not found.".to_string()))?;
    if doc_str(&existing, "status") != "pending" {
        return Err(AppError::Conflict(
            "This leave request is no longer pending.".to_string(),
        ));
    }
    let status = if decision == "approved" {
        "approved"
    } else {
        "rejected"
    };
    let decision_note = request
        .reason
        .clone()
        .unwrap_or_else(|| format!("{} by owner", {
            if decision == "approved" { "Approved" } else { "Rejected" }
        }));
    let updated = collection
        .find_one_and_update(
            doc! { "_id": oid, "salonId": &context.salon_id, "status": "pending" },
            doc! {
                "$set": {
                    "status": status,
                    "decisionNote": decision_note,
                    "decidedAt": DateTime::now(),
                    "decidedBy": &context.user_id,
                    "updatedAt": DateTime::now(),
                },
                "$inc": { "version": 1 },
            },
            mongodb::options::FindOneAndUpdateOptions::builder()
                .return_document(mongodb::options::ReturnDocument::After)
                .build(),
        )
        .await
        .map_err(|_| AppError::Database)?
        .ok_or_else(|| AppError::Conflict("This leave request is no longer pending.".to_string()))?;
    let names = staff_maps(&state.store.database, &context.salon_id).await?;
    let staff_id = doc_str(&updated, "staffId");
    let (staff_name, staff_branch) = names
        .get(&staff_id)
        .cloned()
        .unwrap_or_else(|| (staff_id.clone(), String::new()));
    let leave_type = doc_str(&updated, "leaveType");
    let leave_type = if leave_type.is_empty() {
        doc_str(&updated, "type")
    } else {
        leave_type
    };
    Ok(serde_json::json!({
        "id": doc_id_string(&updated),
        "branchId": staff_branch,
        "staffId": staff_id,
        "staffName": staff_name,
        "leaveType": leave_type,
        "startDate": doc_str(&updated, "startDate"),
        "endDate": doc_str(&updated, "endDate"),
        "days": doc_i64(&updated, &["days"]),
        "reason": doc_str(&updated, "reason"),
        "status": status,
        "decisionNote": doc_str(&updated, "decisionNote"),
        "version": doc_i64(&updated, &["version"]),
        "decidedAt": doc_dt(&updated, "decidedAt"),
        "documentAvailable": false,
    }))
}

async fn staff_os_approve_leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(leave_id): Path<String>,
    Json(request): Json<OwnerLeaveDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let result = staff_os_decide_leave(&state, &context, &leave_id, &request, "approved").await?;
    Ok(ok(result))
}

async fn staff_os_reject_leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(leave_id): Path<String>,
    Json(request): Json<OwnerLeaveDecisionRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let result = staff_os_decide_leave(&state, &context, &leave_id, &request, "rejected").await?;
    Ok(ok(result))
}

fn default_att_verify_policy(salon_id: &str, branch_id: &str, user_id: &str) -> serde_json::Value {
    serde_json::json!({
        "salonId": salon_id,
        "branchId": branch_id,
        "allowFaceAuth": false,
        "allowRFID": false,
        "verifyPhotoOnClockIn": true,
        "maxClockInOffsetMinutes": 15,
        "lateAfterMinutes": 15,
        "overtimeGraceMinutes": 5,
        "autoClockOutEnabled": true,
        "defaultShiftStart": "10:00",
        "defaultShiftEnd": "20:00",
        "updatedBy": user_id,
        "updatedAt": DateTime::now().try_to_rfc3339_string().unwrap_or_default(),
    })
}

async fn att_verify_policy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let collection = state.store.database.collection::<Document>("attendancepolicy");
    let found = collection
        .find_one(
            doc! { "salonId": &context.salon_id, "branchId": &branch_id },
            None,
        )
        .await
        .map_err(|_| AppError::Database)?;
    let policy = match found {
        Some(doc) => {
            let mut value = document_json(doc.clone());
            if let Some(obj) = value.as_object_mut() {
                obj.insert("id".to_string(), serde_json::json!(doc_id_string(&doc)));
                obj.shift_remove("_id");
            }
            value
        }
        None => default_att_verify_policy(&context.salon_id, &branch_id, &context.user_id),
    };
    Ok(ok(policy))
}

async fn att_verify_update_policy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
    Json(request): Json<AttVerifyPolicyRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let collection = state.store.database.collection::<Document>("attendancepolicy");
    let defaults = default_att_verify_policy(&context.salon_id, &branch_id, &context.user_id);
    let existing = collection
        .find_one(doc! { "salonId": &context.salon_id, "branchId": &branch_id }, None)
        .await
        .map_err(|_| AppError::Database)?;
    let mut set = Document::new();
    set.insert("updatedBy", &context.user_id);
    set.insert("updatedAt", DateTime::now());
    if let Some(v) = request.allow_face_auth {
        set.insert("allowFaceAuth", v);
    }
    if let Some(v) = request.allow_rfid {
        set.insert("allowRFID", v);
    }
    if let Some(v) = request.verify_photo_on_clock_in {
        set.insert("verifyPhotoOnClockIn", v);
    }
    if let Some(v) = request.max_clock_in_offset_minutes {
        set.insert("maxClockInOffsetMinutes", v);
    }
    if let Some(v) = request.late_after_minutes {
        set.insert("lateAfterMinutes", v);
    }
    if let Some(v) = request.overtime_grace_minutes {
        set.insert("overtimeGraceMinutes", v);
    }
    if let Some(v) = request.auto_clock_out_enabled {
        set.insert("autoClockOutEnabled", v);
    }
    if let Some(v) = &request.default_shift_start {
        set.insert("defaultShiftStart", v);
    }
    if let Some(v) = &request.default_shift_end {
        set.insert("defaultShiftEnd", v);
    }
    let updated = collection
        .find_one_and_update(
            doc! { "salonId": &context.salon_id, "branchId": &branch_id },
            doc! { "$set": set, "$setOnInsert": { "createdAt": DateTime::now() } },
            mongodb::options::FindOneAndUpdateOptions::builder()
                .upsert(true)
                .return_document(mongodb::options::ReturnDocument::After)
                .build(),
        )
        .await
        .map_err(|_| AppError::Database)?;
    let existing_defaults = existing
        .map(|d| document_json(d))
        .unwrap_or(defaults);
    let mut merged = existing_defaults;
    if let Some(obj) = merged.as_object_mut() {
        obj.insert("branchId".to_string(), serde_json::json!(branch_id));
        obj.insert("salonId".to_string(), serde_json::json!(context.salon_id));
        if let Some(v) = request.allow_face_auth {
            obj.insert("allowFaceAuth".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.allow_rfid {
            obj.insert("allowRFID".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.verify_photo_on_clock_in {
            obj.insert("verifyPhotoOnClockIn".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.max_clock_in_offset_minutes {
            obj.insert("maxClockInOffsetMinutes".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.late_after_minutes {
            obj.insert("lateAfterMinutes".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.overtime_grace_minutes {
            obj.insert("overtimeGraceMinutes".to_string(), serde_json::json!(v));
        }
        if let Some(v) = request.auto_clock_out_enabled {
            obj.insert("autoClockOutEnabled".to_string(), serde_json::json!(v));
        }
        if let Some(v) = &request.default_shift_start {
            obj.insert("defaultShiftStart".to_string(), serde_json::json!(v));
        }
        if let Some(v) = &request.default_shift_end {
            obj.insert("defaultShiftEnd".to_string(), serde_json::json!(v));
        }
    }
    if let Some(updated_doc) = updated {
        let mut backend_value = document_json(updated_doc.clone());
        match backend_value.as_object_mut() {
            Some(obj) => {
                obj.insert("id".to_string(), serde_json::json!(doc_id_string(&updated_doc)));
                obj.shift_remove("_id");
            }
            None => {}
        }
        return Ok(ok(backend_value));
    }
    Ok(ok(merged))
}

async fn att_verify_devices(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerShiftSwapListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let limit = query.limit.or(query.page_size).unwrap_or(50).clamp(1, 200);
    let offset = query.offset.map(|o| o.max(0)).unwrap_or_else(|| (query.page.unwrap_or(1).max(1) - 1) * limit);
    let mut filter = doc! { "salonId": &context.salon_id };
    if let Some(branch) = query.branch_id.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("branchId", branch);
    }
    let collection = state.store.database.collection::<Document>("attendedevices");
    let total = collection
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "createdAt": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = collection.find(filter, options).await.map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let mut item = document_json(d.clone());
        if let Some(obj) = item.as_object_mut() {
            obj.insert("id".to_string(), serde_json::json!(doc_id_string(&d)));
            obj.shift_remove("_id");
            obj.entry("verificationMethod")
                .or_insert(serde_json::json!("face"));
            obj.entry("status").or_insert(serde_json::json!("active"));
        }
        items.push(item);
    }
    let filters = serde_json::json!({ "branchId": query.branch_id });
    Ok(ok(ops_envelope(items, limit, offset, total, filters)))
}

async fn att_verify_device_review(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
    Json(request): Json<AttVerifyDeviceReviewRequest>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let verdict = request.verdict.trim().to_string();
    if !["approved", "rejected", "blocked"].contains(&verdict.as_str()) {
        return Err(AppError::Validation(
            "verdict must be approved, rejected, or blocked.".to_string(),
        ));
    }
    let status = request.status.clone().unwrap_or_else(|| "reviewed".to_string());
    let now = DateTime::now();
    let insert = doc! {
        "deviceId": &device_id,
        "salonId": &context.salon_id,
        "branchId": &context.branch_id,
        "reviewerUserId": &context.user_id,
        "verdict": &verdict,
        "notes": request.notes.clone().unwrap_or_default(),
        "status": &status,
        "createdAt": now.clone(),
        "updatedAt": now.clone(),
    };
    let result = state
        .store
        .database
        .collection::<Document>("attendancecorrections")
        .insert_one(insert, None)
        .await
        .map_err(|_| AppError::Database)?;
    let id = result
        .inserted_id
        .as_object_id()
        .map(|o| o.to_hex())
        .unwrap_or_default();
    Ok(ok(serde_json::json!({
        "id": id,
        "deviceId": device_id,
        "verdict": verdict,
        "notes": request.notes.unwrap_or_default(),
        "status": status,
        "type": "device-review",
        "reviewedAt": now.try_to_rfc3339_string().unwrap_or_default(),
    })))
}

async fn att_verify_evidence(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OwnerAttendanceListQuery>,
) -> Result<axum::response::Response, AppError> {
    let context = context_from_headers(&state, &headers).await?;
    require_staff_oversight(&context)?;
    let limit = query.limit.or(query.page_size).unwrap_or(50).clamp(1, 200);
    let offset = query.offset.map(|o| o.max(0)).unwrap_or_else(|| (query.page.unwrap_or(1).max(1) - 1) * limit);
    let mut filter = doc! { "salonId": &context.salon_id };
    if let Some(branch) = query.branch_id.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("branchId", branch);
    }
    if let Some(staff_id) = query.staff_id.as_deref().filter(|s| !s.is_empty()) {
        filter.insert("staffId", staff_id);
    }
    let mut date_criteria = Document::new();
    if let Some(from) = query.from.as_deref().filter(|s| !s.is_empty()) {
        date_criteria.insert("$gte", from);
    }
    if let Some(to) = query.to.as_deref().filter(|s| !s.is_empty()) {
        date_criteria.insert("$lte", to);
    }
    if !date_criteria.is_empty() {
        filter.insert("businessDate", date_criteria);
    }
    let collection = state.store.database.collection::<Document>("attendanceevidence");
    let total = collection
        .count_documents(filter.clone(), None)
        .await
        .map_err(|_| AppError::Database)?;
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "businessDate": -1 })
        .skip(offset as u64)
        .limit(limit)
        .build();
    let mut cursor = collection.find(filter, options).await.map_err(|_| AppError::Database)?;
    let mut items = Vec::new();
    while cursor.advance().await.map_err(|_| AppError::Database)? {
        let d: Document = cursor.deserialize_current().map_err(|_| AppError::Database)?;
        let mut item = document_json(d.clone());
        if let Some(obj) = item.as_object_mut() {
            obj.insert("id".to_string(), serde_json::json!(doc_id_string(&d)));
            obj.shift_remove("_id");
            obj.entry("evidenceType").or_insert(serde_json::json!("photo"));
            obj.entry("reviewStatus").or_insert(serde_json::json!("pending"));
        }
        items.push(item);
    }
    let filters = serde_json::json!({
        "branchId": query.branch_id,
        "staffId": query.staff_id,
        "from": query.from,
        "to": query.to,
    });
    Ok(ok(ops_envelope(items, limit, offset, total, filters)))
}
