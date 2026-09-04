use mongodb::bson::oid::ObjectId;
use serde::Deserialize;
use solastio_auth::rbac::has_permission;
use solastio_database::models::{NotificationRecord, ShiftSwapRecord};
use solastio_database::repositories::{AppointmentRepository, StaffRepository};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct StaffSelfService {
    appointments: AppointmentRepository,
    staff: StaffRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulePatchRequest {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShiftSwapRequest {
    pub schedule_id: String,
    pub to_staff_id: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSwapDecisionRequest {
    pub decision: String,
    pub version: i64,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSwapCancelRequest {
    pub version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQuery {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OvertimeSummaryQuery {
    #[serde(default)]
    pub as_of: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NotificationPatchRequest {
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct NotificationQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

impl StaffSelfService {
    pub fn new(appointments: AppointmentRepository, staff: StaffRepository) -> Self {
        Self {
            appointments,
            staff,
        }
    }

    pub async fn dashboard(
        &self,
        context: &RequestContext,
        query: DashboardQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let staff_id = context.staff_id.as_deref().unwrap();
        let rows = self
            .appointments
            .list_for_staff(&context.salon_id, &context.branch_ids, Some(staff_id), 100)
            .await?;
        let today = chrono::Utc::now().date_naive().to_string();
        let today_count = rows
            .iter()
            .filter(|a| {
                a.start_at
                    .try_to_rfc3339_string()
                    .as_deref()
                    .map(|s| s.starts_with(&format!("{}T", today)) || s.starts_with(&today))
                    .unwrap_or(false)
            })
            .count();
        let summary = serde_json::json!({ "today": today_count });
        let appointments: Vec<_> = rows
            .into_iter()
            .map(|a| {
                serde_json::json!({ "id": a.id.to_hex(), "branchId": a.branch_id, "clientName": a.customer_name.unwrap_or_else(|| "Walk-in".to_string()), "serviceNames": a.service_names, "startAt": a.start_at.try_to_rfc3339_string().unwrap_or_default(), "endAt": a.end_at.try_to_rfc3339_string().unwrap_or_default(), "status": a.status, "value": a.value, "version": a.version })
            })
            .collect();
        Ok(
            serde_json::json!({ "summary": summary, "appointments": appointments, "query": { "from": query.from, "to": query.to } }),
        )
    }

    pub async fn calendar(
        &self,
        context: &RequestContext,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        require_staff(context)?;
        let rows = self
            .staff
            .schedules(&context.salon_id, context.staff_id.as_deref().unwrap(), 60)
            .await?;
        Ok(rows
            .into_iter()
            .map(|s| {
                serde_json::json!({ "id": s.id.to_hex(), "date": s.schedule_date, "startTime": s.start_time, "endTime": s.end_time, "type": schedule_type(&s.status), "status": s.status, "version": s.version })
            })
            .collect())
    }

    pub async fn update_schedule(
        &self,
        context: &RequestContext,
        schedule_id: &str,
        request: SchedulePatchRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let id = ObjectId::parse_str(schedule_id)
            .map_err(|_| AppError::Validation("A valid scheduleId is required.".to_string()))?;
        let status = request.status.unwrap_or_else(|| "confirmed".to_string());
        let version = request.version.unwrap_or(1);
        let updated = self
            .staff
            .update_schedule(&context.salon_id, id, &status, version)
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(
            serde_json::json!({ "id": updated.id.to_hex(), "date": updated.schedule_date, "startTime": updated.start_time, "endTime": updated.end_time, "type": schedule_type(&updated.status), "status": updated.status, "version": updated.version }),
        )
    }

    pub async fn shift_swap_coworkers(
        &self,
        context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let rows = self
            .staff
            .coworker_schedules(
                &context.salon_id,
                &context.branch_id,
                context.staff_id.as_deref().unwrap(),
            )
            .await?;
        let mut coworkers = std::collections::BTreeMap::new();
        for s in rows {
            coworkers
                .entry(s.staff_id.clone())
                .or_insert_with(|| {
                    serde_json::json!({ "id": s.staff_id, "branchId": s.branch_id, "designation": "staff" })
                });
        }
        let items: Vec<_> = coworkers.values().cloned().collect();
        Ok(serde_json::json!({ "items": items }))
    }

    pub async fn shift_swaps(
        &self,
        context: &RequestContext,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        require_staff(context)?;
        let rows = self
            .staff
            .shift_swaps_for(&context.salon_id, context.staff_id.as_deref().unwrap(), 30)
            .await?;
        Ok(rows.into_iter().map(shift_swap_json).collect())
    }

    pub async fn create_shift_swap(
        &self,
        context: &RequestContext,
        request: CreateShiftSwapRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let schedule_id = ObjectId::parse_str(&request.schedule_id)
            .map_err(|_| AppError::Validation("A valid scheduleId is required.".to_string()))?;
        let schedule = self
            .staff
            .schedule(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                schedule_id,
            )
            .await?
            .ok_or_else(|| AppError::NotFound("Schedule not found.".to_string()))?;
        if schedule.status != "confirmed" && schedule.status != "allocated" {
            return Err(AppError::Validation(
                "Only confirmed or allocated shifts can be swapped.".to_string(),
            ));
        }
        if self
            .staff
            .pending_shift_swap(&context.salon_id, &request.schedule_id)
            .await?
            .is_some()
        {
            return Err(AppError::Conflict(
                "A pending shift swap already exists for this schedule.".to_string(),
            ));
        }
        let swap = ShiftSwapRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            branch_id: schedule.branch_id,
            schedule_id: request.schedule_id,
            from_staff_id: context.staff_id.clone().unwrap(),
            to_staff_id: request.to_staff_id,
            schedule_date: schedule.schedule_date,
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            reason: request.reason,
            status: "pending".to_string(),
            target_response_note: String::new(),
            rejection_reason: String::new(),
            version: 1,
        };
        let created = self.staff.create_shift_swap(swap).await?;
        Ok(shift_swap_json(created))
    }

    pub async fn respond_shift_swap(
        &self,
        context: &RequestContext,
        swap_id: &str,
        request: ShiftSwapDecisionRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let id = ObjectId::parse_str(swap_id)
            .map_err(|_| AppError::Validation("A valid shift swap id is required.".to_string()))?;
        let (status, note) = match request.decision.as_str() {
            "accept" => ("pending_manager", request.note),
            "decline" => ("declined", request.note),
            _ => {
                return Err(AppError::Validation(
                    "decision must be 'accept' or 'decline'.".to_string(),
                ))
            }
        };
        let updated = self
            .staff
            .respond_shift_swap(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                id,
                status,
                &note,
                request.version,
            )
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(shift_swap_json(updated))
    }

    pub async fn cancel_shift_swap(
        &self,
        context: &RequestContext,
        swap_id: &str,
        request: ShiftSwapCancelRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let id = ObjectId::parse_str(swap_id)
            .map_err(|_| AppError::Validation("A valid shift swap id is required.".to_string()))?;
        let updated = self
            .staff
            .cancel_shift_swap(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                id,
                request.version,
            )
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(shift_swap_json(updated))
    }

    pub async fn overtime_summary(
        &self,
        context: &RequestContext,
        _query: OvertimeSummaryQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let rows = self
            .appointments
            .list_for_staff(
                &context.salon_id,
                &context.branch_ids,
                context.staff_id.as_deref(),
                300,
            )
            .await?;
        let total: i64 = rows.iter().map(|a| a.duration_minutes).sum();
        Ok(
            serde_json::json!({ "todayMinutes": 0, "weekMinutes": 0, "last30DaysMinutes": 0, "lifetimeMinutes": total }),
        )
    }

    pub async fn leave_balances(
        &self,
        _context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        Ok(
            serde_json::json!([{ "id": "casual", "leaveType": "Casual", "openingBalance": 12, "accrued": 0, "used": 0, "balance": 12 }, { "id": "sick", "leaveType": "Sick", "openingBalance": 6, "accrued": 0, "used": 0, "balance": 6 }]),
        )
    }

    pub async fn workspace_preferences(
        &self,
        _context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        Ok(
            serde_json::json!({ "workspace": {}, "localization": { "timezone": "Asia/Kolkata", "locale": "en-IN" }, "dateTime": { "dateFormat": "DD/MM/YYYY", "timeFormat": "12h", "businessDayStartHour": 10, "weekStartsOn": 1 }, "interface": { "compactMode": false }, "defaults": { "staffHints": true } }),
        )
    }

    pub async fn update_notification(
        &self,
        context: &RequestContext,
        notification_id: &str,
        request: NotificationPatchRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        if !["read", "unread", "archived"].contains(&request.status.as_str()) {
            return Err(AppError::Validation(
                "status must be 'read', 'unread', or 'archived'.".to_string(),
            ));
        }
        let id = ObjectId::parse_str(notification_id).map_err(|_| {
            AppError::Validation("A valid notification id is required.".to_string())
        })?;
        let updated = self
            .staff
            .update_notification(&context.salon_id, &context.user_id, id, &request.status)
            .await?;
        let updated = updated.ok_or(AppError::NotFound("Notification not found.".to_string()))?;
        Ok(serde_json::json!({ "id": updated.id.to_hex(), "status": updated.status }))
    }

    pub async fn notifications(
        &self,
        context: &RequestContext,
        query: NotificationQuery,
    ) -> Result<serde_json::Value, AppError> {
        let limit = query.limit.unwrap_or(50).clamp(1, 100);
        let items = self
            .staff
            .notifications(&context.salon_id, &context.user_id, limit)
            .await?;
        Ok(serde_json::json!({
            "items": items.iter().map(notification_json).collect::<Vec<_>>(),
            "page": { "total": items.len(), "limit": limit, "offset": 0, "hasMore": false }
        }))
    }
}

fn notification_json(n: &NotificationRecord) -> serde_json::Value {
    serde_json::json!({
        "id": n.id.to_hex(),
        "title": n.title,
        "body": n.body,
        "status": n.status,
    })
}

fn shift_swap_json(s: ShiftSwapRecord) -> serde_json::Value {
    serde_json::json!({ "id": s.id.to_hex(), "branchId": s.branch_id, "scheduleId": s.schedule_id, "fromStaffId": s.from_staff_id, "toStaffId": s.to_staff_id, "scheduleDate": s.schedule_date, "startTime": s.start_time, "endTime": s.end_time, "reason": s.reason, "status": s.status, "targetResponseNote": s.target_response_note, "rejectionReason": s.rejection_reason, "version": s.version })
}

fn schedule_type(status: &str) -> String {
    match status {
        "cancelled" => "off".to_string(),
        _ => "shift".to_string(),
    }
}

fn require_staff(context: &RequestContext) -> Result<(), AppError> {
    if context.staff_id.is_some() {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}

fn require_any(context: &RequestContext, permissions: &[&str]) -> Result<(), AppError> {
    if permissions
        .iter()
        .any(|permission| has_permission(&context.permissions, permission))
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}
