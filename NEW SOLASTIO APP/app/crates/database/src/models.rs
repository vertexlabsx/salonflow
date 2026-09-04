use mongodb::bson::{oid::ObjectId, DateTime};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshTokenRecord {
    pub token_hash: String,
    pub issued_at: DateTime,
    pub expires_at: DateTime,
    #[serde(default)]
    pub revoked_at: Option<DateTime>,
    #[serde(default)]
    pub replaced_by_hash: Option<String>,
    #[serde(default)]
    pub device_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub login_id: String,
    pub login_id_normalized: String,
    #[serde(default)]
    pub email: Option<String>,
    pub name: String,
    pub password_hash: String,
    pub role: String,
    #[serde(default)]
    pub role_display_name: Option<String>,
    #[serde(default)]
    pub custom_role_name: Option<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    pub branch_id: String,
    #[serde(default)]
    pub branch_ids: Vec<String>,
    #[serde(default)]
    pub staff_app_permissions: Vec<String>,
    #[serde(default)]
    pub crm_permissions: Vec<String>,
    pub status: String,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    #[serde(default)]
    pub refresh_tokens: Vec<RefreshTokenRecord>,
    #[serde(default)]
    pub hourly_rate_paise: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopifyUserRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub shop_domain: String,
    pub login_id: String,
    pub login_id_normalized: String,
    pub email: String,
    pub name: String,
    pub password_hash: String,
    pub role: String,
    pub status: String,
    #[serde(default)]
    pub refresh_tokens: Vec<RefreshTokenRecord>,
}

