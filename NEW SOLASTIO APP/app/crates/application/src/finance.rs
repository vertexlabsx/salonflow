use chrono;
use mongodb::bson::oid::ObjectId;
use mongodb::bson::DateTime;
use serde::Deserialize;
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{
        AuditLogRecord, BundleDealItemRecord, BundleDealRecord, ExpenseRecord, GiftCardRecord,
        InvoiceLineRecord, InvoiceRecord, PayrollRunItemRecord, PayrollRunRecord, PromoCodeRecord,
        PromoRedemptionRecord, PurchaseOrderLineRecord, PurchaseOrderRecord, TipRecord,
    },
    repositories::FinanceRepository,
};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct FinanceService {
    finance: FinanceRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceListQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequest {
    pub method: String,
    pub amount_paise: i64,
    #[serde(default)]
    pub reference: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipRequest {
    pub method: String,
    pub amount_paise: i64,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub staff_id: String,
}

#[derive(Debug, Deserialize)]
pub struct VoidRequest {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct TaxSettingsUpdate {
    #[serde(default)]
    pub gstin: String,
    #[serde(default)]
    pub place_of_supply: String,
    #[serde(default)]
    pub default_tax_rate_bps: i64,
    #[serde(default)]
    pub prices_include_tax: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default = "default_from_date")]
    pub from_date: String,
    #[serde(default = "default_to_date")]
    pub to_date: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

fn default_from_date() -> String {
    "2000-01-01".to_string()
}
fn default_to_date() -> String {
    "2999-12-31".to_string()
}
fn default_category() -> String {
    "all".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseWrite {
    pub branch_id: String,
    pub date: String,
    pub category: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub amount_paise: i64,
    #[serde(default)]
    pub tax_rate_bps: i64,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GstReportQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    pub from_date: String,
    pub to_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderLineInput {
    pub item_name: String,
    #[serde(default)]
    pub sku: String,
    pub quantity: i64,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderWrite {
    pub branch_id: String,
    pub supplier_name: String,
    #[serde(default)]
    pub supplier_phone: String,
    #[serde(default)]
    pub expected_at: Option<String>,
    #[serde(default)]
    pub tax_paise: i64,
    #[serde(default)]
    pub notes: String,
    pub lines: Vec<PurchaseOrderLineInput>,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseOrderStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardQuery {
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardWrite {
    #[serde(default)]
    pub purchaser_name: String,
    #[serde(default)]
    pub recipient_name: String,
    #[serde(default)]
    pub recipient_phone: String,
    pub initial_value_paise: i64,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardRedeemRequest {
    pub amount_paise: i64,
    #[serde(default)]
    pub reference: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDealItemInput {
    pub service_id: String,
    #[serde(default)]
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDealWrite {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub items: Vec<BundleDealItemInput>,
    pub price_paise: i64,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BundleDealStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogQuery {
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub actor_user_id: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogExportQuery {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoQuery {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoWrite {
    pub kind: String,
    #[serde(default)]
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
    pub starts_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub any_branch: bool,
    #[serde(default)]
    pub branch_ids: Vec<String>,
    #[serde(default)]
    pub referrer_reward_type: Option<String>,
    #[serde(default)]
    pub referrer_reward_percent: Option<i64>,
    #[serde(default)]
    pub referrer_reward_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PromoStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoRedeemRequest {
    pub code: String,
    pub branch_id: String,
    pub customer_id: String,
    #[serde(default)]
    pub customer_phone: String,
    #[serde(default)]
    pub appointment_id: String,
    #[serde(default)]
    pub invoice_id: String,
    pub subtotal_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoRedemptionQuery {
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollGenerateRequest {
    pub branch_id: String,
    pub period_start: String,
    pub period_end: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PayrollStatusRequest {
    pub status: String,
}

const EXPENSE_CATEGORIES: [&str; 10] = [
    "rent",
    "salaries",
    "utilities",
    "products",
    "equipment",
    "marketing",
    "maintenance",
    "insurance",
    "taxes",
    "other",
];

const PAYMENT_METHODS: [&str; 5] = ["cash", "card", "upi", "bank_transfer", "other"];

const PO_STATUSES: [&str; 4] = ["draft", "sent", "received", "cancelled"];

const GIFT_CARD_STATUSES: [&str; 4] = ["active", "redeemed", "expired", "void"];

const BUNDLE_STATUSES: [&str; 2] = ["active", "paused"];

const PROMO_STATUSES: [&str; 4] = ["active", "paused", "expired", "archived"];
const PROMO_KINDS: [&str; 3] = ["manual", "referral", "winback"];
const PAYROLL_STATUSES: [&str; 4] = ["draft", "approved", "paid", "cancelled"];

impl FinanceService {
    pub fn new(finance: FinanceRepository) -> Self {
        Self { finance }
    }

    pub async fn invoices(
        &self,
        context: &RequestContext,
        query: InvoiceListQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:invoices", "read:finance", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let limit = query.limit.unwrap_or(50).clamp(1, 200);
        let offset = query.offset.unwrap_or(0).max(0);
        let (total, docs) = self
            .finance
            .list_invoices(&context.salon_id, &branch_ids, limit, offset)
            .await?;
        let items: Vec<_> = docs.into_iter().map(invoice_list_json).collect();
        let summary = invoice_summary(&items);
        let has_more = (offset + items.len() as i64) < total as i64;
        Ok(serde_json::json!({
            "items": items,
            "page": { "total": total, "limit": limit, "offset": offset, "hasMore": has_more },
            "summary": summary,
            "metadata": { "moneyUnit": "paise", "branchIds": branch_ids }
        }))
    }

    pub async fn invoice_detail(
        &self,
        context: &RequestContext,
        invoice_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:invoices", "read:finance", "admin:*"])?;
        let id = parse_object_id(invoice_id, "invoice")?;
        let invoice = self
            .finance
            .find_invoice(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Invoice not found.".to_string()))?;
        if !branch_allowed(context, &invoice.branch_id) {
            return Err(AppError::Authorization);
        }
        let invoice_id_str = invoice.id.to_hex();
        let branch_name = self
            .finance
            .branch_name(&context.salon_id, &invoice.branch_id)
            .await?;
        let customer_name = self
            .finance
            .customer_name(&context.salon_id, &invoice.customer_id)
            .await?;
        let tips = self
            .finance
            .list_tips_for_invoice(&context.salon_id, &invoice_id_str)
            .await?;
        Ok(invoice_detail_json(
            &invoice,
            &branch_name,
            &customer_name,
            &tips,
        ))
    }

    pub async fn record_payment(
        &self,
        context: &RequestContext,
        invoice_id: &str,
        request: PaymentRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:invoices", "update:invoices", "admin:*"])?;
        if !PAYMENT_METHODS.contains(&request.method.as_str()) {
            return Err(AppError::Validation(format!(
                "method must be one of: {}.",
                PAYMENT_METHODS.join(", ")
            )));
        }
        if request.amount_paise < 1 {
            return Err(AppError::Validation(
                "amountPaise must be at least 1.".to_string(),
            ));
        }
        let id = parse_object_id(invoice_id, "invoice")?;
        let updated = self
            .finance
            .record_payment(
                &context.salon_id,
                id,
                &request.method,
                request.amount_paise,
                &request.reference,
                &context.user_id,
            )
            .await?
            .ok_or_else(|| {
                AppError::Conflict(
                    "Invoice was not found, is voided, or the payment exceeds the due amount."
                        .to_string(),
                )
            })?;
        if !branch_allowed(context, &updated.branch_id) {
            return Err(AppError::Authorization);
        }
        self.audit(
            context,
            "invoice.payment",
            "invoice",
            &updated.id.to_hex(),
            serde_json::json!({ "method": request.method, "amountPaise": request.amount_paise }),
        )
        .await;
        Ok(invoice_summary_json(&updated))
    }

    pub async fn record_tip(
        &self,
        context: &RequestContext,
        invoice_id: &str,
        request: TipRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:invoices", "update:invoices", "admin:*"])?;
        if !PAYMENT_METHODS.contains(&request.method.as_str()) {
            return Err(AppError::Validation(format!(
                "method must be one of: {}.",
                PAYMENT_METHODS.join(", ")
            )));
        }
        if request.amount_paise < 1 {
            return Err(AppError::Validation(
                "amountPaise must be at least 1.".to_string(),
            ));
        }
        let id = parse_object_id(invoice_id, "invoice")?;
        let invoice = self
            .finance
            .find_invoice(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Invoice not found.".to_string()))?;
        if !branch_allowed(context, &invoice.branch_id) {
            return Err(AppError::Authorization);
        }
        if invoice.status == "void" {
            return Err(AppError::Conflict(
                "Cannot record a tip on a voided invoice.".to_string(),
            ));
        }
        let mut staff_id = request.staff_id.clone();
        if staff_id.is_empty() && !invoice.appointment_id.is_empty() {
            if let Some(appointment) = self
                .finance
                .find_appointment(&context.salon_id, &invoice.appointment_id)
                .await?
            {
                staff_id = appointment.staff_id;
            }
        }
        let tip = TipRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: invoice.branch_id.clone(),
            invoice_id: invoice.id.to_hex(),
            appointment_id: invoice.appointment_id.clone(),
            staff_id,
            amount_paise: request.amount_paise,
            method: request.method,
            reference: request.reference,
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let created = self.finance.create_tip(&tip).await?;
        self.audit(
            context,
            "invoice.tip",
            "invoice",
            &invoice.id.to_hex(),
            serde_json::json!({ "tipId": created.id.to_hex(), "amountPaise": created.amount_paise, "staffId": created.staff_id }),
        )
        .await;
        Ok(serde_json::json!({
            "tip": { "id": created.id.to_hex(), "amountPaise": created.amount_paise, "method": created.method, "staffId": created.staff_id, "createdAt": dt_str(created.created_at) }
        }))
    }

    pub async fn void_invoice(
        &self,
        context: &RequestContext,
        invoice_id: &str,
        request: VoidRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:invoices", "update:invoices", "admin:*"])?;
        let reason = request.reason.trim().to_string();
        if reason.len() < 3 || reason.len() > 500 {
            return Err(AppError::Validation(
                "reason must be between 3 and 500 characters.".to_string(),
            ));
        }
        let id = parse_object_id(invoice_id, "invoice")?;
        let updated = self
            .finance
            .void_invoice(&context.salon_id, id, &reason)
            .await?
            .ok_or_else(|| {
                AppError::Conflict("Invoice is already void or does not exist.".to_string())
            })?;
        if !branch_allowed(context, &updated.branch_id) {
            return Err(AppError::Authorization);
        }
        self.audit(
            context,
            "invoice.void",
            "invoice",
            &updated.id.to_hex(),
            serde_json::json!({ "reason": reason }),
        )
        .await;
        Ok(serde_json::json!({ "invoice": invoice_brief_json(&updated) }))
    }

    pub async fn invoice_from_appointment(
        &self,
        context: &RequestContext,
        appointment_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:invoices", "create:invoices", "admin:*"])?;
        let appointment = self
            .finance
            .find_appointment(&context.salon_id, appointment_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
        if !branch_allowed(context, &appointment.branch_id) {
            return Err(AppError::Authorization);
        }
        if let Some(existing) = self
            .finance
            .find_invoice_by_appointment(&context.salon_id, appointment_id)
            .await?
        {
            return Ok(serde_json::json!({ "invoice": invoice_brief_json(&existing) }));
        }
        let gross_value = appointment.value;
        let (_gstin, _place_of_supply, rate_bps, prices_include_tax) =
            self.finance.load_tax_settings(&context.salon_id).await?;
        let tax_paise = if prices_include_tax {
            let subtotal = rounded_div(gross_value, 10000 + rate_bps, 10000);
            gross_value - subtotal
        } else {
            (gross_value * rate_bps) / 10000
        };
        let net_paise = gross_value - tax_paise;
        let grand_total_paise = if prices_include_tax {
            gross_value
        } else {
            gross_value + tax_paise
        };
        let invoice_date = DateTime::now().try_to_rfc3339_string().unwrap_or_default();
        let invoice_number = format!(
            "{}-{}-{}",
            appointment.branch_id,
            invoice_date[..10].replace('-', ""),
            &appointment.id.to_hex()[6..12].to_uppercase()
        );
        let invoice = InvoiceRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: appointment.branch_id.clone(),
            customer_id: appointment.customer_id.clone().unwrap_or_default(),
            appointment_id: appointment.id.to_hex(),
            invoice_number,
            status: "issued".to_string(),
            payment_status: "unpaid".to_string(),
            currency: "INR".to_string(),
            lines: vec![InvoiceLineRecord {
                service_id: String::new(),
                product_id: String::new(),
                description: {
                    let joined = appointment.service_names.join(", ");
                    let joined = joined.trim();
                    if joined.is_empty() {
                        "Service".to_string()
                    } else {
                        joined.chars().take(240).collect::<String>()
                    }
                },
                quantity: 1,
                unit_amount_paise: net_paise,
                tax_rate_bps: rate_bps,
                total_paise: gross_value,
            }],
            subtotal_paise: net_paise,
            tax_paise,
            grand_total_paise,
            paid_amount_paise: 0,
            due_amount_paise: grand_total_paise,
            payments: Vec::new(),
            void_reason: String::new(),
            issued_at: Some(DateTime::now()),
            created_at: Some(DateTime::now()),
            updated_at: Some(DateTime::now()),
        };
        let created = self
            .finance
            .upsert_invoice_from_appointment(&context.salon_id, &invoice)
            .await?;
        Ok(serde_json::json!({ "invoice": invoice_brief_json(&created) }))
    }

    pub async fn tax_settings(
        &self,
        context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:settings", "read:finance", "admin:*"])?;
        let (gstin, place_of_supply, rate, prices_include_tax) =
            self.finance.load_tax_settings(&context.salon_id).await?;
        Ok(tax_settings_json(
            &gstin,
            &place_of_supply,
            rate,
            prices_include_tax,
        ))
    }

    pub async fn update_tax_settings(
        &self,
        context: &RequestContext,
        request: TaxSettingsUpdate,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*", "update:settings"])?;
        let mut gstin = request.gstin.trim().to_string();
        if gstin.len() > 15 {
            return Err(AppError::Validation(
                "gstin must be at most 15 characters.".to_string(),
            ));
        }
        let mut place_of_supply = request.place_of_supply.trim().to_string();
        if place_of_supply.len() > 120 {
            return Err(AppError::Validation(
                "placeOfSupply must be at most 120 characters.".to_string(),
            ));
        }
        let rate = request.default_tax_rate_bps.clamp(0, 10000);
        gstin = gstin.to_uppercase();
        place_of_supply = place_of_supply.to_uppercase();
        let tax_doc = mongodb::bson::to_document(&serde_json::json!({
            "gstin": gstin,
            "placeOfSupply": place_of_supply,
            "defaultTaxRateBps": rate,
            "pricesIncludeTax": request.prices_include_tax,
        }))
        .map_err(|_| AppError::Validation("Invalid tax settings.".to_string()))?;
        self.finance
            .update_tax_settings(&context.salon_id, &context.user_id, &tax_doc)
            .await?;
        self.audit(
            context,
            "tax_settings.update",
            "settings",
            "tax",
            serde_json::json!({
                "gstin": gstin,
                "placeOfSupply": place_of_supply,
                "defaultTaxRateBps": rate,
                "pricesIncludeTax": request.prices_include_tax,
            }),
        )
        .await;
        let (gstin, place_of_supply, rate, prices_include_tax) =
            self.finance.load_tax_settings(&context.salon_id).await?;
        Ok(tax_settings_json(
            &gstin,
            &place_of_supply,
            rate,
            prices_include_tax,
        ))
    }

    pub async fn expenses(
        &self,
        context: &RequestContext,
        query: ExpenseQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:expenses", "read:finance", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let limit = query.limit.unwrap_or(50).clamp(1, 200);
        let offset = query.offset.unwrap_or(0).max(0);
        validate_date(&query.from_date)?;
        validate_date(&query.to_date)?;
        let (total, docs) = self
            .finance
            .list_expenses(
                &context.salon_id,
                &branch_ids,
                &query.from_date,
                &query.to_date,
                &query.category,
                limit,
                offset,
            )
            .await?;
        let items: Vec<_> = docs
            .into_iter()
            .map(|expense| expense_json(&expense))
            .collect();
        let has_more = (offset + items.len() as i64) < total as i64;
        Ok(serde_json::json!({
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "page": { "total": total, "limit": limit, "offset": offset, "hasMore": has_more },
            "metadata": { "moneyUnit": "paise", "branchIds": branch_ids }
        }))
    }

    pub async fn create_expense(
        &self,
        context: &RequestContext,
        request: ExpenseWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:expenses", "create:expenses", "admin:*"])?;
        let expense = self.prepare_expense(context, &request)?;
        if !branch_allowed(context, &expense.branch_id) {
            return Err(AppError::Authorization);
        }
        validate_date(&expense.date)?;
        let created = self.finance.create_expense(&expense).await?;
        self.audit(
            context,
            "expense.create",
            "expense",
            &created.id.to_hex(),
            serde_json::json!({ "branchId": created.branch_id, "amountPaise": created.amount_paise, "category": created.category }),
        )
        .await;
        Ok(serde_json::json!({ "expense": expense_json(&created) }))
    }

    pub async fn update_expense(
        &self,
        context: &RequestContext,
        expense_id: &str,
        request: ExpenseWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:expenses", "update:expenses", "admin:*"])?;
        let expense = self.prepare_expense(context, &request)?;
        if !branch_allowed(context, &expense.branch_id) {
            return Err(AppError::Authorization);
        }
        validate_date(&expense.date)?;
        let id = parse_object_id(expense_id, "expense")?;
        let updated = self
            .finance
            .update_expense(&context.salon_id, id, &expense)
            .await?
            .ok_or_else(|| AppError::NotFound("Expense was not found.".to_string()))?;
        self.audit(
            context,
            "expense.update",
            "expense",
            &updated.id.to_hex(),
            serde_json::json!({ "branchId": updated.branch_id }),
        )
        .await;
        Ok(serde_json::json!({ "expense": expense_json(&updated) }))
    }

    pub async fn delete_expense(
        &self,
        context: &RequestContext,
        expense_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["write:expenses", "delete:expenses", "admin:*"])?;
        let id = parse_object_id(expense_id, "expense")?;
        let deleted = self
            .finance
            .delete_expense(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Expense was not found.".to_string()))?;
        self.audit(
            context,
            "expense.delete",
            "expense",
            &deleted.id.to_hex(),
            serde_json::json!({}),
        )
        .await;
        Ok(serde_json::json!({ "id": deleted.id.to_hex() }))
    }

    pub async fn gst_report(
        &self,
        context: &RequestContext,
        query: GstReportQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:expenses", "read:finance", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        validate_date(&query.from_date)?;
        validate_date(&query.to_date)?;
        let invoices = self
            .finance
            .gst_issued_invoices(
                &context.salon_id,
                &branch_ids,
                &query.from_date,
                &query.to_date,
            )
            .await?;
        let (expense_count, total_expense_amount, input_tax_paise) = self
            .finance
            .expense_gst_aggregate(
                &context.salon_id,
                &branch_ids,
                &query.from_date,
                &query.to_date,
            )
            .await?;
        let (gstin, place_of_supply, _rate, _prices_include_tax) =
            self.finance.load_tax_settings(&context.salon_id).await?;
        let mut total_tax_paise: i64 = 0;
        let mut total_collected_paise: i64 = 0;
        let mut by_rate: std::collections::BTreeMap<i64, (i64, i64)> = Default::default();
        for invoice in &invoices {
            total_tax_paise += invoice.tax_paise;
            total_collected_paise += invoice.paid_amount_paise;
            for line in &invoice.lines {
                let rate = line.tax_rate_bps;
                let taxable = line.unit_amount_paise * line.quantity;
                let entry = by_rate.entry(rate).or_insert((0, 0));
                entry.0 += taxable;
                entry.1 += (taxable * rate) / 10000;
            }
        }
        let net_payable = (total_tax_paise - input_tax_paise).max(0);
        let intra_state = place_of_supply.is_empty();
        let half = total_tax_paise / 2;
        let rate_breakdown: Vec<_> = by_rate
            .into_iter()
            .map(|(rate_bps, (taxable, tax))| {
                serde_json::json!({ "rateBps": rate_bps, "taxablePaise": taxable, "taxPaise": tax })
            })
            .collect();
        let taxable_value: i64 = rate_breakdown
            .iter()
            .filter_map(|r| r.get("taxablePaise").and_then(|v| v.as_i64()))
            .sum();
        Ok(serde_json::json!({
            "gstin": gstin,
            "placeOfSupply": place_of_supply,
            "fromDate": query.from_date,
            "toDate": query.to_date,
            "taxableValuePaise": taxable_value,
            "outputTaxPaise": total_tax_paise,
            "inputCreditPaise": input_tax_paise,
            "netGstPayablePaise": net_payable,
            "collection": { "invoiceCount": invoices.len(), "totalCollectedPaise": total_collected_paise },
            "liability": if intra_state {
                serde_json::json!({ "type": "intra-state", "cgstPaise": half, "sgstPaise": half, "igstPaise": 0 })
            } else {
                serde_json::json!({ "type": "inter-state", "cgstPaise": 0, "sgstPaise": 0, "igstPaise": total_tax_paise })
            },
            "expenses": { "count": expense_count, "totalExpenseAmountPaise": total_expense_amount, "inputTaxPaise": input_tax_paise },
            "rateBreakdown": rate_breakdown
        }))
    }

    pub async fn purchase_orders(
        &self,
        context: &RequestContext,
        query: PurchaseOrderQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:inventory", "read:operations", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let status = query.status.trim().to_string();
        if !status.is_empty() && status != "all" && !PO_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                PO_STATUSES.join(", ")
            )));
        }
        let docs = self
            .finance
            .list_purchase_orders(&context.salon_id, &branch_ids, &status, 200)
            .await?;
        let items: Vec<_> = docs.iter().map(purchase_order_json).collect();
        Ok(serde_json::json!({
            "items": items,
            "metadata": { "moneyUnit": "paise", "branchIds": branch_ids }
        }))
    }

    pub async fn create_purchase_order(
        &self,
        context: &RequestContext,
        request: PurchaseOrderWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(
            context,
            &["write:inventory", "create:operations", "admin:*"],
        )?;
        if !branch_allowed(context, &request.branch_id) {
            return Err(AppError::Authorization);
        }
        let supplier_name = request.supplier_name.trim().to_string();
        if supplier_name.is_empty() || supplier_name.len() > 180 {
            return Err(AppError::Validation(
                "supplierName must be between 1 and 180 characters.".to_string(),
            ));
        }
        let supplier_phone = request.supplier_phone.trim().to_string();
        if supplier_phone.len() > 32 {
            return Err(AppError::Validation(
                "supplierPhone must be at most 32 characters.".to_string(),
            ));
        }
        let notes = request.notes.trim().to_string();
        if notes.len() > 800 {
            return Err(AppError::Validation(
                "notes must be at most 800 characters.".to_string(),
            ));
        }
        let tax_paise = request.tax_paise.max(0);
        if request.lines.is_empty() {
            return Err(AppError::Validation(
                "lines must contain at least one item.".to_string(),
            ));
        }
        let mut lines = Vec::with_capacity(request.lines.len());
        let mut subtotal_paise: i64 = 0;
        for input in &request.lines {
            let item_name = input.item_name.trim().to_string();
            if item_name.is_empty() || item_name.len() > 180 {
                return Err(AppError::Validation(
                    "itemName must be between 1 and 180 characters.".to_string(),
                ));
            }
            let sku = input.sku.trim().to_string();
            if sku.len() > 80 {
                return Err(AppError::Validation(
                    "sku must be at most 80 characters.".to_string(),
                ));
            }
            let quantity = input.quantity.clamp(1, 10000);
            let unit_cost = input.unit_cost_paise.max(0);
            let total = quantity.saturating_mul(unit_cost);
            subtotal_paise = subtotal_paise.saturating_add(total);
            lines.push(PurchaseOrderLineRecord {
                item_name,
                sku,
                quantity,
                unit_cost_paise: unit_cost,
                total_paise: total,
            });
        }
        let expected_at = request
            .expected_at
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let po_number = format!(
            "{}-{}-{}",
            request.branch_id,
            DateTime::now()
                .try_to_rfc3339_string()
                .unwrap_or_default()
                .chars()
                .take(10)
                .collect::<String>()
                .replace('-', ""),
            chrono::Utc::now().timestamp_millis(),
        );
        let purchase_order = PurchaseOrderRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: request.branch_id.clone(),
            po_number: po_number.chars().take(80).collect(),
            supplier_name,
            supplier_phone,
            status: "draft".to_string(),
            expected_at,
            lines,
            subtotal_paise,
            tax_paise,
            total_paise: subtotal_paise + tax_paise,
            notes,
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let created = self.finance.create_purchase_order(&purchase_order).await?;
        self.audit(
            context,
            "purchase_order.create",
            "purchase_order",
            &created.id.to_hex(),
            serde_json::json!({ "poNumber": created.po_number }),
        )
        .await;
        Ok(serde_json::json!({
            "purchaseOrder": { "id": created.id.to_hex(), "poNumber": created.po_number, "status": created.status, "totalPaise": created.total_paise }
        }))
    }

    pub async fn update_purchase_order_status(
        &self,
        context: &RequestContext,
        purchase_order_id: &str,
        request: PurchaseOrderStatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(
            context,
            &["write:inventory", "update:operations", "admin:*"],
        )?;
        let status = request.status.trim().to_string();
        if !PO_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                PO_STATUSES.join(", ")
            )));
        }
        let id = parse_object_id(purchase_order_id, "purchase order")?;
        let branch_ids = context.branch_ids.clone();
        let updated = self
            .finance
            .update_purchase_order_status(&context.salon_id, &branch_ids, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Purchase order not found.".to_string()))?;
        self.audit(
            context,
            "purchase_order.status",
            "purchase_order",
            &updated.id.to_hex(),
            serde_json::json!({ "status": updated.status }),
        )
        .await;
        Ok(serde_json::json!({ "id": updated.id.to_hex(), "status": updated.status }))
    }

    pub async fn gift_cards(
        &self,
        context: &RequestContext,
        query: GiftCardQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "read:clients", "admin:*"])?;
        let status = query.status.clone().unwrap_or_default().trim().to_string();
        if !status.is_empty() && status != "all" && !GIFT_CARD_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                GIFT_CARD_STATUSES.join(", ")
            )));
        }
        let docs = self
            .finance
            .list_gift_cards(&context.salon_id, &status, 200)
            .await?;
        let items: Vec<_> = docs.iter().map(gift_card_json).collect();
        Ok(serde_json::json!({ "items": items }))
    }

    pub async fn create_gift_card(
        &self,
        context: &RequestContext,
        request: GiftCardWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let initial_value_paise = request.initial_value_paise;
        if initial_value_paise < 1 {
            return Err(AppError::Validation(
                "initialValuePaise must be at least 1.".to_string(),
            ));
        }
        for (name, value, max) in [
            ("purchaserName", &request.purchaser_name, 160),
            ("recipientName", &request.recipient_name, 160),
            ("recipientPhone", &request.recipient_phone, 32),
        ] {
            if value.len() > max {
                return Err(AppError::Validation(format!(
                    "{name} must be at most {max} characters."
                )));
            }
        }
        let expires_at = request
            .expires_at
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let now = chrono::Utc::now();
        let code = format!(
            "GC{}",
            format!("{:X}", now.timestamp_millis())
                .chars()
                .take(6)
                .collect::<String>()
        );
        let gift_card = GiftCardRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            code,
            purchaser_name: request.purchaser_name.trim().to_string(),
            recipient_name: request.recipient_name.trim().to_string(),
            recipient_phone: request.recipient_phone.trim().to_string(),
            initial_value_paise,
            balance_paise: initial_value_paise,
            expires_at,
            status: "active".to_string(),
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let created = self.finance.create_gift_card(&gift_card).await?;
        self.audit(
            context,
            "gift_card.create",
            "gift_card",
            &created.id.to_hex(),
            serde_json::json!({ "code": created.code, "initialValuePaise": created.initial_value_paise }),
        )
        .await;
        Ok(serde_json::json!({
            "giftCard": { "id": created.id.to_hex(), "code": created.code, "status": created.status, "balancePaise": created.balance_paise }
        }))
    }

    pub async fn update_gift_card_status(
        &self,
        context: &RequestContext,
        gift_card_id: &str,
        request: GiftCardStatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let status = request.status.trim().to_string();
        if !GIFT_CARD_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                GIFT_CARD_STATUSES.join(", ")
            )));
        }
        let id = parse_object_id(gift_card_id, "gift card")?;
        let updated = self
            .finance
            .update_gift_card_status(&context.salon_id, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Gift card not found.".to_string()))?;
        self.audit(
            context,
            "gift_card.status",
            "gift_card",
            &updated.id.to_hex(),
            serde_json::json!({ "status": updated.status }),
        )
        .await;
        Ok(serde_json::json!({ "id": updated.id.to_hex(), "status": updated.status }))
    }

    pub async fn redeem_gift_card(
        &self,
        context: &RequestContext,
        gift_card_id: &str,
        request: GiftCardRedeemRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*", "read:billing", "update:clients"])?;
        let amount_paise = request.amount_paise;
        if amount_paise < 1 {
            return Err(AppError::Validation(
                "amountPaise must be at least 1.".to_string(),
            ));
        }
        let reference = request.reference.trim().to_string();
        if reference.len() > 120 {
            return Err(AppError::Validation(
                "reference must be at most 120 characters.".to_string(),
            ));
        }
        let id = parse_object_id(gift_card_id, "gift card")?;
        let gift_card = self
            .finance
            .find_active_gift_card(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Active gift card not found.".to_string()))?;
        if amount_paise > gift_card.balance_paise {
            return Err(AppError::Validation(
                "Redemption exceeds gift card balance.".to_string(),
            ));
        }
        let new_balance_paise = gift_card.balance_paise - amount_paise;
        let set_redeemed = new_balance_paise == 0;
        let updated = self
            .finance
            .redeem_gift_card(id, new_balance_paise, set_redeemed)
            .await?
            .ok_or_else(|| AppError::NotFound("Gift card not found.".to_string()))?;
        self.audit(
            context,
            "gift_card.redeem",
            "gift_card",
            &updated.id.to_hex(),
            serde_json::json!({ "amountPaise": amount_paise, "reference": request.reference }),
        )
        .await;
        Ok(serde_json::json!({
            "giftCard": { "id": updated.id.to_hex(), "code": updated.code, "balancePaise": updated.balance_paise, "status": updated.status }
        }))
    }

    pub async fn bundle_deals(
        &self,
        context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "read:clients", "admin:*"])?;
        let docs = self
            .finance
            .list_bundle_deals(&context.salon_id, 200)
            .await?;
        let items: Vec<_> = docs.iter().map(bundle_deal_json).collect();
        Ok(serde_json::json!({ "items": items }))
    }

    pub async fn create_bundle_deal(
        &self,
        context: &RequestContext,
        request: BundleDealWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let name = request.name.trim().to_string();
        if name.is_empty() || name.len() > 160 {
            return Err(AppError::Validation(
                "name must be between 1 and 160 characters.".to_string(),
            ));
        }
        let description = request.description.trim().to_string();
        if description.len() > 600 {
            return Err(AppError::Validation(
                "description must be at most 600 characters.".to_string(),
            ));
        }
        if request.items.is_empty() {
            return Err(AppError::Validation(
                "items must contain at least one service.".to_string(),
            ));
        }
        let mut items = Vec::with_capacity(request.items.len());
        for input in &request.items {
            let service_id = input.service_id.trim().to_string();
            if service_id.is_empty() {
                return Err(AppError::Validation(
                    "serviceId is required for every item.".to_string(),
                ));
            }
            items.push(BundleDealItemRecord {
                service_id,
                quantity: input.quantity.clamp(1, 50),
            });
        }
        let price_paise = request.price_paise.max(0);
        let starts_at = request
            .starts_at
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let expires_at = request
            .expires_at
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let bundle_deal = BundleDealRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            name,
            description,
            items,
            price_paise,
            status: "active".to_string(),
            starts_at,
            expires_at,
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let created = self.finance.create_bundle_deal(&bundle_deal).await?;
        self.audit(
            context,
            "bundle.create",
            "bundle",
            &created.id.to_hex(),
            serde_json::json!({ "pricePaise": created.price_paise }),
        )
        .await;
        Ok(serde_json::json!({
            "bundle": { "id": created.id.to_hex(), "name": created.name, "status": created.status, "pricePaise": created.price_paise }
        }))
    }

    pub async fn update_bundle_deal_status(
        &self,
        context: &RequestContext,
        bundle_id: &str,
        request: BundleDealStatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let status = request.status.trim().to_string();
        if !BUNDLE_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                BUNDLE_STATUSES.join(", ")
            )));
        }
        let id = parse_object_id(bundle_id, "bundle")?;
        let updated = self
            .finance
            .update_bundle_deal_status(&context.salon_id, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Bundle not found.".to_string()))?;
        self.audit(
            context,
            "bundle.status",
            "bundle",
            &updated.id.to_hex(),
            serde_json::json!({ "status": updated.status }),
        )
        .await;
        Ok(serde_json::json!({ "id": updated.id.to_hex(), "status": updated.status }))
    }

    pub async fn promos(
        &self,
        context: &RequestContext,
        query: PromoQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "read:clients", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(25).clamp(1, 100);
        let (items, total) = self
            .finance
            .list_promos(
                &context.salon_id,
                query.kind.as_deref(),
                query.status.as_deref(),
                query.search.as_deref(),
                &branch_ids,
                page,
                page_size,
            )
            .await?;
        Ok(serde_json::json!({
            "items": items.iter().map(promo_json).collect::<Vec<_>>(),
            "page": { "number": page, "size": page_size, "totalElements": total }
        }))
    }

    pub async fn create_promo(
        &self,
        context: &RequestContext,
        request: PromoWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let kind = request.kind.trim().to_lowercase();
        if !PROMO_KINDS.contains(&kind.as_str()) {
            return Err(AppError::Validation(format!(
                "kind must be one of: {}.",
                PROMO_KINDS.join(", ")
            )));
        }
        let label = request.label.trim().to_string();
        if label.is_empty() || label.len() > 120 {
            return Err(AppError::Validation(
                "label must be between 1 and 120 characters.".to_string(),
            ));
        }
        let discount_type = request.discount_type.trim().to_lowercase();
        if !["percent", "fixed"].contains(&discount_type.as_str()) {
            return Err(AppError::Validation(
                "discountType must be percent or fixed.".to_string(),
            ));
        }
        let discount_percent = request.discount_percent.filter(|v| *v > 0);
        let discount_paise = request.discount_paise.filter(|v| *v > 0);
        if discount_type == "percent" && discount_percent.unwrap_or(0) > 100 {
            return Err(AppError::Validation(
                "discountPercent must be between 1 and 100.".to_string(),
            ));
        }
        if discount_type == "percent" && discount_percent.is_none() {
            return Err(AppError::Validation(
                "discountPercent is required.".to_string(),
            ));
        }
        if discount_type == "fixed" && discount_paise.is_none() {
            return Err(AppError::Validation(
                "discountPaise is required.".to_string(),
            ));
        }
        let generated_code;
        let code_source = if request.code.trim().is_empty() {
            generated_code = format!(
                "{}{}",
                kind.chars().next().unwrap_or('P'),
                ObjectId::new().to_hex()
            );
            generated_code.as_str()
        } else {
            request.code.as_str()
        };
        let code = normalize_code(code_source);
        if code.len() < 4 || code.len() > 24 {
            return Err(AppError::Validation(
                "code must be between 4 and 24 characters.".to_string(),
            ));
        }
        if self
            .finance
            .promo_code_exists(&context.salon_id, &code)
            .await?
        {
            return Err(AppError::Conflict("Promo code already exists.".to_string()));
        }
        let starts_at = request
            .starts_at
            .as_deref()
            .filter(|v| !v.is_empty())
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let expires_at = request
            .expires_at
            .as_deref()
            .filter(|v| !v.is_empty())
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let promo = PromoCodeRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            kind,
            code,
            label,
            description: request.description.trim().to_string(),
            discount_type,
            discount_percent,
            discount_paise,
            minimum_spend_paise: request.minimum_spend_paise.max(0),
            max_redemptions: request.max_redemptions.filter(|v| *v > 0),
            starts_at,
            expires_at,
            any_branch: request.any_branch || request.branch_ids.is_empty(),
            branch_ids: request.branch_ids,
            status: "active".to_string(),
            redemption_count: 0,
            total_discount_paise: 0,
            referrer_reward_type: request.referrer_reward_type,
            referrer_reward_percent: request.referrer_reward_percent,
            referrer_reward_paise: request.referrer_reward_paise,
            created_by: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let created = self.finance.create_promo(&promo).await?;
        self.audit(
            context,
            "promo.create",
            "promo_code",
            &created.id.to_hex(),
            serde_json::json!({ "code": created.code, "kind": created.kind }),
        )
        .await;
        Ok(serde_json::json!({ "promo": promo_json(&created) }))
    }

    pub async fn promo_redemptions(
        &self,
        context: &RequestContext,
        promo_id: &str,
        query: PromoRedemptionQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "read:clients", "admin:*"])?;
        let id = parse_object_id(promo_id, "promo")?;
        self.finance
            .find_promo_by_id(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Promo not found.".to_string()))?;
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(25).clamp(1, 100);
        let (items, total) = self
            .finance
            .list_promo_redemptions(&context.salon_id, promo_id, page, page_size)
            .await?;
        Ok(serde_json::json!({
            "items": items.iter().map(promo_redemption_json).collect::<Vec<_>>(),
            "page": { "number": page, "size": page_size, "totalElements": total }
        }))
    }

    pub async fn update_promo_status(
        &self,
        context: &RequestContext,
        promo_id: &str,
        request: PromoStatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let status = request.status.trim().to_lowercase();
        if !PROMO_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                PROMO_STATUSES.join(", ")
            )));
        }
        let id = parse_object_id(promo_id, "promo")?;
        let updated = self
            .finance
            .set_promo_status(&context.salon_id, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Promo not found.".to_string()))?;
        self.audit(
            context,
            "promo.status",
            "promo_code",
            &updated.id.to_hex(),
            serde_json::json!({ "status": updated.status }),
        )
        .await;
        Ok(serde_json::json!({ "id": updated.id.to_hex(), "status": updated.status }))
    }

    pub async fn redeem_promo(
        &self,
        context: &RequestContext,
        request: PromoRedeemRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(
            context,
            &[
                "admin:*",
                "update:clients",
                "create:appointments",
                "update:appointments",
                "read:billing",
            ],
        )?;
        if !branch_allowed(context, &request.branch_id) {
            return Err(AppError::Authorization);
        }
        let code = normalize_code(&request.code);
        let mut promo = self
            .finance
            .find_promo_by_code(&context.salon_id, &code)
            .await?
            .ok_or_else(|| AppError::NotFound("Promo not found.".to_string()))?;
        ensure_promo_redeemable(&promo, &request.branch_id, request.subtotal_paise)?;
        let discount_paise = compute_discount_paise(&promo, request.subtotal_paise);
        if discount_paise < 1 {
            return Err(AppError::Validation(
                "Promo discount is not applicable.".to_string(),
            ));
        }
        let customer = if !request.customer_id.trim().is_empty() {
            self.finance
                .find_customer(&context.salon_id, &request.customer_id)
                .await?
        } else if !request.customer_phone.trim().is_empty() {
            self.finance
                .find_customer_by_phone(&context.salon_id, &request.customer_phone)
                .await?
        } else {
            None
        };
        let customer_name = customer.map(|c| c.name).unwrap_or_default();
        promo.redemption_count += 1;
        promo.total_discount_paise += discount_paise;
        if promo
            .max_redemptions
            .map(|max| promo.redemption_count >= max)
            .unwrap_or(false)
        {
            promo.status = "expired".to_string();
        }
        self.finance
            .update_promo_stats(
                promo.id,
                promo.redemption_count,
                promo.total_discount_paise,
                &promo.status,
            )
            .await?;
        let redemption = PromoRedemptionRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: request.branch_id,
            promo_id: promo.id.to_hex(),
            code: promo.code.clone(),
            customer_id: request.customer_id,
            customer_name,
            appointment_id: request.appointment_id,
            invoice_id: request.invoice_id,
            discount_paise,
            discount_percent: promo.discount_percent,
            applied_by_user_id: context.user_id.clone(),
            applied_at: Some(DateTime::now()),
        };
        let redemption = self.finance.create_promo_redemption(&redemption).await?;
        self.audit(
            context,
            "promo.redeem",
            "promo_code",
            &promo.id.to_hex(),
            serde_json::json!({ "code": promo.code, "discountPaise": discount_paise }),
        )
        .await;
        Ok(serde_json::json!({
            "promo": promo_json(&promo),
            "redemption": promo_redemption_json(&redemption),
            "discountPaise": discount_paise
        }))
    }

    pub async fn generate_payroll_run(
        &self,
        context: &RequestContext,
        request: PayrollGenerateRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        validate_date(&request.period_start)?;
        validate_date(&request.period_end)?;
        if !branch_allowed(context, &request.branch_id) {
            return Err(AppError::Authorization);
        }
        let start = parse_rfc3339_datetime(&format!("{}T00:00:00Z", request.period_start))?;
        let end = parse_rfc3339_datetime(&format!("{}T23:59:59Z", request.period_end))?;
        let staff = self
            .finance
            .list_staff_users(&context.salon_id, &request.branch_id)
            .await?;
        let minutes = self
            .finance
            .attendance_minutes_summary(&context.salon_id, start, end)
            .await?;
        let mut items = Vec::new();
        for user in staff {
            let staff_id = user.staff_id.unwrap_or_else(|| user.id.to_hex());
            let gross_minutes = *minutes.get(&staff_id).unwrap_or(&0);
            let gross_pay_paise = rounded_div(gross_minutes, 60, user.hourly_rate_paise.max(0));
            items.push(PayrollRunItemRecord {
                staff_id,
                gross_minutes,
                overtime_minutes: 0,
                gross_pay_paise,
                status: "draft".to_string(),
            });
        }
        let total_gross_pay_paise = items.iter().map(|i| i.gross_pay_paise).sum();
        let run = PayrollRunRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: request.branch_id,
            period_start: request.period_start,
            period_end: request.period_end,
            status: "draft".to_string(),
            items,
            total_gross_pay_paise,
            generated_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let run = self.finance.upsert_payroll_run(&run).await?;
        self.audit(
            context,
            "payroll.generate",
            "payroll_run",
            &run.id.to_hex(),
            serde_json::json!({ "branchId": run.branch_id, "periodStart": run.period_start, "periodEnd": run.period_end }),
        )
        .await;
        Ok(serde_json::json!({ "run": payroll_run_json(&run) }))
    }

    pub async fn payroll_runs(
        &self,
        context: &RequestContext,
        query: PayrollRunQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let branch_id = query.branch_id.as_deref();
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            if !branch_allowed(context, branch_id) {
                return Err(AppError::Authorization);
            }
        }
        let limit = query.limit.unwrap_or(25).clamp(1, 100);
        let offset = query.offset.unwrap_or(0).max(0);
        let (items, total) = self
            .finance
            .list_payroll_runs(&context.salon_id, branch_id, limit, offset)
            .await?;
        let has_more = offset + (items.len() as i64) < total as i64;
        Ok(serde_json::json!({
            "items": items.iter().map(payroll_run_json).collect::<Vec<_>>(),
            "page": { "total": total, "limit": limit, "offset": offset, "hasMore": has_more }
        }))
    }

    pub async fn payroll_run(
        &self,
        context: &RequestContext,
        run_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let id = parse_object_id(run_id, "payroll run")?;
        let run = self
            .finance
            .find_payroll_run(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Payroll run not found.".to_string()))?;
        if !branch_allowed(context, &run.branch_id) {
            return Err(AppError::Authorization);
        }
        Ok(serde_json::json!({ "run": payroll_run_json(&run) }))
    }

    pub async fn update_payroll_status(
        &self,
        context: &RequestContext,
        run_id: &str,
        request: PayrollStatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let status = request.status.trim().to_lowercase();
        if !PAYROLL_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "status must be one of: {}.",
                PAYROLL_STATUSES.join(", ")
            )));
        }
        let id = parse_object_id(run_id, "payroll run")?;
        let run = self
            .finance
            .update_payroll_run_status(&context.salon_id, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Payroll run not found.".to_string()))?;
        if !branch_allowed(context, &run.branch_id) {
            return Err(AppError::Authorization);
        }
        self.audit(
            context,
            "payroll.status",
            "payroll_run",
            &run.id.to_hex(),
            serde_json::json!({ "status": run.status }),
        )
        .await;
        Ok(serde_json::json!({ "run": payroll_run_json(&run) }))
    }

    pub async fn payroll_payslip_pdf(
        &self,
        context: &RequestContext,
        run_id: &str,
        staff_id: &str,
    ) -> Result<Vec<u8>, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let id = parse_object_id(run_id, "payroll run")?;
        let run = self
            .finance
            .find_payroll_run(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Payroll run not found.".to_string()))?;
        if !branch_allowed(context, &run.branch_id) {
            return Err(AppError::Authorization);
        }
        let item = run
            .items
            .iter()
            .find(|item| item.staff_id == staff_id)
            .ok_or_else(|| AppError::NotFound("Payroll item not found.".to_string()))?;
        let branch_name = self
            .finance
            .find_branch_name(&context.salon_id, &run.branch_id)
            .await?
            .unwrap_or_else(|| run.branch_id.clone());
        let title = format!("Payslip {} to {}", run.period_start, run.period_end);
        Ok(build_text_pdf(
            &title,
            &[
                (format!("Branch: {branch_name}"), 10, false, 0),
                (format!("Staff ID: {}", item.staff_id), 10, false, 0),
                (
                    format!("Gross minutes: {}", item.gross_minutes),
                    10,
                    false,
                    8,
                ),
                (
                    format!("Overtime minutes: {}", item.overtime_minutes),
                    10,
                    false,
                    0,
                ),
                (
                    format!("Gross pay (paise): {}", item.gross_pay_paise),
                    12,
                    true,
                    8,
                ),
                (format!("Status: {}", item.status), 10, false, 0),
            ],
        ))
    }

    pub async fn audit_logs(
        &self,
        context: &RequestContext,
        query: AuditLogQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:logs", "admin:*", "read:*"])?;
        let from = query
            .from
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let to = query
            .to
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
        let (total, docs) = self
            .finance
            .list_audit_logs(
                &context.salon_id,
                query.action.as_deref(),
                query.resource_type.as_deref(),
                query.actor_user_id.as_deref(),
                from,
                to,
                page,
                page_size,
            )
            .await?;
        let items: Vec<_> = docs.iter().map(audit_log_json).collect();
        let page_size_u64 = page_size as u64;
        let total_pages = (total + page_size_u64.saturating_sub(1)) / page_size_u64;
        Ok(serde_json::json!({
            "items": items,
            "page": {
                "number": page,
                "size": page_size,
                "totalElements": total,
                "totalPages": total_pages.max(1),
            }
        }))
    }

    pub async fn audit_log_csv(
        &self,
        context: &RequestContext,
        query: AuditLogExportQuery,
    ) -> Result<String, AppError> {
        require_owner(context)?;
        require_any(context, &["read:logs", "admin:*", "read:*"])?;
        let from = query
            .from
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let to = query
            .to
            .as_deref()
            .map(parse_rfc3339_datetime)
            .transpose()?;
        let docs = self
            .finance
            .export_audit_logs(&context.salon_id, from, to, 5000)
            .await?;
        self.audit(
            context,
            "audit.export",
            "audit_log",
            "",
            serde_json::json!({ "count": docs.len() }),
        )
        .await;
        let header = [
            "timestamp",
            "actorUserId",
            "actorRole",
            "action",
            "resourceType",
            "resourceId",
            "ip",
        ];
        let rows: Vec<String> = docs
            .iter()
            .map(|d| {
                [
                    d.created_at
                        .and_then(|dt| dt.try_to_rfc3339_string().ok())
                        .unwrap_or_default(),
                    d.actor_user_id.clone(),
                    d.actor_role.clone(),
                    d.action.clone(),
                    d.resource_type.clone(),
                    d.resource_id.clone(),
                    d.ip.clone(),
                ]
                .iter()
                .map(|cell| csv_escape(cell))
                .collect::<Vec<_>>()
                .join(",")
            })
            .collect();
        let mut csv = header.map(csv_escape).join(",");
        if !rows.is_empty() {
            csv.push('\n');
            csv.push_str(&rows.join("\n"));
        }
        Ok(csv)
    }

    async fn audit(
        &self,
        context: &RequestContext,
        action: &str,
        resource_type: &str,
        resource_id: &str,
        metadata: serde_json::Value,
    ) {
        let metadata_doc = match mongodb::bson::to_document(&metadata) {
            Ok(doc) => doc,
            Err(_) => mongodb::bson::Document::new(),
        };
        let record = AuditLogRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            actor_user_id: context.user_id.clone(),
            actor_role: context.role.clone(),
            action: action.to_string(),
            resource_type: resource_type.to_string(),
            resource_id: resource_id.to_string(),
            ip: context.ip.clone(),
            user_agent: context.user_agent.clone(),
            metadata: metadata_doc,
            created_at: Some(DateTime::now()),
        };
        if self.finance.create_audit_log(&record).await.is_err() {
            // Audit failures are best-effort and must not fail the operation.
        }
    }

    pub async fn write_audit(
        &self,
        context: &RequestContext,
        action: &str,
        resource_type: &str,
        resource_id: &str,
        metadata: serde_json::Value,
    ) -> Result<(), AppError> {
        let metadata_doc = match mongodb::bson::to_document(&metadata) {
            Ok(doc) => doc,
            Err(_) => mongodb::bson::Document::new(),
        };
        let record = AuditLogRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            actor_user_id: context.user_id.clone(),
            actor_role: context.role.clone(),
            action: action.to_string(),
            resource_type: resource_type.to_string(),
            resource_id: resource_id.to_string(),
            ip: context.ip.clone(),
            user_agent: context.user_agent.clone(),
            metadata: metadata_doc,
            created_at: Some(DateTime::now()),
        };
        self.finance.create_audit_log(&record).await?;
        Ok(())
    }

    fn prepare_expense(
        &self,
        context: &RequestContext,
        request: &ExpenseWrite,
    ) -> Result<ExpenseRecord, AppError> {
        let amount_paise = request.amount_paise.max(0);
        let rate_bps = request.tax_rate_bps.clamp(0, 10000).max(0);
        let tax_paise = (amount_paise * rate_bps) / 10000;
        let category = request.category.trim().to_string();
        if !EXPENSE_CATEGORIES.contains(&category.as_str()) {
            return Err(AppError::Validation(format!(
                "category must be one of: {}.",
                EXPENSE_CATEGORIES.join(", ")
            )));
        }
        let vendor = request.vendor.trim().to_string();
        if vendor.len() > 160 {
            return Err(AppError::Validation(
                "vendor must be at most 160 characters.".to_string(),
            ));
        }
        let description = request.description.trim().to_string();
        if description.len() > 300 {
            return Err(AppError::Validation(
                "description must be at most 300 characters.".to_string(),
            ));
        }
        let notes = request.notes.trim().to_string();
        if notes.len() > 600 {
            return Err(AppError::Validation(
                "notes must be at most 600 characters.".to_string(),
            ));
        }
        let date = request.date.trim().to_string();
        validate_date(&date)?;
        Ok(ExpenseRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: request.branch_id.clone(),
            date,
            category,
            vendor,
            description,
            amount_paise,
            tax_rate_bps: rate_bps,
            tax_paise,
            total_paise: amount_paise + tax_paise,
            notes,
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        })
    }
}

