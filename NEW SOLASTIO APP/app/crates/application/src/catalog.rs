use mongodb::bson::{doc, oid::ObjectId};
use serde::Deserialize;
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{BranchHoursRecord, BranchRecord, CustomerRecord, ServiceRecord},
    repositories::CatalogRepository,
};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct CatalogService {
    catalog: CatalogRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBranchRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceQuery {
    #[serde(default, rename = "branchId")]
    pub branch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceRequest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub branch_ids: Vec<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub price_paise: i64,
    pub duration_minutes: i64,
    #[serde(default)]
    pub eligible_staff_ids: Vec<String>,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServiceRequest {
    #[serde(default)]
    pub branch_ids: Option<Vec<String>>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub price_paise: Option<i64>,
    #[serde(default)]
    pub duration_minutes: Option<i64>,
    #[serde(default)]
    pub eligible_staff_ids: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerQuery {
    #[serde(default)]
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerRequest {
    pub branch_id: String,
    pub name: String,
    pub normalized_phone: String,
}

impl CatalogService {
    pub fn new(catalog: CatalogRepository) -> Self {
        Self { catalog }
    }

    pub async fn branches(&self, context: &RequestContext) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "admin:*"])?;
        let branches: Vec<_> = self
            .catalog
            .list_branches(&context.salon_id)
            .await?
            .into_iter()
            .map(branch_json)
            .collect();
        Ok(serde_json::json!(branches))
    }

    pub async fn create_branch(
        &self,
        context: &RequestContext,
        request: CreateBranchRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:branches", "update:branches", "admin:*"])?;
        let name = request.name.trim();
        if name.is_empty() || name.chars().count() > 160 {
            return Err(AppError::Validation(
                "Branch name must be between 1 and 160 characters.".to_string(),
            ));
        }
        let id = match request.id {
            Some(id) if !id.trim().is_empty() => {
                if id.chars().count() > 80 {
                    return Err(AppError::Validation(
                        "Branch id must be at most 80 characters.".to_string(),
                    ));
                }
                id.to_string()
            }
            _ => format!("{}_{}", context.salon_id, slugify(name)),
        };
        let branch = BranchRecord {
            id,
            salon_id: context.salon_id.clone(),
            name: name.to_string(),
            timezone: request
                .timezone
                .unwrap_or_else(|| "Asia/Kolkata".to_string()),
            status: "active".to_string(),
            hours: default_hours(),
            slot_interval_minutes: 30,
        };
        let created = self.catalog.upsert_branch(&branch).await?;
        Ok(branch_json(created))
    }

    pub async fn admin_branches(
        &self,
        context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "admin:*"])?;
        let items = self
            .catalog
            .list_branches(&context.salon_id)
            .await?
            .into_iter()
            .map(branch_json)
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "items": items,
            "capabilities": { "create": true, "update": true, "deactivate": true, "hardDelete": false, "creatorAssignment": true },
            "availability": {}
        }))
    }

    pub async fn admin_create_branch(
        &self,
        context: &RequestContext,
        request: CreateBranchRequest,
    ) -> Result<serde_json::Value, AppError> {
        let branch = self.create_branch(context, request).await?;
        Ok(serde_json::json!({
            "branch": branch,
            "creatorAssigned": true,
            "requiresReauthentication": false
        }))
    }

    pub async fn admin_update_branch(
        &self,
        context: &RequestContext,
        branch_id: &str,
        request: UpdateBranchRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:branches", "update:branches", "admin:*"])?;
        let mut update = doc! {};
        if let Some(name) = request
            .name
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            if name.chars().count() > 160 {
                return Err(AppError::Validation(
                    "Branch name must be at most 160 characters.".to_string(),
                ));
            }
            update.insert("name", name);
        }
        if let Some(timezone) = request
            .timezone
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            update.insert("timezone", timezone);
        }
        if update.is_empty() {
            return Err(AppError::Validation(
                "No branch fields to update.".to_string(),
            ));
        }
        let branch = self
            .catalog
            .update_branch(&context.salon_id, branch_id, update)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch not found.".to_string()))?;
        Ok(
            serde_json::json!({ "branch": branch_json(branch), "creatorAssigned": false, "requiresReauthentication": false }),
        )
    }

    pub async fn admin_update_branch_status(
        &self,
        context: &RequestContext,
        branch_id: &str,
        request: StatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:branches", "update:branches", "admin:*"])?;
        let status = request.status.trim().to_lowercase();
        if status != "active" && status != "inactive" {
            return Err(AppError::Validation(
                "status must be active or inactive.".to_string(),
            ));
        }
        let branch = self
            .catalog
            .update_branch_status(&context.salon_id, branch_id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch not found.".to_string()))?;
        Ok(
            serde_json::json!({ "branch": branch_json(branch), "creatorAssigned": false, "requiresReauthentication": false }),
        )
    }

    pub async fn services(
        &self,
        context: &RequestContext,
        query: ServiceQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "admin:*"])?;
        let services: Vec<_> = self
            .catalog
            .list_services(&context.salon_id, query.branch_id.as_deref())
            .await?
            .into_iter()
            .map(service_json)
            .collect();
        Ok(serde_json::json!(services))
    }

    pub async fn create_service(
        &self,
        context: &RequestContext,
        request: CreateServiceRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:services", "update:services", "admin:*"])?;
        let name = request.name.trim();
        if name.is_empty() || name.chars().count() > 160 {
            return Err(AppError::Validation(
                "Service name must be between 1 and 160 characters.".to_string(),
            ));
        }
        if request.price_paise < 0 {
            return Err(AppError::Validation(
                "pricePaise must be a non-negative integer.".to_string(),
            ));
        }
        if !(5..=600).contains(&request.duration_minutes) {
            return Err(AppError::Validation(
                "durationMinutes must be between 5 and 600.".to_string(),
            ));
        }
        if request.description.chars().count() > 1000 {
            return Err(AppError::Validation(
                "description must be at most 1000 characters.".to_string(),
            ));
        }
        let status = if request.status.is_empty() {
            "active".to_string()
        } else {
            request.status
        };
        if status != "active" && status != "inactive" {
            return Err(AppError::Validation(
                "status must be 'active' or 'inactive'.".to_string(),
            ));
        }
        let service = ServiceRecord {
            id: request
                .id
                .filter(|id| !id.trim().is_empty())
                .and_then(|id| ObjectId::parse_str(&id).ok())
                .unwrap_or_default(),
            salon_id: context.salon_id.clone(),
            branch_ids: request.branch_ids,
            category: String::new(),
            name: name.to_string(),
            description: request.description,
            price_paise: request.price_paise,
            duration_minutes: request.duration_minutes,
            eligible_staff_ids: request.eligible_staff_ids,
            status,
        };
        let created = self.catalog.upsert_service(&service).await?;
        Ok(service_json(created))
    }

    pub async fn admin_services(
        &self,
        context: &RequestContext,
        query: ServiceQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "admin:*"])?;
        let items = self
            .catalog
            .list_admin_services(&context.salon_id, query.branch_id.as_deref())
            .await?
            .into_iter()
            .map(service_json)
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "items": items,
            "capabilities": { "create": true, "update": true, "deactivate": true }
        }))
    }

    pub async fn admin_create_service(
        &self,
        context: &RequestContext,
        request: CreateServiceRequest,
    ) -> Result<serde_json::Value, AppError> {
        let service = self.create_service(context, request).await?;
        Ok(serde_json::json!({ "service": service }))
    }

    pub async fn admin_update_service(
        &self,
        context: &RequestContext,
        service_id: &str,
        request: UpdateServiceRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:services", "update:services", "admin:*"])?;
        let mut update = doc! {};
        if let Some(branch_ids) = request.branch_ids {
            update.insert("branchIds", branch_ids);
        }
        if let Some(name) = request
            .name
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            if name.chars().count() > 160 {
                return Err(AppError::Validation(
                    "Service name must be at most 160 characters.".to_string(),
                ));
            }
            update.insert("name", name);
        }
        if let Some(description) = request.description {
            if description.chars().count() > 1000 {
                return Err(AppError::Validation(
                    "description must be at most 1000 characters.".to_string(),
                ));
            }
            update.insert("description", description);
        }
        if let Some(price_paise) = request.price_paise {
            if price_paise < 0 {
                return Err(AppError::Validation(
                    "pricePaise must be a non-negative integer.".to_string(),
                ));
            }
            update.insert("pricePaise", price_paise);
        }
        if let Some(duration_minutes) = request.duration_minutes {
            if !(5..=600).contains(&duration_minutes) {
                return Err(AppError::Validation(
                    "durationMinutes must be between 5 and 600.".to_string(),
                ));
            }
            update.insert("durationMinutes", duration_minutes);
        }
        if let Some(eligible_staff_ids) = request.eligible_staff_ids {
            update.insert("eligibleStaffIds", eligible_staff_ids);
        }
        if let Some(status) = request.status {
            let status = status.trim().to_lowercase();
            if status != "active" && status != "inactive" {
                return Err(AppError::Validation(
                    "status must be active or inactive.".to_string(),
                ));
            }
            update.insert("status", status);
        }
        if update.is_empty() {
            return Err(AppError::Validation(
                "No service fields to update.".to_string(),
            ));
        }
        let id = parse_object_id(service_id, "service")?;
        let service = self
            .catalog
            .update_service(&context.salon_id, id, update)
            .await?
            .ok_or_else(|| AppError::NotFound("Service not found.".to_string()))?;
        Ok(serde_json::json!({ "service": service_json(service) }))
    }

    pub async fn admin_update_service_status(
        &self,
        context: &RequestContext,
        service_id: &str,
        request: StatusRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["create:services", "update:services", "admin:*"])?;
        let status = request.status.trim().to_lowercase();
        if status != "active" && status != "inactive" {
            return Err(AppError::Validation(
                "status must be active or inactive.".to_string(),
            ));
        }
        let id = parse_object_id(service_id, "service")?;
        let service = self
            .catalog
            .update_service_status(&context.salon_id, id, &status)
            .await?
            .ok_or_else(|| AppError::NotFound("Service not found.".to_string()))?;
        Ok(serde_json::json!({ "service": service_json(service) }))
    }

    pub async fn customers(
        &self,
        context: &RequestContext,
        query: CustomerQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "admin:*"])?;
        let customers: Vec<_> = self
            .catalog
            .list_customers(&context.salon_id, query.q.as_deref())
            .await?
            .into_iter()
            .map(customer_json)
            .collect();
        Ok(serde_json::json!(customers))
    }

    pub async fn create_customer(
        &self,
        context: &RequestContext,
        request: CreateCustomerRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(
            context,
            &["create:customers", "update:customers", "admin:*"],
        )?;
        if request.branch_id.trim().is_empty() || request.branch_id.chars().count() > 160 {
            return Err(AppError::Validation(
                "branchId must be between 1 and 160 characters.".to_string(),
            ));
        }
        if request.name.chars().count() > 160 {
            return Err(AppError::Validation(
                "name must be at most 160 characters.".to_string(),
            ));
        }
        let normalized = normalize_phone(&request.normalized_phone);
        if !(5..=40).contains(&normalized.chars().count()) {
            return Err(AppError::Validation(
                "normalizedPhone must contain between 5 and 40 digits.".to_string(),
            ));
        }
        let customer = CustomerRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: request.branch_id,
            name: request.name,
            normalized_phone: normalized,
            email: String::new(),
            interaction_status: "active".to_string(),
            visit_count: 0,
            last_booked_at: None,
            wallet_balance_paise: 0,
            loyalty_points: 0,
            membership_id: String::new(),
            membership_plan_name: String::new(),
            membership_credits: 0,
            membership_credits_remaining: 0,
            membership_valid_until: String::new(),
            membership_status: String::new(),
            package_name: String::new(),
            package_credits_remaining: 0,
            subscription_name: String::new(),
            subscription_status: String::new(),
            marketing_opt_out: false,
            gender: String::new(),
            birthday: String::new(),
            anniversary: String::new(),
            tags: Vec::new(),
            notes: String::new(),
            address: String::new(),
            created_at: Some(mongodb::bson::DateTime::now()),
            updated_at: Some(mongodb::bson::DateTime::now()),
        };
        let created = self.catalog.upsert_customer(&customer).await?;
        Ok(customer_json(created))
    }
}

