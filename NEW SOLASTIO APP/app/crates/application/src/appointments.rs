use chrono::{Datelike, Timelike};
use mongodb::bson::{doc, oid::ObjectId, DateTime};
use serde::{Deserialize, Serialize};
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{AppointmentRecord, BranchRecord, ServiceRecord},
    repositories::{AppointmentRepository, CatalogRepository},
};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct AppointmentService {
    appointments: AppointmentRepository,
    catalog: CatalogRepository,
}

#[derive(Debug, Deserialize)]
pub struct AppointmentListQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AppointmentStatusRequest {
    pub status: String,
    pub version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppointmentRequest {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    pub service_id: String,
    #[serde(default)]
    pub customer_name: String,
    #[serde(default)]
    pub normalized_phone: Option<String>,
    pub start_at: String,
    #[serde(default = "default_source")]
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerAppointmentWrite {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub recurrence: Option<AppointmentRecurrenceWrite>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentRecurrenceWrite {
    #[serde(default = "default_recurrence_frequency")]
    pub frequency: String,
    #[serde(default = "default_recurrence_interval")]
    pub interval: i64,
    #[serde(default = "default_recurrence_count")]
    pub count: i64,
    #[serde(default)]
    pub until: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerAppointmentReschedule {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    pub start_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentDto {
    pub id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub customer_id: Option<String>,
    pub customer_name: String,
    pub service_ids: Vec<String>,
    pub service_names: Vec<String>,
    pub duration_minutes: i64,
    pub value: i64,
    pub start_at: String,
    pub end_at: String,
    pub status: String,
    pub source: String,
    pub version: i64,
}

impl AppointmentService {
    pub fn new(appointments: AppointmentRepository, catalog: CatalogRepository) -> Self {
        Self {
            appointments,
            catalog,
        }
    }

    pub async fn create(
        &self,
        context: &RequestContext,
        request: CreateAppointmentRequest,
    ) -> Result<AppointmentDto, AppError> {
        if !has_permission(&context.permissions, "create:appointments")
            && !has_permission(&context.permissions, "update:appointments")
        {
            return Err(AppError::Authorization);
        }
        let branch_id = request
            .branch_id
            .unwrap_or_else(|| context.branch_id.clone());
        if !context.branch_ids.is_empty()
            && !context.branch_ids.iter().any(|item| item == &branch_id)
        {
            return Err(AppError::Authorization);
        }
        let start_at = chrono::DateTime::parse_from_rfc3339(&request.start_at)
            .map_err(|_| AppError::Validation("Invalid startAt timestamp.".to_string()))?
            .with_timezone(&chrono::Utc);
        let service_id = ObjectId::parse_str(&request.service_id)
            .map_err(|_| AppError::Validation("A valid service is required.".to_string()))?;
        let service = self
            .catalog
            .active_service(&context.salon_id, service_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Service was not found.".to_string()))?;
        if !service.branch_ids.is_empty()
            && !service.branch_ids.iter().any(|item| item == &branch_id)
        {
            return Err(AppError::Validation(
                "This service is not available at the selected branch.".to_string(),
            ));
        }
        let branch = self
            .catalog
            .active_branch(&context.salon_id, &branch_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch was not found.".to_string()))?;
        let end_at = start_at + chrono::Duration::minutes(service.duration_minutes);
        validate_branch_hours(&branch, start_at, end_at)?;
        let selected_staff = self
            .available_staff(
                &context.salon_id,
                &branch_id,
                &service,
                request.staff_id.as_deref(),
                start_at,
                end_at,
            )
            .await?;
        let appointment = AppointmentRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id,
            staff_id: selected_staff,
            customer_id: None,
            customer_name: Some(if request.customer_name.trim().is_empty() {
                "Walk-in".to_string()
            } else {
                request.customer_name.trim().to_string()
            }),
            service_ids: vec![request.service_id],
            service_names: vec![service.name],
            duration_minutes: service.duration_minutes,
            value: service.price_paise,
            start_at: DateTime::from_millis(start_at.timestamp_millis()),
            end_at: DateTime::from_millis(end_at.timestamp_millis()),
            status: "booked".to_string(),
            source: Some(request.source),
            version: 1,
        };
        Ok(to_dto(
            self.appointments
                .create_with_customer_and_locks(appointment, request.normalized_phone.as_deref())
                .await?,
        ))
    }

    pub async fn list(
        &self,
        context: &RequestContext,
        query: AppointmentListQuery,
    ) -> Result<Vec<AppointmentDto>, AppError> {
        require(context, "read:appointments")?;
        let sees_all = context
            .permissions
            .iter()
            .any(|grant| grant == "*" || grant == "admin:*" || grant == "read:all-appointments");
        let staff_id = if sees_all {
            None
        } else {
            context.staff_id.as_deref()
        };
        let branch_ids = if context.branch_ids.is_empty() {
            vec![context.branch_id.clone()]
        } else {
            context.branch_ids.clone()
        };
        let items = self
            .appointments
            .list_for_staff(
                &context.salon_id,
                &branch_ids,
                staff_id,
                query.limit.unwrap_or(200).clamp(1, 500),
            )
            .await?;
        Ok(items.into_iter().map(to_dto).collect())
    }

    pub async fn owner_detail(
        &self,
        context: &RequestContext,
        id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require(context, "read:appointments")?;
        let id = ObjectId::parse_str(id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let appointment = self
            .appointments
            .find_by_id(&context.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
        if !branch_allowed(context, &appointment.branch_id) {
            return Err(AppError::Authorization);
        }
        Ok(serde_json::json!({ "appointment": to_dto(appointment) }))
    }

    pub async fn owner_create(
        &self,
        context: &RequestContext,
        request: OwnerAppointmentWrite,
    ) -> Result<serde_json::Value, AppError> {
        let service_id = request.service_ids.first().cloned().ok_or_else(|| {
            AppError::Validation("serviceIds must contain at least one service.".to_string())
        })?;
        let first_start = request
            .start_at
            .clone()
            .ok_or_else(|| AppError::Validation("startAt is required.".to_string()))?;
        let starts = recurrence_starts(&first_start, request.recurrence.as_ref())?;
        let mut customer_name = String::new();
        let mut normalized_phone = None;
        if let Some(client_id) = request.client_id.as_deref().filter(|id| !id.is_empty()) {
            let customer_id = ObjectId::parse_str(client_id)
                .map_err(|_| AppError::Validation("A valid clientId is required.".to_string()))?;
            if let Some(customer) = self
                .appointments
                .customer_by_id(&context.salon_id, customer_id)
                .await?
            {
                customer_name = customer.name;
                normalized_phone = Some(customer.normalized_phone);
            }
        }
        let branch_id = request.branch_id.clone();
        let staff_id = request.staff_id.clone();
        let source = request.source.unwrap_or_else(|| "crm".to_string());
        let mut created = Vec::new();
        for start_at in starts {
            created.push(
                self.create(
                    context,
                    CreateAppointmentRequest {
                        branch_id: branch_id.clone(),
                        staff_id: staff_id.clone(),
                        service_id: service_id.clone(),
                        customer_name: customer_name.clone(),
                        normalized_phone: normalized_phone.clone(),
                        start_at,
                        source: source.clone(),
                    },
                )
                .await?,
            );
        }
        let first = created.first().ok_or_else(|| {
            AppError::Validation("No recurrence dates were generated.".to_string())
        })?;
        let ids: Vec<String> = created.iter().map(|item| item.id.clone()).collect();
        Ok(
            serde_json::json!({ "appointment": first, "recurrence": { "created": ids.len(), "appointmentIds": ids } }),
        )
    }

    pub async fn owner_update(
        &self,
        context: &RequestContext,
        id: &str,
        request: OwnerAppointmentWrite,
    ) -> Result<serde_json::Value, AppError> {
        require(context, "update:appointments")?;
        let object_id = ObjectId::parse_str(id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let current = self
            .appointments
            .find_by_id(&context.salon_id, object_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
        if !branch_allowed(context, &current.branch_id) {
            return Err(AppError::Authorization);
        }
        if let Some(version) = request.version {
            if version != current.version {
                return Err(AppError::Conflict(
                    "Appointment was changed by another user.".to_string(),
                ));
            }
        }
        let mut update = doc! {};
        let mut duration = current.duration_minutes;
        if let Some(service_id) = request.service_ids.first() {
            let service_object_id = ObjectId::parse_str(service_id)
                .map_err(|_| AppError::Validation("A valid service is required.".to_string()))?;
            let service = self
                .catalog
                .active_service(&context.salon_id, service_object_id)
                .await?
                .ok_or_else(|| AppError::NotFound("Service was not found.".to_string()))?;
            duration = service.duration_minutes;
            update.insert("serviceIds", vec![service_id.clone()]);
            update.insert("serviceNames", vec![service.name]);
            update.insert("durationMinutes", service.duration_minutes);
            update.insert("value", service.price_paise);
        }
        if let Some(branch_id) = request.branch_id.filter(|b| !b.is_empty()) {
            if !branch_allowed(context, &branch_id) {
                return Err(AppError::Authorization);
            }
            update.insert("branchId", branch_id);
        }
        if let Some(staff_id) = request.staff_id.filter(|s| !s.is_empty()) {
            update.insert("staffId", staff_id);
        }
        if let Some(start_at) = request.start_at.filter(|s| !s.is_empty()) {
            let start = parse_chrono(&start_at)?;
            update.insert("startAt", DateTime::from_millis(start.timestamp_millis()));
            update.insert(
                "endAt",
                DateTime::from_millis(
                    (start + chrono::Duration::minutes(duration)).timestamp_millis(),
                ),
            );
        }
        if update.is_empty() {
            return Err(AppError::Validation(
                "No appointment fields to update.".to_string(),
            ));
        }
        let updated = self
            .appointments
            .update_by_id(&context.salon_id, object_id, current.version, update)
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(serde_json::json!({ "appointment": to_dto(updated) }))
    }

    pub async fn owner_reschedule(
        &self,
        context: &RequestContext,
        id: &str,
        request: OwnerAppointmentReschedule,
    ) -> Result<serde_json::Value, AppError> {
        require(context, "update:appointments")?;
        let object_id = ObjectId::parse_str(id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let current = self
            .appointments
            .find_by_id(&context.salon_id, object_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
        if !branch_allowed(context, &current.branch_id) {
            return Err(AppError::Authorization);
        }
        let start = parse_chrono(&request.start_at)?;
        let mut update = doc! {
            "startAt": DateTime::from_millis(start.timestamp_millis()),
            "endAt": DateTime::from_millis((start + chrono::Duration::minutes(current.duration_minutes)).timestamp_millis()),
        };
        if let Some(branch_id) = request.branch_id.filter(|b| !b.is_empty()) {
            if !branch_allowed(context, &branch_id) {
                return Err(AppError::Authorization);
            }
            update.insert("branchId", branch_id);
        }
        if let Some(staff_id) = request.staff_id.filter(|s| !s.is_empty()) {
            update.insert("staffId", staff_id);
        }
        let updated = self
            .appointments
            .update_by_id(&context.salon_id, object_id, current.version, update)
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(serde_json::json!({ "appointment": to_dto(updated) }))
    }

    pub async fn transition_status(
        &self,
        context: &RequestContext,
        id: &str,
        request: AppointmentStatusRequest,
    ) -> Result<AppointmentDto, AppError> {
        if !has_permission(&context.permissions, "update:appointments")
            && !has_permission(&context.permissions, "create:appointments")
        {
            return Err(AppError::Authorization);
        }
        let id = ObjectId::parse_str(id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let updated = self
            .appointments
            .transition_status(&context.salon_id, id, &request.status, request.version)
            .await?;
        updated.map(to_dto).ok_or(AppError::StaleVersion)
    }

    pub async fn transition_status_current(
        &self,
        context: &RequestContext,
        id: &str,
        status: &str,
    ) -> Result<AppointmentDto, AppError> {
        let object_id = ObjectId::parse_str(id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let appointment = self
            .appointments
            .find_by_id(&context.salon_id, object_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment not found.".to_string()))?;
        self.transition_status(
            context,
            id,
            AppointmentStatusRequest {
                status: status.to_string(),
                version: appointment.version,
            },
        )
        .await
    }
}

impl AppointmentService {
    async fn available_staff(
        &self,
        salon_id: &str,
        branch_id: &str,
        service: &ServiceRecord,
        preferred_staff_id: Option<&str>,
        start_at: chrono::DateTime<chrono::Utc>,
        end_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<String, AppError> {
        let eligible = preferred_staff_id
            .map(|id| vec![id.to_string()])
            .unwrap_or_else(|| service.eligible_staff_ids.clone());
        let staff = self
            .catalog
            .active_staff(salon_id, branch_id, &eligible)
            .await?;
        if staff.is_empty() {
            return Err(AppError::Conflict(
                "No eligible staff is available for this service.".to_string(),
            ));
        }
        let date = start_at.date_naive().to_string();
        let start_bson = DateTime::from_millis(start_at.timestamp_millis());
        let end_bson = DateTime::from_millis(end_at.timestamp_millis());
        let mut candidates = Vec::new();
        for user in staff {
            let staff_id = user.staff_id.clone().unwrap_or_else(|| user.id.to_hex());
            if self
                .catalog
                .schedule(salon_id, branch_id, &staff_id, &date)
                .await?
                .is_none()
            {
                continue;
            }
            if self
                .catalog
                .leave(salon_id, &staff_id, &date)
                .await?
                .is_some()
            {
                continue;
            }
            if self
                .appointments
                .find_overlap(salon_id, &staff_id, start_bson, end_bson)
                .await?
                .is_some()
            {
                continue;
            }
            if self
                .appointments
                .has_lock_overlap(salon_id, &staff_id, start_bson, end_bson)
                .await?
            {
                continue;
            }
            let load = self
                .appointments
                .count_day_load(salon_id, &staff_id, start_bson)
                .await?;
            candidates.push((staff_id, load));
        }
        candidates.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        candidates
            .into_iter()
            .next()
            .map(|item| item.0)
            .ok_or_else(|| {
                AppError::Conflict(
                    "No staff is available for this time. Please choose another slot.".to_string(),
                )
            })
    }
}

fn require(context: &RequestContext, permission: &str) -> Result<(), AppError> {
    if has_permission(&context.permissions, permission) {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn branch_allowed(context: &RequestContext, branch_id: &str) -> bool {
    if context.branch_ids.is_empty() {
        context.branch_id == branch_id
    } else {
        context.branch_ids.iter().any(|id| id == branch_id)
    }
}

fn parse_chrono(value: &str) -> Result<chrono::DateTime<chrono::Utc>, AppError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|_| AppError::Validation("Invalid startAt timestamp.".to_string()))
}

fn to_dto(item: AppointmentRecord) -> AppointmentDto {
    AppointmentDto {
        id: item.id.to_hex(),
        branch_id: item.branch_id,
        staff_id: item.staff_id,
        customer_id: item.customer_id,
        customer_name: item.customer_name.unwrap_or_else(|| "Walk-in".to_string()),
        service_ids: item.service_ids,
        service_names: item.service_names,
        duration_minutes: item.duration_minutes,
        value: item.value,
        start_at: item.start_at.try_to_rfc3339_string().unwrap_or_default(),
        end_at: item.end_at.try_to_rfc3339_string().unwrap_or_default(),
        status: item.status,
        source: item.source.unwrap_or_else(|| "crm".to_string()),
        version: item.version,
    }
}

fn default_source() -> String {
    "walk_in".to_string()
}

fn default_recurrence_frequency() -> String {
    "none".to_string()
}

fn default_recurrence_interval() -> i64 {
    1
}

fn default_recurrence_count() -> i64 {
    1
}

fn recurrence_starts(
    first: &str,
    recurrence: Option<&AppointmentRecurrenceWrite>,
) -> Result<Vec<String>, AppError> {
    let first_dt = chrono::DateTime::parse_from_rfc3339(first)
        .map_err(|_| AppError::Validation("Invalid startAt timestamp.".to_string()))?;
    let Some(recurrence) = recurrence else {
        return Ok(vec![first.to_string()]);
    };
    if recurrence.frequency == "none" {
        return Ok(vec![first.to_string()]);
    }
    if recurrence.frequency != "weekly" && recurrence.frequency != "monthly" {
        return Err(AppError::Validation(
            "recurrence.frequency must be none, weekly, or monthly.".to_string(),
        ));
    }
    let count = recurrence.count.clamp(1, 52);
    let interval = recurrence.interval.clamp(1, 12);
    let until = recurrence
        .until
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .map(|dt| dt.with_timezone(first_dt.offset()))
                .map_err(|_| {
                    AppError::Validation("Invalid recurrence.until timestamp.".to_string())
                })
        })
        .transpose()?;
    let mut starts = Vec::new();
    for index in 0..count {
        let candidate = if recurrence.frequency == "weekly" {
            first_dt + chrono::Duration::days(index * interval * 7)
        } else {
            add_months(first_dt, index * interval)
        };
        if until.is_some_and(|limit| candidate > limit) {
            break;
        }
        starts.push(candidate.to_rfc3339());
    }
    Ok(starts)
}

fn add_months(
    value: chrono::DateTime<chrono::FixedOffset>,
    months: i64,
) -> chrono::DateTime<chrono::FixedOffset> {
    let month0 = value.month0() as i64 + months;
    let year = value.year() + (month0.div_euclid(12)) as i32;
    let month = (month0.rem_euclid(12) + 1) as u32;
    let day = value.day().min(last_day_of_month(year, month));
    value
        .with_year(year)
        .and_then(|dt| dt.with_month(month))
        .and_then(|dt| dt.with_day(day))
        .unwrap_or(value)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|date| date.pred_opt())
        .map(|date| date.day())
        .unwrap_or(28)
}

fn minutes(time: &str) -> i64 {
    let mut parts = time.split(':').filter_map(|part| part.parse::<i64>().ok());
    parts.next().unwrap_or(0) * 60 + parts.next().unwrap_or(0)
}

fn validate_branch_hours(
    branch: &BranchRecord,
    start_at: chrono::DateTime<chrono::Utc>,
    end_at: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    let weekday = start_at.weekday().num_days_from_sunday() as i32;
    let hours = branch
        .hours
        .iter()
        .find(|item| item.weekday == weekday)
        .ok_or_else(|| AppError::Conflict("The branch is closed on this date.".to_string()))?;
    if hours.closed {
        return Err(AppError::Conflict(
            "The branch is closed on this date.".to_string(),
        ));
    }
    let start_minutes = start_at.hour() as i64 * 60 + start_at.minute() as i64;
    let end_minutes = end_at.hour() as i64 * 60 + end_at.minute() as i64;
    if start_minutes < minutes(&hours.open) || end_minutes > minutes(&hours.close) {
        return Err(AppError::Conflict(
            "Requested time is outside branch working hours.".to_string(),
        ));
    }
    Ok(())
}