fn tax_settings_json(
    gstin: &str,
    place_of_supply: &str,
    rate: i64,
    prices_include_tax: bool,
) -> serde_json::Value {
    serde_json::json!({
        "gstin": gstin,
        "placeOfSupply": place_of_supply,
        "defaultTaxRateBps": rate,
        "pricesIncludeTax": prices_include_tax,
    })
}

fn dt_str(dt: Option<DateTime>) -> String {
    dt.and_then(|d| d.try_to_rfc3339_string().ok())
        .unwrap_or_default()
}

fn invoice_list_json(invoice: InvoiceRecord) -> serde_json::Value {
    serde_json::json!({
        "id": invoice.id.to_hex(),
        "invoiceNumber": invoice.invoice_number,
        "branchId": invoice.branch_id,
        "status": invoice.status,
        "paymentStatus": invoice.payment_status,
        "grandTotalPaise": invoice.grand_total_paise,
        "paidAmountPaise": invoice.paid_amount_paise,
        "dueAmountPaise": invoice.due_amount_paise,
        "createdAt": dt_str(invoice.created_at),
    })
}

fn invoice_brief_json(invoice: &InvoiceRecord) -> serde_json::Value {
    serde_json::json!({
        "id": invoice.id.to_hex(),
        "invoiceNumber": invoice.invoice_number,
        "status": invoice.status,
        "paymentStatus": invoice.payment_status,
        "grandTotalPaise": invoice.grand_total_paise,
        "paidAmountPaise": invoice.paid_amount_paise,
        "dueAmountPaise": invoice.due_amount_paise,
    })
}

