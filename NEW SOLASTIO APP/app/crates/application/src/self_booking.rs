use chrono::{Datelike, Timelike};
use mongodb::bson::{oid::ObjectId, DateTime};
use serde::{Deserialize, Serialize};
use solastio_database::{
    models::{AppointmentRecord, BranchHoursRecord, BranchRecord, ServiceRecord, UserRecord},
    repositories::{AppointmentRepository, CatalogRepository},
};
use solastio_shared::error::AppError;

#[derive(Clone)]
pub struct SelfBookingService {
    catalog: CatalogRepository,
    appointments: AppointmentRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalonQuery {
    pub salon_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchQuery {
    pub salon_id: String,
    pub branch_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffQuery {
    pub salon_id: String,
    pub branch_id: String,
    #[serde(default)]
    pub service_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotsQuery {
    pub salon_id: String,
    pub branch_id: String,
    pub service_id: String,
    pub date: String,
    #[serde(default)]
    pub staff_id: Option<String>,
    #[serde(default)]
    pub max_slots: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRequest {
    pub salon_id: String,
    pub branch_id: String,
    pub service_id: String,
    pub start_at: String,
    pub customer_name: String,
    pub phone: String,
    #[serde(default)]
    pub preferred_staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub salon_id: String,
    pub appointment_id: String,
    pub phone: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescheduleRequest {
    pub salon_id: String,
    pub appointment_id: String,
    pub phone: String,
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub service_id: Option<String>,
    pub new_start_at: String,
}

#[derive(Debug, Serialize)]
pub struct BranchesResponse {
    pub branches: Vec<PublicBranch>,
}

#[derive(Debug, Serialize)]
pub struct ServicesResponse {
    pub services: Vec<PublicService>,
}

#[derive(Debug, Serialize)]
pub struct StaffResponse {
    pub staff: Vec<PublicStaff>,
}

#[derive(Debug, Serialize)]
pub struct SlotsResponse {
    pub slots: Vec<PublicSlot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookResponse {
    pub appointment_id: String,
    pub status: String,
    pub start_at: String,
    pub end_at: String,
    pub staff_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResponse {
    pub booking_id: String,
    pub status: String,
    pub previous_start_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescheduleResponse {
    pub booking_id: String,
    pub status: String,
    pub new_start_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicBranch {
    pub id: String,
    pub name: String,
    pub timezone: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicService {
    pub id: String,
    pub name: String,
    pub description: String,
    pub price_paise: i64,
    pub duration_minutes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicStaff {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSlot {
    pub start_at: String,
    pub end_at: String,
    pub staff_id: String,
}

impl SelfBookingService {
    pub fn new(catalog: CatalogRepository, appointments: AppointmentRepository) -> Self {
        Self {
            catalog,
            appointments,
        }
    }

    pub async fn branches(&self, query: SalonQuery) -> Result<BranchesResponse, AppError> {
        Ok(BranchesResponse {
            branches: self
                .catalog
                .public_branches(&query.salon_id)
                .await?
                .into_iter()
                .map(branch_dto)
                .collect(),
        })
    }

    pub async fn services(&self, query: BranchQuery) -> Result<ServicesResponse, AppError> {
        Ok(ServicesResponse {
            services: self
                .catalog
                .public_services(&query.salon_id, &query.branch_id)
                .await?
                .into_iter()
                .map(service_dto)
                .collect(),
        })
    }

    pub async fn staff(&self, query: StaffQuery) -> Result<StaffResponse, AppError> {
        let service = if let Some(service_id) = query.service_id.as_deref() {
            let id = mongodb::bson::oid::ObjectId::parse_str(service_id)
                .map_err(|_| AppError::Validation("A valid service is required.".to_string()))?;
            self.catalog.active_service(&query.salon_id, id).await?
        } else {
            None
        };
        let eligible = service
            .as_ref()
            .map(|service| service.eligible_staff_ids.as_slice())
            .unwrap_or(&[]);
        Ok(StaffResponse {
            staff: self
                .catalog
                .active_staff(&query.salon_id, &query.branch_id, eligible)
                .await?
                .into_iter()
                .map(staff_dto)
                .collect(),
        })
    }

    pub async fn slots(&self, query: SlotsQuery) -> Result<SlotsResponse, AppError> {
        let service_id = ObjectId::parse_str(&query.service_id)
            .map_err(|_| AppError::Validation("A valid service is required.".to_string()))?;
        let service = self
            .catalog
            .active_service(&query.salon_id, service_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Service was not found.".to_string()))?;
        let branch = self
            .catalog
            .active_branch(&query.salon_id, &query.branch_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch was not found.".to_string()))?;
        let hours = branch_hours_for_date(&branch, &query.date)?;
        let eligible = query
            .staff_id
            .clone()
            .map(|id| vec![id])
            .unwrap_or_else(|| service.eligible_staff_ids.clone());
        let staff = self
            .catalog
            .active_staff(&query.salon_id, &query.branch_id, &eligible)
            .await?;
        let max_slots = query.max_slots.unwrap_or(24).clamp(1, 48);
        let mut slots = Vec::new();
        let mut minute = minutes(&hours.open);
        let close = minutes(&hours.close);
        while minute + service.duration_minutes <= close && slots.len() < max_slots {
            if let Some((start_at, end_at)) =
                date_minutes_to_utc(&query.date, minute, service.duration_minutes)
            {
                for user in &staff {
                    let staff_id = user.staff_id.clone().unwrap_or_else(|| user.id.to_hex());
                    if self
                        .catalog
                        .schedule(&query.salon_id, &query.branch_id, &staff_id, &query.date)
                        .await?
                        .is_none()
                    {
                        continue;
                    }
                    if self
                        .catalog
                        .leave(&query.salon_id, &staff_id, &query.date)
                        .await?
                        .is_some()
                    {
                        continue;
                    }
                    let start_bson = DateTime::from_millis(start_at.timestamp_millis());
                    let end_bson = DateTime::from_millis(end_at.timestamp_millis());
                    if self
                        .appointments
                        .find_overlap(&query.salon_id, &staff_id, start_bson, end_bson)
                        .await?
                        .is_some()
                    {
                        continue;
                    }
                    if self
                        .appointments
                        .has_lock_overlap(&query.salon_id, &staff_id, start_bson, end_bson)
                        .await?
                    {
                        continue;
                    }
                    slots.push(PublicSlot {
                        start_at: start_at.to_rfc3339(),
                        end_at: end_at.to_rfc3339(),
                        staff_id,
                    });
                    break;
                }
            }
            minute += 30;
        }
        Ok(SlotsResponse { slots })
    }

    pub async fn book(&self, request: BookRequest) -> Result<BookResponse, AppError> {
        if request.customer_name.trim().is_empty() {
            return Err(AppError::Validation(
                "Customer name is required.".to_string(),
            ));
        }
        let phone = normalize_phone(&request.phone);
        if phone.len() < 7 {
            return Err(AppError::Validation(
                "A valid phone number is required.".to_string(),
            ));
        }
        let service_id = ObjectId::parse_str(&request.service_id)
            .map_err(|_| AppError::Validation("A valid service is required.".to_string()))?;
        let service = self
            .catalog
            .active_service(&request.salon_id, service_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Service was not found.".to_string()))?;
        let branch = self
            .catalog
            .active_branch(&request.salon_id, &request.branch_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch was not found.".to_string()))?;
        let start_at = chrono::DateTime::parse_from_rfc3339(&request.start_at)
            .map_err(|_| AppError::Validation("Invalid startAt timestamp.".to_string()))?
            .with_timezone(&chrono::Utc);
        let end_at = start_at + chrono::Duration::minutes(service.duration_minutes);
        validate_branch_hours_at(&branch, start_at, end_at)?;
        let eligible = request
            .preferred_staff_id
            .clone()
            .map(|id| vec![id])
            .unwrap_or_else(|| service.eligible_staff_ids.clone());
        let staff = self
            .catalog
            .active_staff(&request.salon_id, &request.branch_id, &eligible)
            .await?;
        let date = start_at.date_naive().to_string();
        let start_bson = DateTime::from_millis(start_at.timestamp_millis());
        let end_bson = DateTime::from_millis(end_at.timestamp_millis());
        let mut selected_staff = None;
        for user in staff {
            let staff_id = user.staff_id.unwrap_or_else(|| user.id.to_hex());
            if self
                .catalog
                .schedule(&request.salon_id, &request.branch_id, &staff_id, &date)
                .await?
                .is_none()
            {
                continue;
            }
            if self
                .catalog
                .leave(&request.salon_id, &staff_id, &date)
                .await?
                .is_some()
            {
                continue;
            }
            if self
                .appointments
                .find_overlap(&request.salon_id, &staff_id, start_bson, end_bson)
                .await?
                .is_some()
            {
                continue;
            }
            if self
                .appointments
                .has_lock_overlap(&request.salon_id, &staff_id, start_bson, end_bson)
                .await?
            {
                continue;
            }
            selected_staff = Some(staff_id);
            break;
        }
        let staff_id = selected_staff.ok_or_else(|| {
            AppError::Conflict(
                "No staff is available for this time. Please choose another slot.".to_string(),
            )
        })?;
        let appointment = AppointmentRecord {
            id: ObjectId::new(),
            salon_id: request.salon_id,
            branch_id: request.branch_id,
            staff_id,
            customer_id: None,
            customer_name: Some(request.customer_name.trim().to_string()),
            service_ids: vec![request.service_id],
            service_names: vec![service.name],
            duration_minutes: service.duration_minutes,
            value: service.price_paise,
            start_at: start_bson,
            end_at: end_bson,
            status: "booked".to_string(),
            source: Some("self_booking".to_string()),
            version: 1,
        };
        let appointment = self
            .appointments
            .create_with_customer_and_locks(appointment, Some(&phone))
            .await?;
        Ok(BookResponse {
            appointment_id: appointment.id.to_hex(),
            status: appointment.status,
            start_at: start_at.to_rfc3339(),
            end_at: end_at.to_rfc3339(),
            staff_id: appointment.staff_id,
        })
    }

    pub async fn cancel(&self, request: CancelRequest) -> Result<CancelResponse, AppError> {
        let phone = normalize_phone(&request.phone);
        let id = ObjectId::parse_str(&request.appointment_id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let appointment = self
            .appointments
            .find_by_id(&request.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment was not found.".to_string()))?;
        self.verify_phone(&appointment, &phone).await?;
        let previous_start_at = appointment
            .start_at
            .try_to_rfc3339_string()
            .unwrap_or_default();
        self.appointments
            .cancel_public(&request.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment was not found.".to_string()))?;
        Ok(CancelResponse {
            booking_id: request.appointment_id,
            status: "cancelled".to_string(),
            previous_start_at,
        })
    }

    pub async fn reschedule(
        &self,
        request: RescheduleRequest,
    ) -> Result<RescheduleResponse, AppError> {
        let phone = normalize_phone(&request.phone);
        let id = ObjectId::parse_str(&request.appointment_id)
            .map_err(|_| AppError::Validation("A valid appointment id is required.".to_string()))?;
        let mut appointment = self
            .appointments
            .find_by_id(&request.salon_id, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Appointment was not found.".to_string()))?;
        self.verify_phone(&appointment, &phone).await?;
        if let Some(branch_id) = request.branch_id {
            appointment.branch_id = branch_id;
        }
        let service_id = request
            .service_id
            .or_else(|| appointment.service_ids.first().cloned())
            .ok_or_else(|| {
                AppError::Validation("Could not determine the service to reschedule.".to_string())
            })?;
        let service = self
            .catalog
            .active_service(
                &request.salon_id,
                ObjectId::parse_str(&service_id).map_err(|_| {
                    AppError::Validation("A valid service is required.".to_string())
                })?,
            )
            .await?
            .ok_or_else(|| AppError::NotFound("Service was not found.".to_string()))?;
        let branch = self
            .catalog
            .active_branch(&request.salon_id, &appointment.branch_id)
            .await?
            .ok_or_else(|| AppError::NotFound("Branch was not found.".to_string()))?;
        let start_at = chrono::DateTime::parse_from_rfc3339(&request.new_start_at)
            .map_err(|_| AppError::Validation("newStartAt must be a valid date.".to_string()))?
            .with_timezone(&chrono::Utc);
        let end_at = start_at + chrono::Duration::minutes(service.duration_minutes);
        validate_branch_hours_at(&branch, start_at, end_at)?;
        let start_bson = DateTime::from_millis(start_at.timestamp_millis());
        let end_bson = DateTime::from_millis(end_at.timestamp_millis());
        if self
            .appointments
            .find_overlap(
                &request.salon_id,
                &appointment.staff_id,
                start_bson,
                end_bson,
            )
            .await?
            .is_some()
        {
            return Err(AppError::Conflict(
                "Requested time is not available.".to_string(),
            ));
        }
        let updated = self
            .appointments
            .reschedule_public(appointment, start_bson, end_bson)
            .await?;
        Ok(RescheduleResponse {
            booking_id: updated.id.to_hex(),
            status: "confirmed".to_string(),
            new_start_at: updated.start_at.try_to_rfc3339_string().unwrap_or_default(),
        })
    }

    async fn verify_phone(
        &self,
        appointment: &AppointmentRecord,
        phone: &str,
    ) -> Result<(), AppError> {
        if let Some(customer_id) = appointment.customer_id.as_deref() {
            let stored = self.appointments.customer_phone(customer_id).await?;
            if stored.as_deref() != Some(phone) {
                return Err(AppError::Authorization);
            }
        }
        Ok(())
    }
}

fn branch_dto(branch: BranchRecord) -> PublicBranch {
    PublicBranch {
        id: branch.id,
        name: branch.name,
        timezone: branch.timezone,
    }
}

fn service_dto(service: ServiceRecord) -> PublicService {
    PublicService {
        id: service.id.to_hex(),
        name: service.name,
        description: service.description,
        price_paise: service.price_paise,
        duration_minutes: service.duration_minutes,
    }
}

fn staff_dto(user: UserRecord) -> PublicStaff {
    PublicStaff {
        id: user.staff_id.unwrap_or_else(|| user.id.to_hex()),
        name: user.name,
        role: user.role_display_name.unwrap_or(user.role),
    }
}

fn branch_hours_for_date<'a>(
    branch: &'a BranchRecord,
    date: &str,
) -> Result<&'a BranchHoursRecord, AppError> {
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("date must be YYYY-MM-DD.".to_string()))?;
    let weekday = parsed.weekday().num_days_from_sunday() as i32;
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
    Ok(hours)
}

fn minutes(time: &str) -> i64 {
    let mut parts = time.split(':').filter_map(|part| part.parse::<i64>().ok());
    parts.next().unwrap_or(0) * 60 + parts.next().unwrap_or(0)
}

fn date_minutes_to_utc(
    date: &str,
    minute: i64,
    duration_minutes: i64,
) -> Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> {
    let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let start = date.and_hms_opt((minute / 60) as u32, (minute % 60) as u32, 0)?;
    let start = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(start, chrono::Utc);
    Some((start, start + chrono::Duration::minutes(duration_minutes)))
}

fn validate_branch_hours_at(
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

fn normalize_phone(phone: &str) -> String {
    phone.chars().filter(|ch| ch.is_ascii_digit()).collect()
}
