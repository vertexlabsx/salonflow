use mongodb::bson::{oid::ObjectId, DateTime};
use serde::{Deserialize, Serialize};
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{AttendanceRecord, StaffLeaveRecord},
    repositories::{AttendanceRepository, StaffRepository},
};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct StaffService {
    attendance: AttendanceRepository,
    staff: StaffRepository,
}

#[derive(Debug, Deserialize)]
pub struct AttendanceQuery {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TodayQuery {
    #[serde(default)]
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClockInRequest {
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockOutRequest {
    pub attendance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBreakRequest {
    #[serde(default)]
    pub break_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRequest {
    pub leave_type: String,
    pub start_date: String,
    pub end_date: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TaskPatchRequest {
    pub status: String,
    pub version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceDto {
    pub id: String,
    pub staff_id: String,
    pub business_date: String,
    pub clock_in_at: String,
    pub clock_out_at: Option<String>,
    pub status: String,
    pub source: String,
    pub gross_minutes: i64,
    pub breaks: Vec<BreakDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakDto {
    pub break_type: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakActionResponse {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffTodayResponse {
    pub date: String,
    pub schedules: Vec<serde_json::Value>,
    pub attendance: Vec<AttendanceDto>,
    pub active_break: Option<ActiveBreakDto>,
    pub tasks: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBreakDto {
    pub id: String,
    pub status: String,
    pub started_at: Option<String>,
}

impl StaffService {
    pub fn new(attendance: AttendanceRepository, staff: StaffRepository) -> Self {
        Self { attendance, staff }
    }

    pub async fn list_attendance(
        &self,
        context: &RequestContext,
        query: AttendanceQuery,
    ) -> Result<Vec<AttendanceDto>, AppError> {
        require_staff(context)?;
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let rows = self
            .attendance
            .list(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                query.date.as_deref(),
                query.from.as_deref(),
                query.to.as_deref(),
                query.limit.unwrap_or(500),
            )
            .await?;
        Ok(rows.into_iter().map(attendance_dto).collect())
    }

    pub async fn today(
        &self,
        context: &RequestContext,
        query: TodayQuery,
    ) -> Result<StaffTodayResponse, AppError> {
        require_staff(context)?;
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let date = query
            .date
            .unwrap_or_else(|| chrono::Utc::now().date_naive().to_string());
        let rows = self
            .attendance
            .list(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                Some(&date),
                None,
                None,
                500,
            )
            .await?;
        let active_break = rows.iter().find_map(|record| {
            record
                .breaks
                .iter()
                .find(|item| item.ended_at.is_none())
                .map(|item| ActiveBreakDto {
                    id: record.id.to_hex(),
                    status: "started".to_string(),
                    started_at: item.started_at.try_to_rfc3339_string().ok(),
                })
        });
        Ok(StaffTodayResponse {
            date,
            schedules: Vec::new(),
            attendance: rows.into_iter().map(attendance_dto).collect(),
            active_break,
            tasks: Vec::new(),
        })
    }

    pub async fn leaves(
        &self,
        context: &RequestContext,
        query: LimitQuery,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        require_staff(context)?;
        let rows = self
            .staff
            .leaves(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                query.limit.unwrap_or(6),
            )
            .await?;
        Ok(rows.into_iter().map(|r| serde_json::json!({"id": r.id.to_hex(), "leaveType": r.leave_type, "startDate": r.start_date, "endDate": r.end_date, "reason": r.reason, "status": r.status, "days": r.days})).collect())
    }

    pub async fn request_leave(
        &self,
        context: &RequestContext,
        request: LeaveRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        let days = count_days(&request.start_date, &request.end_date)?;
        let created = self
            .staff
            .create_leave(StaffLeaveRecord {
                id: ObjectId::new(),
                salon_id: context.salon_id.clone(),
                staff_id: context.staff_id.clone().unwrap(),
                leave_type: request.leave_type,
                start_date: request.start_date,
                end_date: request.end_date,
                reason: request.reason,
                status: "pending".to_string(),
                days,
                version: 1,
                decision_note: String::new(),
                decided_by: String::new(),
                decided_at: None,
                created_at: Some(mongodb::bson::DateTime::now()),
            })
            .await?;
        Ok(
            serde_json::json!({"id": created.id.to_hex(), "leaveType": created.leave_type, "startDate": created.start_date, "endDate": created.end_date, "reason": created.reason, "status": created.status, "days": created.days}),
        )
    }

    pub async fn payroll(
        &self,
        context: &RequestContext,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        require_staff(context)?;
        Ok(self.staff.payroll(&context.salon_id, context.staff_id.as_deref().unwrap()).await?.into_iter().map(|p| serde_json::json!({"id": p.id.to_hex(), "payrollRunId": p.payroll_run_id, "periodStart": p.period_start, "periodEnd": p.period_end, "moneyStorageUnit": "paise", "grossAmountPaise": p.gross_amount_paise, "overtimeAmountPaise": p.overtime_amount_paise, "bonusAmountPaise": p.bonus_amount_paise, "deductionAmountPaise": p.deduction_amount_paise, "netAmountPaise": p.net_amount_paise, "overtimeMinutes": p.overtime_minutes, "status": p.status})).collect())
    }

    pub async fn targets(
        &self,
        context: &RequestContext,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        require_staff(context)?;
        Ok(self.staff.targets(&context.salon_id, context.staff_id.as_deref().unwrap()).await?.into_iter().map(|t| serde_json::json!({"id": t.id.to_hex(), "targetName": t.target_name, "targetType": t.target_type, "targetValue": t.target_value_paise, "achievedValue": t.achieved_value_paise, "status": t.status})).collect())
    }

    pub async fn update_task(
        &self,
        context: &RequestContext,
        task_id: &str,
        request: TaskPatchRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_staff(context)?;
        if !["pending", "in_progress", "completed", "cancelled"].contains(&request.status.as_str())
        {
            return Err(AppError::Validation("Invalid task status.".to_string()));
        }
        let id = ObjectId::parse_str(task_id)
            .map_err(|_| AppError::Validation("A valid task id is required.".to_string()))?;
        let updated = self
            .staff
            .update_task(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                id,
                &request.status,
                request.version,
            )
            .await?
            .ok_or(AppError::StaleVersion)?;
        Ok(serde_json::json!({"id": updated.id.to_hex(), "status": updated.status}))
    }

    pub async fn clock_in(
        &self,
        context: &RequestContext,
        request: ClockInRequest,
    ) -> Result<AttendanceDto, AppError> {
        require_staff(context)?;
        require_any(
            context,
            &["allow:staff-checkin-checkout", "read:staff", "write:staff"],
        )?;
        if self
            .attendance
            .open_for_staff(&context.salon_id, context.staff_id.as_deref().unwrap())
            .await?
            .is_some()
        {
            return Err(AppError::Conflict(
                "You are already checked in. Clock out before clocking in again.".to_string(),
            ));
        }
        let now = DateTime::now();
        let record = AttendanceRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            staff_id: context.staff_id.clone().unwrap(),
            business_date: chrono::Utc::now().date_naive().to_string(),
            clock_in_at: now,
            clock_out_at: None,
            status: "open".to_string(),
            source: request.source.unwrap_or_else(|| "staff-app".to_string()),
            gross_minutes: 0,
            breaks: Vec::new(),
        };
        Ok(attendance_dto(self.attendance.clock_in(record).await?))
    }

    pub async fn clock_out(
        &self,
        context: &RequestContext,
        request: ClockOutRequest,
    ) -> Result<AttendanceDto, AppError> {
        require_staff(context)?;
        require_any(
            context,
            &["allow:staff-checkin-checkout", "read:staff", "write:staff"],
        )?;
        let id = ObjectId::parse_str(&request.attendance_id)
            .map_err(|_| AppError::Validation("A valid attendanceId is required.".to_string()))?;
        let updated = self
            .attendance
            .clock_out(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                id,
                DateTime::now(),
            )
            .await?;
        updated.map(attendance_dto).ok_or_else(|| {
            AppError::Conflict("This attendance record is already closed.".to_string())
        })
    }

    pub async fn start_break(
        &self,
        context: &RequestContext,
        request: StartBreakRequest,
    ) -> Result<BreakActionResponse, AppError> {
        require_staff(context)?;
        require_any(
            context,
            &["allow:staff-checkin-checkout", "read:staff", "write:staff"],
        )?;
        let updated = self
            .attendance
            .start_break(
                &context.salon_id,
                context.staff_id.as_deref().unwrap(),
                request.break_type.as_deref().unwrap_or("regular"),
            )
            .await?;
        updated
            .map(|record| BreakActionResponse {
                id: record.id.to_hex(),
                status: "break_started".to_string(),
            })
            .ok_or_else(|| {
                AppError::Conflict(
                    "A break is already running or you are not clocked in.".to_string(),
                )
            })
    }

    pub async fn end_break(
        &self,
        context: &RequestContext,
    ) -> Result<BreakActionResponse, AppError> {
        require_staff(context)?;
        require_any(
            context,
            &["allow:staff-checkin-checkout", "read:staff", "write:staff"],
        )?;
        let updated = self
            .attendance
            .end_break(&context.salon_id, context.staff_id.as_deref().unwrap())
            .await?;
        updated
            .map(|record| BreakActionResponse {
                id: record.id.to_hex(),
                status: "break_ended".to_string(),
            })
            .ok_or_else(|| AppError::Conflict("No break is currently running.".to_string()))
    }
}

fn count_days(start: &str, end: &str) -> Result<i64, AppError> {
    let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("startDate must be YYYY-MM-DD.".to_string()))?;
    let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("endDate must be YYYY-MM-DD.".to_string()))?;
    let days = (end - start).num_days() + 1;
    if days <= 0 {
        Err(AppError::Validation(
            "End date must be on or after start date.".to_string(),
        ))
    } else {
        Ok(days)
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

fn attendance_dto(record: AttendanceRecord) -> AttendanceDto {
    AttendanceDto {
        id: record.id.to_hex(),
        staff_id: record.staff_id,
        business_date: record.business_date,
        clock_in_at: record
            .clock_in_at
            .try_to_rfc3339_string()
            .unwrap_or_default(),
        clock_out_at: record
            .clock_out_at
            .and_then(|value| value.try_to_rfc3339_string().ok()),
        status: record.status,
        source: record.source,
        gross_minutes: record.gross_minutes,
        breaks: record
            .breaks
            .into_iter()
            .map(|item| BreakDto {
                break_type: item.break_type,
                started_at: item.started_at.try_to_rfc3339_string().unwrap_or_default(),
                ended_at: item
                    .ended_at
                    .and_then(|value| value.try_to_rfc3339_string().ok()),
            })
            .collect(),
    }
}