fn invoice_summary_json(invoice: &InvoiceRecord) -> serde_json::Value {
    serde_json::json!({
        "invoice": {
            "id": invoice.id.to_hex(),
            "invoiceNumber": invoice.invoice_number,
            "status": invoice.status,
            "paymentStatus": invoice.payment_status,
            "grandTotalPaise": invoice.grand_total_paise,
            "paidAmountPaise": invoice.paid_amount_paise,
            "dueAmountPaise": invoice.due_amount_paise,
        }
    })
}

fn invoice_detail_json(
    invoice: &InvoiceRecord,
    branch_name: &str,
    customer_name: &str,
    tips: &[TipRecord],
) -> serde_json::Value {
    let items: Vec<_> = invoice
        .lines
        .iter()
        .map(|line| {
            serde_json::json!({
                "name": line.description,
                "type": if !line.service_id.is_empty() { "service" } else if !line.product_id.is_empty() { "product" } else { "line" },
                "quantity": line.quantity,
                "unitPricePaise": line.unit_amount_paise,
                "taxAmountPaise": (line.unit_amount_paise * line.quantity * line.tax_rate_bps) / 10000,
                "totalAmountPaise": line.total_paise,
            })
        })
        .collect();
    let payments: Vec<_> = invoice
        .payments
        .iter()
        .map(|p| {
            serde_json::json!({
                "method": p.method,
                "status": "paid",
                "reference": p.reference,
                "amountPaise": p.amount_paise,
                "paidAt": p.received_at.try_to_rfc3339_string().unwrap_or_default(),
                "createdAt": p.received_at.try_to_rfc3339_string().unwrap_or_default(),
            })
        })
        .collect();
    let tips_json: Vec<_> = tips
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id.to_hex(),
                "staffId": t.staff_id,
                "amountPaise": t.amount_paise,
                "method": t.method,
                "reference": t.reference,
                "createdAt": dt_str(t.created_at),
            })
        })
        .collect();
    serde_json::json!({
        "invoice": {
            "id": invoice.id.to_hex(),
            "invoiceNumber": invoice.invoice_number,
            "branchId": invoice.branch_id,
            "branchName": branch_name,
            "customerId": invoice.customer_id,
            "customerName": customer_name,
            "status": invoice.status,
            "paymentStatus": invoice.payment_status,
            "grandTotalPaise": invoice.grand_total_paise,
            "paidAmountPaise": invoice.paid_amount_paise,
            "dueAmountPaise": invoice.due_amount_paise,
            "currency": invoice.currency,
            "dueDate": "",
            "createdAt": dt_str(invoice.created_at),
            "finalizedAt": dt_str(invoice.issued_at),
        },
        "items": items,
        "taxes": [{ "id": "gst", "type": "GST", "rate": 0, "amountPaise": invoice.tax_paise }],
        "payments": payments,
        "tips": tips_json,
        "events": [],
        "capabilities": {
            "recordPayment": invoice.status != "void" && invoice.due_amount_paise > 0,
            "void": invoice.status != "void",
            "recordTip": invoice.status != "void",
        }
    })
}