fn branch_json(b: BranchRecord) -> serde_json::Value {
    serde_json::json!({ "id": b.id, "name": b.name, "timezone": b.timezone, "status": b.status, "hours": b.hours.iter().map(|h| serde_json::json!({ "weekday": h.weekday, "open": h.open, "close": h.close, "closed": h.closed })).collect::<Vec<_>>(), "slotIntervalMinutes": b.slot_interval_minutes })
}

fn service_json(s: ServiceRecord) -> serde_json::Value {
    serde_json::json!({ "id": s.id.to_hex(), "name": s.name, "description": s.description, "pricePaise": s.price_paise, "durationMinutes": s.duration_minutes, "branchIds": s.branch_ids, "eligibleStaffIds": s.eligible_staff_ids, "status": s.status })
}

fn customer_json(c: CustomerRecord) -> serde_json::Value {
    serde_json::json!({ "id": c.id.to_hex(), "name": c.name, "normalizedPhone": c.normalized_phone, "branchId": c.branch_id, "source": "crm" })
}

fn parse_object_id(id: &str, what: &str) -> Result<ObjectId, AppError> {
    ObjectId::parse_str(id).map_err(|_| AppError::Validation(format!("Invalid {what} id: {id}.")))
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

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    for ch in value.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    slug.trim_matches('_').to_string()
}

fn normalize_phone(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn default_hours() -> Vec<BranchHoursRecord> {
    (0..7)
        .map(|weekday| BranchHoursRecord {
            weekday,
            open: "10:00".to_string(),
            close: "21:00".to_string(),
            closed: false,
        })
        .collect()
}