impl UserRecord {
    pub fn effective_permissions(&self) -> Vec<String> {
        if self.staff_app_permissions.is_empty() {
            self.crm_permissions.clone()
        } else {
            self.staff_app_permissions.clone()
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalonRecord {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub whatsapp_phone_number_ids: Vec<String>,
}

fn default_timezone() -> String {
    "Asia/Kolkata".to_string()
}
fn default_currency() -> String {
    "INR".to_string()
}
fn default_status() -> String {
    "active".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub staff_id: String,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub service_names: Vec<String>,
    pub duration_minutes: i64,
    pub value: i64,
    pub start_at: DateTime,
    pub end_at: DateTime,
    pub status: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default = "default_version")]
    pub version: i64,
}

fn default_version() -> i64 {
    1
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    #[serde(default)]
    pub branch_ids: Vec<String>,
    #[serde(default)]
    pub category: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub price_paise: i64,
    pub duration_minutes: i64,
    #[serde(default)]
    pub eligible_staff_ids: Vec<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchHoursRecord {
    pub weekday: i32,
    pub open: String,
    pub close: String,
    #[serde(default)]
    pub closed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRecord {
    #[serde(rename = "_id")]
    pub id: String,
    pub salon_id: String,
    pub name: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub status: String,
    #[serde(default)]
    pub hours: Vec<BranchHoursRecord>,
    #[serde(default)]
    pub slot_interval_minutes: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub schedule_date: String,
    pub start_time: String,
    pub end_time: String,
    pub status: String,
    #[serde(default = "default_version")]
    pub version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub staff_id: String,
    pub start_date: String,
    pub end_date: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub name: String,
    pub normalized_phone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub interaction_status: String,
    #[serde(default)]
    pub visit_count: i64,
    #[serde(default)]
    pub last_booked_at: Option<DateTime>,
    #[serde(default)]
    pub wallet_balance_paise: i64,
    #[serde(default)]
    pub loyalty_points: i64,
    #[serde(default)]
    pub membership_id: String,
    #[serde(default)]
    pub membership_plan_name: String,
    #[serde(default)]
    pub membership_credits: i64,
    #[serde(default)]
    pub membership_credits_remaining: i64,
    #[serde(default)]
    pub membership_valid_until: String,
    #[serde(default)]
    pub membership_status: String,
    #[serde(default)]
    pub package_name: String,
    #[serde(default)]
    pub package_credits_remaining: i64,
    #[serde(default)]
    pub subscription_name: String,
    #[serde(default)]
    pub subscription_status: String,
    #[serde(default)]
    pub marketing_opt_out: bool,
    #[serde(default)]
    pub gender: String,
    #[serde(default)]
    pub birthday: String,
    #[serde(default)]
    pub anniversary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
    #[serde(default)]
    pub updated_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPhotoRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub customer_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub appointment_id: String,
    #[serde(default)]
    pub before_url: String,
    #[serde(default)]
    pub after_url: String,
    #[serde(default)]
    pub caption: String,
    #[serde(default)]
    pub service_names: Vec<String>,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceBreakRecord {
    #[serde(default = "default_break_type")]
    pub break_type: String,
    pub started_at: DateTime,
    #[serde(default)]
    pub ended_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub staff_id: String,
    pub business_date: String,
    pub clock_in_at: DateTime,
    #[serde(default)]
    pub clock_out_at: Option<DateTime>,
    pub status: String,
    #[serde(default = "default_attendance_source")]
    pub source: String,
    #[serde(default)]
    pub gross_minutes: i64,
    #[serde(default)]
    pub breaks: Vec<AttendanceBreakRecord>,
}

fn default_break_type() -> String {
    "regular".to_string()
}
fn default_attendance_source() -> String {
    "staff-app".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLeaveRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub staff_id: String,
    pub leave_type: String,
    pub start_date: String,
    pub end_date: String,
    #[serde(default)]
    pub reason: String,
    pub status: String,
    pub days: i64,
    #[serde(default = "default_version")]
    pub version: i64,
    #[serde(default)]
    pub decision_note: String,
    #[serde(default)]
    pub decided_by: String,
    #[serde(default)]
    pub decided_at: Option<DateTime>,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffTaskRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub staff_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: String,
    pub priority: String,
    #[serde(default)]
    pub due_at: Option<DateTime>,
    #[serde(default = "default_version")]
    pub version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollItemRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub staff_id: String,
    pub payroll_run_id: String,
    #[serde(default)]
    pub period_start: Option<String>,
    #[serde(default)]
    pub period_end: Option<String>,
    pub gross_amount_paise: i64,
    #[serde(default)]
    pub overtime_amount_paise: i64,
    #[serde(default)]
    pub bonus_amount_paise: i64,
    #[serde(default)]
    pub deduction_amount_paise: i64,
    pub net_amount_paise: i64,
    #[serde(default)]
    pub overtime_minutes: i64,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub staff_id: Option<String>,
    pub target_name: String,
    pub target_type: String,
    pub target_value_paise: i64,
    #[serde(default)]
    pub achieved_value_paise: i64,
    pub status: String,
    pub starts_on: String,
    pub ends_on: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerSettingsRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    #[serde(default)]
    pub branch_id: String,
    #[serde(default)]
    pub settings: mongodb::bson::Document,
    #[serde(default = "default_last_changed_by")]
    pub last_changed_by: String,
}

fn default_last_changed_by() -> String {
    "system".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSwapRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub schedule_id: String,
    pub from_staff_id: String,
    pub to_staff_id: String,
    pub schedule_date: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub reason: String,
    pub status: String,
    #[serde(default)]
    pub target_response_note: String,
    #[serde(default)]
    pub rejection_reason: String,
    #[serde(default = "default_version")]
    pub version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub user_id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub title: String,
    #[serde(default)]
    pub participant_user_ids: Vec<String>,
    #[serde(default)]
    pub last_message_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub conversation_id: ObjectId,
    #[serde(rename = "type")]
    pub message_type: String,
    pub sender_user_id: String,
    #[serde(default)]
    pub sender_name: String,
    pub body: String,
    #[serde(default)]
    pub delivered_count: i64,
    #[serde(default)]
    pub read_count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLineRecord {
    #[serde(default)]
    pub service_id: String,
    #[serde(default)]
    pub product_id: String,
    pub description: String,
    pub quantity: i64,
    pub unit_amount_paise: i64,
    pub tax_rate_bps: i64,
    pub total_paise: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePaymentRecord {
    pub method: String,
    pub amount_paise: i64,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub received_by_user_id: String,
    pub received_at: DateTime,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub customer_id: String,
    #[serde(default)]
    pub appointment_id: String,
    pub invoice_number: String,
    pub status: String,
    pub payment_status: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub lines: Vec<InvoiceLineRecord>,
    pub subtotal_paise: i64,
    pub tax_paise: i64,
    pub grand_total_paise: i64,
    #[serde(default)]
    pub paid_amount_paise: i64,
    pub due_amount_paise: i64,
    #[serde(default)]
    pub payments: Vec<InvoicePaymentRecord>,
    #[serde(default)]
    pub void_reason: String,
    #[serde(default)]
    pub issued_at: Option<DateTime>,
    #[serde(default)]
    pub created_at: Option<DateTime>,
    #[serde(default)]
    pub updated_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub date: String,
    pub category: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub description: String,
    pub amount_paise: i64,
    pub tax_rate_bps: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub invoice_id: String,
    #[serde(default)]
    pub appointment_id: String,
    #[serde(default)]
    pub staff_id: String,
    pub amount_paise: i64,
    pub method: String,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub actor_user_id: String,
    pub actor_role: String,
    pub action: String,
    pub resource_type: String,
    #[serde(default)]
    pub resource_id: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub metadata: mongodb::bson::Document,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoCodeRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub kind: String,
    pub code: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub discount_type: String,
    #[serde(default)]
    pub discount_percent: Option<i64>,
    #[serde(default)]
    pub discount_paise: Option<i64>,
    #[serde(default)]
    pub minimum_spend_paise: i64,
    #[serde(default)]
    pub max_redemptions: Option<i64>,
    #[serde(default)]
    pub starts_at: Option<DateTime>,
    #[serde(default)]
    pub expires_at: Option<DateTime>,
    pub any_branch: bool,
    #[serde(default)]
    pub branch_ids: Vec<String>,
    pub status: String,
    pub redemption_count: i64,
    pub total_discount_paise: i64,
    #[serde(default)]
    pub referrer_reward_type: Option<String>,
    #[serde(default)]
    pub referrer_reward_percent: Option<i64>,
    #[serde(default)]
    pub referrer_reward_paise: Option<i64>,
    #[serde(default)]
    pub created_by: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoRedemptionRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub promo_id: String,
    pub code: String,
    pub customer_id: String,
    #[serde(default)]
    pub customer_name: String,
    #[serde(default)]
    pub appointment_id: String,
    #[serde(default)]
    pub invoice_id: String,
    pub discount_paise: i64,
    #[serde(default)]
    pub discount_percent: Option<i64>,
    #[serde(default)]
    pub applied_by_user_id: String,
    #[serde(default)]
    pub applied_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunItemRecord {
    pub staff_id: String,
    pub gross_minutes: i64,
    pub overtime_minutes: i64,
    pub gross_pay_paise: i64,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub period_start: String,
    pub period_end: String,
    pub status: String,
    pub items: Vec<PayrollRunItemRecord>,
    pub total_gross_pay_paise: i64,
    #[serde(default)]
    pub generated_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderLineRecord {
    pub item_name: String,
    #[serde(default)]
    pub sku: String,
    pub quantity: i64,
    pub unit_cost_paise: i64,
    pub total_paise: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub branch_id: String,
    pub po_number: String,
    pub supplier_name: String,
    #[serde(default)]
    pub supplier_phone: String,
    pub status: String,
    #[serde(default)]
    pub expected_at: Option<DateTime>,
    #[serde(default)]
    pub lines: Vec<PurchaseOrderLineRecord>,
    pub subtotal_paise: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub code: String,
    #[serde(default)]
    pub purchaser_name: String,
    #[serde(default)]
    pub recipient_name: String,
    #[serde(default)]
    pub recipient_phone: String,
    pub initial_value_paise: i64,
    pub balance_paise: i64,
    #[serde(default)]
    pub expires_at: Option<DateTime>,
    pub status: String,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDealItemRecord {
    pub service_id: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDealRecord {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub salon_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub items: Vec<BundleDealItemRecord>,
    pub price_paise: i64,
    pub status: String,
    #[serde(default)]
    pub starts_at: Option<DateTime>,
    #[serde(default)]
    pub expires_at: Option<DateTime>,
    #[serde(default)]
    pub created_by_user_id: String,
    #[serde(default)]
    pub created_at: Option<DateTime>,
}