fn invoice_summary(items: &[serde_json::Value]) -> serde_json::Value {
    let invoice_count = items.len();
    let billed_paise: i64 = items
        .iter()
        .filter_map(|i| i.get("grandTotalPaise").and_then(|v| v.as_i64()))
        .sum();
    let paid_paise: i64 = items
        .iter()
        .filter_map(|i| i.get("paidAmountPaise").and_then(|v| v.as_i64()))
        .sum();
    let outstanding_paise: i64 = items
        .iter()
        .filter_map(|i| i.get("dueAmountPaise").and_then(|v| v.as_i64()))
        .sum();
    serde_json::json!({
        "invoiceCount": invoice_count,
        "billedPaise": billed_paise,
        "paidPaise": paid_paise,
        "outstandingPaise": outstanding_paise,
        "overduePaise": 0,
    })
}

fn expense_json(expense: &ExpenseRecord) -> serde_json::Value {
    serde_json::json!({
        "id": expense.id.to_hex(),
        "branchId": expense.branch_id,
        "date": expense.date,
        "category": expense.category,
        "vendor": expense.vendor,
        "description": expense.description,
        "amountPaise": expense.amount_paise,
        "taxRateBps": expense.tax_rate_bps,
        "taxPaise": expense.tax_paise,
        "totalPaise": expense.total_paise,
        "notes": expense.notes,
        "createdAt": dt_str(expense.created_at),
    })
}

fn purchase_order_json(purchase_order: &PurchaseOrderRecord) -> serde_json::Value {
    serde_json::json!({
        "id": purchase_order.id.to_hex(),
        "branchId": purchase_order.branch_id,
        "poNumber": purchase_order.po_number,
        "supplierName": purchase_order.supplier_name,
        "supplierPhone": purchase_order.supplier_phone,
        "status": purchase_order.status,
        "expectedAt": dt_str(purchase_order.expected_at),
        "lines": purchase_order.lines.iter().map(|line| serde_json::json!({
            "itemName": line.item_name,
            "sku": line.sku,
            "quantity": line.quantity,
            "unitCostPaise": line.unit_cost_paise,
            "totalPaise": line.total_paise,
        })).collect::<Vec<_>>(),
        "subtotalPaise": purchase_order.subtotal_paise,
        "taxPaise": purchase_order.tax_paise,
        "totalPaise": purchase_order.total_paise,
        "notes": purchase_order.notes,
        "createdAt": dt_str(purchase_order.created_at),
    })
}

fn parse_rfc3339_datetime(value: &str) -> Result<DateTime, AppError> {
    DateTime::parse_rfc3339_str(value)
        .map_err(|_| AppError::Validation(format!("'{}' must be a valid RFC3339 datetime.", value)))
}

fn gift_card_json(gift_card: &GiftCardRecord) -> serde_json::Value {
    serde_json::json!({
        "id": gift_card.id.to_hex(),
        "code": gift_card.code,
        "purchaserName": gift_card.purchaser_name,
        "recipientName": gift_card.recipient_name,
        "recipientPhone": gift_card.recipient_phone,
        "initialValuePaise": gift_card.initial_value_paise,
        "balancePaise": gift_card.balance_paise,
        "expiresAt": dt_str(gift_card.expires_at),
        "status": gift_card.status,
        "createdAt": dt_str(gift_card.created_at),
    })
}

fn bundle_deal_json(bundle_deal: &BundleDealRecord) -> serde_json::Value {
    serde_json::json!({
        "id": bundle_deal.id.to_hex(),
        "name": bundle_deal.name,
        "description": bundle_deal.description,
        "items": bundle_deal.items.iter().map(|item| serde_json::json!({
            "serviceId": item.service_id,
            "quantity": item.quantity,
        })).collect::<Vec<_>>(),
        "pricePaise": bundle_deal.price_paise,
        "startsAt": dt_str(bundle_deal.starts_at),
        "expiresAt": dt_str(bundle_deal.expires_at),
        "status": bundle_deal.status,
        "createdAt": dt_str(bundle_deal.created_at),
    })
}

fn promo_json(promo: &PromoCodeRecord) -> serde_json::Value {
    serde_json::json!({
        "id": promo.id.to_hex(),
        "kind": promo.kind,
        "code": promo.code,
        "label": promo.label,
        "description": promo.description,
        "discountType": promo.discount_type,
        "discountPercent": promo.discount_percent,
        "discountPaise": promo.discount_paise,
        "minimumSpendPaise": promo.minimum_spend_paise,
        "maxRedemptions": promo.max_redemptions,
        "startsAt": dt_str(promo.starts_at),
        "expiresAt": dt_str(promo.expires_at),
        "anyBranch": promo.any_branch,
        "branchIds": promo.branch_ids,
        "status": promo.status,
        "redemptionCount": promo.redemption_count,
        "totalDiscountPaise": promo.total_discount_paise,
        "referrerRewardType": promo.referrer_reward_type,
        "referrerRewardPercent": promo.referrer_reward_percent,
        "referrerRewardPaise": promo.referrer_reward_paise,
        "createdBy": promo.created_by,
        "createdAt": dt_str(promo.created_at),
    })
}

fn promo_redemption_json(redemption: &PromoRedemptionRecord) -> serde_json::Value {
    serde_json::json!({
        "id": redemption.id.to_hex(),
        "branchId": redemption.branch_id,
        "promoId": redemption.promo_id,
        "code": redemption.code,
        "customerId": redemption.customer_id,
        "customerName": redemption.customer_name,
        "appointmentId": redemption.appointment_id,
        "invoiceId": redemption.invoice_id,
        "discountPaise": redemption.discount_paise,
        "discountPercent": redemption.discount_percent,
        "appliedByUserId": redemption.applied_by_user_id,
        "appliedAt": dt_str(redemption.applied_at),
    })
}

fn payroll_run_json(run: &PayrollRunRecord) -> serde_json::Value {
    serde_json::json!({
        "id": run.id.to_hex(),
        "branchId": run.branch_id,
        "periodStart": run.period_start,
        "periodEnd": run.period_end,
        "status": run.status,
        "items": run.items.iter().map(|item| serde_json::json!({
            "staffId": item.staff_id,
            "grossMinutes": item.gross_minutes,
            "overtimeMinutes": item.overtime_minutes,
            "grossPayPaise": item.gross_pay_paise,
            "status": item.status,
        })).collect::<Vec<_>>(),
        "totalGrossPayPaise": run.total_gross_pay_paise,
        "generatedByUserId": run.generated_by_user_id,
        "createdAt": dt_str(run.created_at),
    })
}

fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(24)
        .collect::<String>()
        .to_uppercase()
}

fn ensure_promo_redeemable(
    promo: &PromoCodeRecord,
    branch_id: &str,
    subtotal_paise: i64,
) -> Result<(), AppError> {
    if promo.status != "active" {
        return Err(AppError::Conflict("Promo is not active.".to_string()));
    }
    let now = DateTime::now();
    if promo.starts_at.map(|dt| dt > now).unwrap_or(false) {
        return Err(AppError::Conflict("Promo has not started.".to_string()));
    }
    if promo.expires_at.map(|dt| dt < now).unwrap_or(false) {
        return Err(AppError::Conflict("Promo has expired.".to_string()));
    }
    if promo
        .max_redemptions
        .map(|max| promo.redemption_count >= max)
        .unwrap_or(false)
    {
        return Err(AppError::Conflict(
            "Promo redemption limit reached.".to_string(),
        ));
    }
    if !promo.any_branch && !promo.branch_ids.iter().any(|id| id == branch_id) {
        return Err(AppError::Authorization);
    }
    if subtotal_paise < promo.minimum_spend_paise {
        return Err(AppError::Validation(
            "Subtotal does not meet the promo minimum spend.".to_string(),
        ));
    }
    Ok(())
}

fn compute_discount_paise(promo: &PromoCodeRecord, subtotal_paise: i64) -> i64 {
    if promo.discount_type == "percent" {
        (subtotal_paise.max(0) * promo.discount_percent.unwrap_or(0).clamp(0, 100)) / 100
    } else {
        promo.discount_paise.unwrap_or(0).min(subtotal_paise.max(0))
    }
}

fn escape_pdf_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn build_text_pdf(title: &str, lines: &[(String, i64, bool, i64)]) -> Vec<u8> {
    let page_width = 595;
    let page_height = 842;
    let mut y = page_height - 60;
    let mut parts = Vec::new();
    let mut emit = |text: &str, size: i64, bold: bool, y: &mut i64| {
        if *y < 50 {
            return;
        }
        let font = if bold { 2 } else { 1 };
        let clipped: String = text.chars().take(110).collect();
        parts.push(format!(
            "BT /F{font} {size} Tf 50 {} Td ({}) Tj ET",
            *y,
            escape_pdf_text(&clipped)
        ));
        *y -= ((size as f64) * 1.45).round() as i64;
    };
    emit(title, 16, true, &mut y);
    y -= 6;
    for (text, size, bold, gap_before) in lines {
        y -= *gap_before;
        emit(text, *size, *bold, &mut y);
    }
    let content = parts.join("\n");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"),
        format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>".to_string(),
    ];
    let mut pdf = "%PDF-1.4\n".to_string();
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, body));
    }
    let xref_offset = pdf.len();
    pdf.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

fn audit_log_json(audit_log: &AuditLogRecord) -> serde_json::Value {
    serde_json::json!({
        "id": audit_log.id.to_hex(),
        "actorUserId": audit_log.actor_user_id,
        "actorRole": audit_log.actor_role,
        "action": audit_log.action,
        "resourceType": audit_log.resource_type,
        "resourceId": audit_log.resource_id,
        "ip": audit_log.ip,
        "metadata": serde_json::to_value(&audit_log.metadata).unwrap_or_else(|_| serde_json::json!({})),
        "createdAt": dt_str(audit_log.created_at),
    })
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn validate_date(value: &str) -> Result<(), AppError> {
    let bytes = value.as_bytes();
    let valid = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "'{value}' must be a YYYY-MM-DD date."
        )))
    }
}

fn parse_object_id(id: &str, what: &str) -> Result<ObjectId, AppError> {
    ObjectId::parse_str(id).map_err(|_| AppError::Validation(format!("Invalid {what} id: {id}.")))
}

fn branch_scope(context: &RequestContext, requested: Option<&str>) -> Vec<String> {
    if let Some(branch_id) = requested.filter(|id| *id != "all") {
        return vec![branch_id.to_string()];
    }
    if context.branch_ids.is_empty() {
        vec![context.branch_id.clone()]
    } else {
        context.branch_ids.clone()
    }
}

fn branch_allowed(context: &RequestContext, branch_id: &str) -> bool {
    if context.branch_ids.is_empty() {
        context.branch_id == branch_id
    } else {
        context.branch_ids.iter().any(|id| id == branch_id)
    }
}

fn rounded_div(numerator: i64, denominator: i64, unit: i64) -> i64 {
    (numerator.saturating_mul(unit) + denominator / 2) / denominator
}

fn require_owner(context: &RequestContext) -> Result<(), AppError> {
    let role = context.role.replace(['_', '-', ' '], "").to_lowercase();
    if ["owner", "admin", "superadmin"].contains(&role.as_str()) {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn require_any(context: &RequestContext, permissions: &[&str]) -> Result<(), AppError> {
    if permissions
        .iter()
        .any(|p| has_permission(&context.permissions, p))
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}
