use bcrypt::hash;
use chrono::{Datelike, Timelike};
use mongodb::bson::{doc, oid::ObjectId, Bson, DateTime, Document};
use serde::{Deserialize, Serialize};
use solastio_auth::rbac::has_permission;
use solastio_database::{
    models::{AppointmentRecord, ClientPhotoRecord, CustomerRecord, StaffLeaveRecord, UserRecord},
    repositories::{AppointmentRepository, OwnerRepository},
};
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

const WHATSAPP_TEMPLATE_NAMES: [&str; 4] = [
    "solastio_feedback",
    "solastio_birthday",
    "solastio_rebooking",
    "solastio_loyalty",
];

#[derive(Clone)]
pub struct OwnerService {
    owner: OwnerRepository,
    appointments: AppointmentRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerListQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SettingsUpdate {
    pub settings: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotSettingsUpdate {
    #[serde(default)]
    pub branch_id: Option<String>,
    pub settings: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerAppointmentQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusyHoursQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    pub from_date: String,
    pub to_date: String,
}

#[derive(Debug, Deserialize)]
pub struct WhatsAppIntelligenceQuery {
    #[serde(default)]
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerStaffQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerLeaveQuery {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub view: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct OwnerLeaveDecisionRequest {
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerUserWrite {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub login_id: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub branch_ids: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerClientWrite {
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub birthday: Option<String>,
    #[serde(default)]
    pub anniversary: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub wallet_balance_paise: Option<i64>,
    #[serde(default)]
    pub loyalty_points: Option<i64>,
    #[serde(default)]
    pub membership_plan_name: Option<String>,
    #[serde(default)]
    pub membership_credits: Option<i64>,
    #[serde(default)]
    pub membership_credits_remaining: Option<i64>,
    #[serde(default)]
    pub membership_valid_until: Option<String>,
    #[serde(default)]
    pub membership_status: Option<String>,
    #[serde(default)]
    pub package_name: Option<String>,
    #[serde(default)]
    pub package_credits_remaining: Option<i64>,
    #[serde(default)]
    pub subscription_name: Option<String>,
    #[serde(default)]
    pub subscription_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOptOutRequest {
    pub opted_out: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPhotoWrite {
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T: Serialize> {
    pub items: Vec<T>,
    pub page: PageInfo,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub total: usize,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
}

impl OwnerService {
    pub fn new(owner: OwnerRepository, appointments: AppointmentRepository) -> Self {
        Self {
            owner,
            appointments,
        }
    }

    pub async fn dashboard(
        &self,
        context: &RequestContext,
        query: OwnerAppointmentQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let rows = self
            .appointment_rows(
                context,
                &branch_ids,
                query.from.as_deref(),
                query.to.as_deref(),
                500,
            )
            .await?;
        let billable: Vec<_> = rows
            .iter()
            .filter(|a| a.status != "cancelled" && a.status != "no_show")
            .collect();
        let completed = rows.iter().filter(|a| a.status == "completed").count();
        let cancelled = rows
            .iter()
            .filter(|a| a.status == "cancelled" || a.status == "no_show")
            .count();
        let appointment_value: i64 = billable.iter().map(|a| a.value).sum();
        Ok(
            serde_json::json!({ "summary": { "appointments": billable.len(), "todayAppointments": rows.len(), "completedAppointments": completed, "cancelledAppointments": cancelled, "appointmentValue": appointment_value }, "appointments": rows.into_iter().map(appointment_json).collect::<Vec<_>>() }),
        )
    }

    pub async fn appointments(
        &self,
        context: &RequestContext,
        query: OwnerAppointmentQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let limit = query.limit.unwrap_or(100).clamp(1, 500);
        let rows = self
            .appointment_rows(
                context,
                &branch_ids,
                query.from.as_deref(),
                query.to.as_deref(),
                limit,
            )
            .await?;
        let items: Vec<_> = rows.into_iter().map(appointment_json).collect();
        Ok(
            serde_json::json!({ "items": items, "page": { "total": items.len(), "limit": limit, "offset": 0, "hasMore": false }, "metadata": { "moneyUnit": "paise", "branchIds": branch_ids } }),
        )
    }

    pub async fn busy_hours(
        &self,
        context: &RequestContext,
        query: BusyHoursQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "admin:*"])?;
        validate_date(&query.from_date)?;
        validate_date(&query.to_date)?;
        let branch_id = query.branch_id.unwrap_or_else(|| "all".to_string());
        let branch_ids = branch_scope(context, Some(&branch_id));
        if branch_id != "all" && !branch_allowed(context, &branch_id) {
            return Err(AppError::Authorization);
        }
        let from = format!("{}T00:00:00Z", query.from_date);
        let to = format!("{}T23:59:59Z", query.to_date);
        let rows = self
            .appointment_rows(context, &branch_ids, Some(&from), Some(&to), 5000)
            .await?;
        let mut grouped = std::collections::BTreeMap::<(u32, u32), (i64, i64)>::new();
        for appointment in rows
            .into_iter()
            .filter(|a| a.status != "cancelled" && a.status != "no_show")
        {
            let chrono_dt = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(
                appointment.start_at.timestamp_millis(),
            )
            .ok_or(AppError::Internal)?;
            let day_of_week = chrono_dt.weekday().number_from_sunday();
            let hour = chrono_dt.hour();
            let entry = grouped.entry((day_of_week, hour)).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += appointment.value;
        }
        let max_appointments = grouped.values().map(|(count, _)| *count).max().unwrap_or(0);
        let cells = grouped
            .into_iter()
            .map(|((day_of_week, hour), (appointments, value_paise))| {
                let intensity = if max_appointments > 0 {
                    ((appointments * 100) + max_appointments / 2) / max_appointments
                } else {
                    0
                };
                serde_json::json!({
                    "dayOfWeek": day_of_week,
                    "hour": hour,
                    "appointments": appointments,
                    "valuePaise": value_paise,
                    "intensity": intensity,
                })
            })
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "cells": cells,
            "metadata": { "timezone": "Asia/Kolkata", "fromDate": query.from_date, "toDate": query.to_date, "branchId": branch_id }
        }))
    }

    async fn appointment_rows(
        &self,
        context: &RequestContext,
        branch_ids: &[String],
        from: Option<&str>,
        to: Option<&str>,
        limit: i64,
    ) -> Result<Vec<AppointmentRecord>, AppError> {
        let from = parse_rfc3339(from)?;
        let to = parse_rfc3339(to)?;
        self.appointments
            .list_for_owner(&context.salon_id, branch_ids, from, to, limit)
            .await
    }

    pub async fn branches(&self, context: &RequestContext) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        let branches: Vec<_> = self.owner.branches(&context.salon_id).await?.into_iter().map(|b| serde_json::json!({ "id": b.id, "name": b.name, "timezone": b.timezone, "status": b.status, "slotIntervalMinutes": b.slot_interval_minutes })).collect();
        Ok(serde_json::json!({ "items": branches }))
    }

    pub async fn staff(
        &self,
        context: &RequestContext,
        query: OwnerListQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:staff", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let staff: Vec<_> = self.owner.staff(&context.salon_id, &branch_ids).await?.into_iter().map(|u| serde_json::json!({ "id": u.staff_id.clone().unwrap_or_else(|| u.id.to_hex()), "branchId": u.branch_id, "employeeCode": u.staff_id.unwrap_or_default(), "fullName": u.name, "email": u.email.unwrap_or_default(), "status": u.status, "roleId": u.role, "designation": u.role_display_name.or(u.custom_role_name).unwrap_or_default(), "loginId": u.login_id, "version": 1 })).collect();
        Ok(
            serde_json::json!({ "items": staff, "page": { "total": staff.len(), "limit": 200, "offset": 0, "hasMore": false } }),
        )
    }

    pub async fn people_staff(
        &self,
        context: &RequestContext,
        query: OwnerStaffQuery,
    ) -> Result<serde_json::Value, AppError> {
        let result = self
            .staff(
                context,
                OwnerListQuery {
                    branch_id: query.branch_id,
                    limit: query.limit,
                },
            )
            .await?;
        let limit = query.limit.unwrap_or(200).clamp(1, 200);
        let offset = query.offset.unwrap_or(0).max(0);
        let items = result
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let total = items.len();
        let sliced = items
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "items": sliced,
            "page": { "total": total, "limit": limit, "offset": offset, "hasMore": offset + limit < total as i64 }
        }))
    }

    pub async fn leaves(
        &self,
        context: &RequestContext,
        query: OwnerLeaveQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:staff", "admin:*"])?;
        let limit = query.limit.unwrap_or(50).clamp(1, 200);
        let offset = query.offset.unwrap_or(0).max(0);
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let mut filter = doc! { "salonId": &context.salon_id };
        let mut scoped_staff_ids = self
            .owner
            .staff_ids_for_branches(&context.salon_id, &branch_ids)
            .await?;
        if let Some(search) = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let name_matches = self
                .owner
                .staff_ids_matching_name(&context.salon_id, search)
                .await?;
            filter.insert(
                "$or",
                vec![
                    doc! { "leaveType": { "$regex": format!("(?i){}", regex_escape(search)) } },
                    doc! { "reason": { "$regex": format!("(?i){}", regex_escape(search)) } },
                    doc! { "staffId": { "$in": name_matches } },
                ],
            );
        }
        if !scoped_staff_ids.is_empty() {
            scoped_staff_ids.sort();
            scoped_staff_ids.dedup();
            filter.insert("staffId", doc! { "$in": scoped_staff_ids });
        }
        if query.from.is_some() || query.to.is_some() {
            filter.insert(
                "startDate",
                doc! { "$lte": query.to.unwrap_or_else(|| "9999-12-31".to_string()) },
            );
            filter.insert(
                "endDate",
                doc! { "$gte": query.from.unwrap_or_else(|| "0000-01-01".to_string()) },
            );
        }
        let view = query.view.unwrap_or_else(|| "pending".to_string());
        let today = chrono::Utc::now().date_naive().to_string();
        match view.as_str() {
            "pending" | "approved" | "rejected" => {
                filter.insert("status", view);
            }
            "upcoming" => {
                filter.insert("status", doc! { "$in": ["pending", "approved"] });
                filter.insert("startDate", doc! { "$gte": today });
            }
            "past" => {
                filter.insert("endDate", doc! { "$lt": today });
            }
            _ => return Err(AppError::Validation("view is invalid.".to_string())),
        }
        let (docs, total) = self.owner.list_owner_leaves(filter, limit, offset).await?;
        let staff = self.staff_lookup(&context.salon_id, &docs).await?;
        Ok(serde_json::json!({
            "items": docs.iter().map(|leave| owner_leave_json(leave, staff.get(&leave.staff_id))).collect::<Vec<_>>(),
            "page": page_json(limit, offset, total),
            "availability": { "documents": { "available": false, "reason": "Leave documents are not stored in this deployment." } },
            "capabilities": { "actions": ["decide"] },
            "views": ["pending", "approved", "rejected", "upcoming", "past"],
            "metadata": { "timezone": "Asia/Kolkata", "supportedFilters": ["branchId", "from", "to", "view", "search"] }
        }))
    }

    pub async fn leave_detail(
        &self,
        context: &RequestContext,
        leave_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:staff", "admin:*"])?;
        let id = parse_object_id(leave_id, "leave")?;
        let leave = self
            .owner
            .find_owner_leave(&context.salon_id, id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound("Leave request was not found in your workspace.".to_string())
            })?;
        let staff = self
            .staff_lookup(&context.salon_id, std::slice::from_ref(&leave))
            .await?;
        let approved = self
            .owner
            .approved_leaves_for_staff(&context.salon_id, &leave.staff_id)
            .await?;
        let conflicts = self
            .owner
            .leave_conflicts(&context.salon_id, &leave)
            .await?;
        let mut used_by_type = std::collections::BTreeMap::new();
        for row in approved {
            *used_by_type.entry(row.leave_type).or_insert(0i64) += row.days;
        }
        let now = DateTime::now().try_to_rfc3339_string().unwrap_or_default();
        Ok(serde_json::json!({
            "leave": owner_leave_json(&leave, staff.get(&leave.staff_id)),
            "balances": used_by_type.into_iter().map(|(leave_type, used)| serde_json::json!({ "id": leave_type, "leaveType": leave_type, "openingBalance": 0, "accrued": 0, "used": used, "balance": 0, "updatedAt": now })).collect::<Vec<_>>(),
            "conflicts": conflicts.iter().map(|row| owner_leave_json(row, staff.get(&row.staff_id))).collect::<Vec<_>>(),
            "history": leave_history_json(&leave, staff.get(&leave.staff_id)),
            "availability": { "documents": { "available": false, "reason": "Leave documents are not stored in this deployment." } },
            "capabilities": { "actions": if leave.status == "pending" { vec!["approve", "reject"] } else { Vec::<&str>::new() } }
        }))
    }

    pub async fn decide_leave(
        &self,
        context: &RequestContext,
        leave_id: &str,
        decision: &str,
        request: OwnerLeaveDecisionRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let id = parse_object_id(leave_id, "leave")?;
        let leave = self
            .owner
            .find_owner_leave(&context.salon_id, id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound("Leave request was not found in your workspace.".to_string())
            })?;
        if leave.status != "pending" {
            return Err(AppError::Conflict(
                "This leave request was already decided.".to_string(),
            ));
        }
        let version = request.version.unwrap_or(leave.version);
        if version != leave.version {
            return Err(AppError::Conflict(
                "This request changed. Refresh and review it again.".to_string(),
            ));
        }
        let status = if decision == "approve" {
            "approved"
        } else {
            "rejected"
        };
        let note = request
            .reason
            .unwrap_or_default()
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        let updated = self
            .owner
            .decide_leave(
                &context.salon_id,
                id,
                version,
                status,
                &note,
                &context.user_id,
            )
            .await?
            .ok_or_else(|| {
                AppError::Conflict("This request changed. Refresh and review it again.".to_string())
            })?;
        let staff = self
            .staff_lookup(&context.salon_id, std::slice::from_ref(&updated))
            .await?;
        Ok(owner_leave_json(&updated, staff.get(&updated.staff_id)))
    }

    async fn staff_lookup(
        &self,
        salon_id: &str,
        leaves: &[StaffLeaveRecord],
    ) -> Result<std::collections::HashMap<String, (String, String)>, AppError> {
        let mut ids = leaves
            .iter()
            .map(|l| l.staff_id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        let users = self.owner.staff_by_staff_ids(salon_id, &ids).await?;
        Ok(users
            .into_iter()
            .filter_map(|u| u.staff_id.map(|id| (id, (u.name, u.branch_id))))
            .collect())
    }

    pub async fn clients(
        &self,
        context: &RequestContext,
        query: OwnerListQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:clients", "read:appointments", "admin:*"])?;
        let branch_ids = branch_scope(context, query.branch_id.as_deref());
        let limit = query.limit.unwrap_or(100).clamp(1, 200);
        let clients: Vec<_> = self.owner.clients(&context.salon_id, &branch_ids, limit).await?.into_iter().map(|c| serde_json::json!({ "id": c.id.to_hex(), "branchId": c.branch_id, "name": c.name, "phone": c.normalized_phone })).collect();
        Ok(
            serde_json::json!({ "items": clients, "page": { "total": clients.len(), "limit": limit, "offset": 0, "hasMore": false } }),
        )
    }

    pub async fn create_client(
        &self,
        context: &RequestContext,
        request: OwnerClientWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["create:clients", "update:clients", "admin:*"])?;
        let branch_id = required_trimmed(request.branch_id.clone(), "branchId")?;
        if !branch_allowed(context, &branch_id) {
            return Err(AppError::Authorization);
        }
        let name = required_trimmed(request.name.clone(), "name")?;
        let phone = normalize_phone(&required_trimmed(request.phone.clone(), "phone")?);
        if phone.len() < 5 {
            return Err(AppError::Validation(
                "phone must contain at least 5 digits.".to_string(),
            ));
        }
        let customer = customer_from_write(&context.salon_id, &branch_id, name, phone, request);
        let customer = self.owner.upsert_owner_customer(&customer).await?;
        Ok(serde_json::json!({ "id": customer.id.to_hex() }))
    }

    pub async fn update_client(
        &self,
        context: &RequestContext,
        client_id: &str,
        request: OwnerClientWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["create:clients", "update:clients", "admin:*"])?;
        let id = parse_object_id(client_id, "client")?;
        let branch_ids = branch_scope(context, None);
        let mut update = client_update_doc(request)?;
        if update.is_empty() {
            return Err(AppError::Validation(
                "No client fields to update.".to_string(),
            ));
        }
        update.insert("updatedAt", DateTime::now());
        let customer = self
            .owner
            .update_owner_customer(&context.salon_id, id, &branch_ids, update)
            .await?
            .ok_or_else(|| AppError::NotFound("Client not found.".to_string()))?;
        Ok(
            serde_json::json!({ "id": customer.id.to_hex(), "updatedAt": dt_str(customer.updated_at) }),
        )
    }

    pub async fn opt_out_client(
        &self,
        context: &RequestContext,
        client_id: &str,
        request: ClientOptOutRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["create:clients", "update:clients", "admin:*"])?;
        let id = parse_object_id(client_id, "client")?;
        let branch_ids = branch_scope(context, None);
        let customer = self
            .owner
            .update_owner_customer(
                &context.salon_id,
                id,
                &branch_ids,
                doc! { "marketingOptOut": request.opted_out, "updatedAt": DateTime::now() },
            )
            .await?
            .ok_or_else(|| AppError::NotFound("Client not found.".to_string()))?;
        Ok(
            serde_json::json!({ "id": customer.id.to_hex(), "marketingOptOut": customer.marketing_opt_out }),
        )
    }

    pub async fn client_detail(
        &self,
        context: &RequestContext,
        client_id: &str,
        query: OwnerListQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:clients", "read:appointments", "admin:*"])?;
        let id = parse_object_id(client_id, "client")?;
        let branch_ids = branch_scope(context, None);
        let customer = self
            .owner
            .find_owner_customer(&context.salon_id, id, &branch_ids)
            .await?
            .ok_or_else(|| AppError::NotFound("Client not found.".to_string()))?;
        let branch_filter = query.branch_id.as_deref();
        let customer_id = customer.id.to_hex();
        let appointments = self
            .owner
            .appointments_for_customer(&context.salon_id, &customer_id, branch_filter)
            .await?;
        let invoices = self
            .owner
            .invoices_for_customer(&context.salon_id, &customer_id, branch_filter)
            .await?;
        let photos = self
            .owner
            .photos_for_customer(&context.salon_id, &customer_id, branch_filter)
            .await?;
        let branch_names = self.branch_names(&context.salon_id).await?;
        let total_spend: i64 = invoices
            .iter()
            .map(|i| i.grand_total_paise)
            .sum::<i64>()
            .max(appointments.iter().map(|a| a.value).sum());
        let outstanding: i64 = invoices.iter().map(|i| i.due_amount_paise).sum();
        Ok(serde_json::json!({
            "client": client_detail_json(&customer, branch_names.get(&customer.branch_id).map(String::as_str), appointments.len() as i64, total_spend, outstanding),
            "appointments": appointments.iter().map(|a| client_appointment_json(a, branch_names.get(&a.branch_id).map(String::as_str))).collect::<Vec<_>>(),
            "purchases": invoices.iter().map(|i| client_purchase_json(i, branch_names.get(&i.branch_id).map(String::as_str))).collect::<Vec<_>>(),
            "photos": photos.iter().map(|p| client_photo_json(p, branch_names.get(&p.branch_id).map(String::as_str))).collect::<Vec<_>>(),
            "membership": if customer.membership_plan_name.is_empty() { serde_json::Value::Null } else { serde_json::json!({ "id": if customer.membership_id.is_empty() { customer.id.to_hex() } else { customer.membership_id.clone() }, "planName": customer.membership_plan_name, "planCredits": customer.membership_credits, "creditsRemaining": customer.membership_credits_remaining, "validityDate": customer.membership_valid_until, "status": if customer.membership_status.is_empty() { "active" } else { customer.membership_status.as_str() }, "branchId": customer.branch_id }) },
            "metadata": { "timezone": "Asia/Kolkata", "partial": false, "unavailableSources": [], "branchRelationship": [customer.branch_id] }
        }))
    }

    pub async fn add_client_photo(
        &self,
        context: &RequestContext,
        client_id: &str,
        request: ClientPhotoWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["create:clients", "update:clients", "admin:*"])?;
        if !branch_allowed(context, &request.branch_id) {
            return Err(AppError::Authorization);
        }
        if request.before_url.trim().is_empty() && request.after_url.trim().is_empty() {
            return Err(AppError::Validation(
                "Add at least one before or after photo URL.".to_string(),
            ));
        }
        let id = parse_object_id(client_id, "client")?;
        let branch_ids = branch_scope(context, None);
        self.owner
            .find_owner_customer(&context.salon_id, id, &branch_ids)
            .await?
            .ok_or_else(|| AppError::NotFound("Client not found.".to_string()))?;
        let photo = ClientPhotoRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            customer_id: client_id.to_string(),
            branch_id: request.branch_id,
            appointment_id: request.appointment_id,
            before_url: request.before_url,
            after_url: request.after_url,
            caption: request.caption,
            service_names: request.service_names,
            created_by_user_id: context.user_id.clone(),
            created_at: Some(DateTime::now()),
        };
        let photo = self.owner.create_client_photo(&photo).await?;
        Ok(serde_json::json!({ "photo": client_photo_json(&photo, None) }))
    }

    pub async fn delete_client_photo(
        &self,
        context: &RequestContext,
        client_id: &str,
        photo_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["create:clients", "update:clients", "admin:*"])?;
        let id = parse_object_id(photo_id, "photo")?;
        let branch_ids = branch_scope(context, None);
        self.owner
            .delete_client_photo(&context.salon_id, client_id, id, &branch_ids)
            .await?
            .ok_or_else(|| AppError::NotFound("Photo record not found.".to_string()))?;
        Ok(serde_json::json!({ "id": photo_id }))
    }

    async fn branch_names(
        &self,
        salon_id: &str,
    ) -> Result<std::collections::HashMap<String, String>, AppError> {
        Ok(self
            .owner
            .branches(salon_id)
            .await?
            .into_iter()
            .map(|b| (b.id, b.name))
            .collect())
    }

    pub async fn settings(
        &self,
        context: &RequestContext,
        query: SettingsQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        let branch_id = query.branch_id.unwrap_or_else(|| context.branch_id.clone());
        let settings = self.owner.settings(&context.salon_id, &branch_id).await?;
        Ok(
            serde_json::json!({ "branchId": branch_id, "settings": settings.map(|s| mongodb::bson::from_bson::<serde_json::Value>(mongodb::bson::Bson::Document(s.settings)).unwrap_or_else(|_| serde_json::json!({}))).unwrap_or_else(|| serde_json::json!({})), "supportedSections": ["workspace", "localization", "branchBehavior", "dateTime", "interface", "defaults", "whatsappNudges", "whatsappPolicy", "booking"] }),
        )
    }

    pub async fn whatsapp_bot_settings(
        &self,
        context: &RequestContext,
        query: SettingsQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "admin:*"])?;
        let branch_id = query.branch_id.unwrap_or_default();
        let settings = self.owner.settings(&context.salon_id, &branch_id).await?;
        let bot_settings = settings
            .and_then(|s| s.settings.get_document("whatsappBot").ok().cloned())
            .map(|doc| {
                mongodb::bson::from_bson::<serde_json::Value>(mongodb::bson::Bson::Document(doc))
                    .unwrap_or_else(|_| serde_json::json!({}))
            })
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(serde_json::json!({ "branchId": branch_id, "settings": bot_settings }))
    }

    pub async fn update_whatsapp_bot_settings(
        &self,
        context: &RequestContext,
        body: BotSettingsUpdate,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*", "update:settings"])?;
        let branch_id = body.branch_id.unwrap_or_default();
        let mut root = self
            .owner
            .settings(&context.salon_id, &branch_id)
            .await?
            .map(|s| s.settings)
            .unwrap_or_default();
        let bot_doc = mongodb::bson::to_document(&body.settings)
            .map_err(|_| AppError::Validation("settings must be an object.".to_string()))?;
        root.insert("whatsappBot", bot_doc);
        let updated = self
            .owner
            .update_settings(&context.salon_id, &branch_id, root, &context.user_id)
            .await?;
        let settings = updated
            .settings
            .get_document("whatsappBot")
            .ok()
            .cloned()
            .map(|doc| {
                mongodb::bson::from_bson::<serde_json::Value>(mongodb::bson::Bson::Document(doc))
                    .unwrap_or_else(|_| serde_json::json!({}))
            })
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(serde_json::json!({ "branchId": branch_id, "settings": settings }))
    }

    pub async fn whatsapp_intelligence(
        &self,
        context: &RequestContext,
        query: WhatsAppIntelligenceQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:appointments", "admin:*"])?;
        let days = query.days.unwrap_or(30).clamp(1, 365);
        let since_chrono = chrono::Utc::now() - chrono::Duration::days(days);
        let since = DateTime::from_millis(since_chrono.timestamp_millis());
        let (outbound, inbound, sessions, customers, templates, waitlist) = self
            .owner
            .whatsapp_intelligence_docs(&context.salon_id, since)
            .await?;

        let mut action_counts = std::collections::BTreeMap::<String, i64>::new();
        let mut status_counts = std::collections::BTreeMap::<String, i64>::new();
        for row in &outbound {
            let action = row
                .get_document("metadata")
                .ok()
                .and_then(|m| bson_str(m, "action"))
                .unwrap_or_else(|| bson_str(row, "type").unwrap_or_else(|| "unknown".to_string()));
            *action_counts.entry(action).or_insert(0) += 1;
            let status = bson_str(row, "status").unwrap_or_else(|| "unknown".to_string());
            *status_counts.entry(status).or_insert(0) += 1;
        }

        let mut top_services = std::collections::BTreeMap::<String, i64>::new();
        let keywords = [
            "haircut",
            "hair spa",
            "hair colour",
            "facial",
            "beard",
            "massage",
            "wax",
            "threading",
            "manicure",
            "pedicure",
        ];
        for row in &inbound {
            let text = bson_str(row, "text").unwrap_or_default().to_lowercase();
            for keyword in keywords {
                if text.contains(keyword) {
                    *top_services.entry(keyword.to_string()).or_insert(0) += 1;
                }
            }
        }
        let mut top_services = top_services.into_iter().collect::<Vec<_>>();
        top_services.sort_by_key(|item| std::cmp::Reverse(item.1));

        let required = WHATSAPP_TEMPLATE_NAMES
            .iter()
            .map(|name| {
                let matching = templates
                    .iter()
                    .filter(|t| bson_str(t, "name").as_deref() == Some(*name))
                    .collect::<Vec<_>>();
                let ready = matching.iter().any(|t| {
                    bson_str(t, "status")
                        .map(|s| s.eq_ignore_ascii_case("approved"))
                        .unwrap_or(false)
                });
                serde_json::json!({
                    "name": name,
                    "ready": ready,
                    "templates": matching.into_iter().map(template_doc_json).collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();

        let tagged = customers
            .iter()
            .map(|c| serde_json::json!({
                "id": c.id.to_hex(),
                "name": if c.name.is_empty() { c.normalized_phone.as_str() } else { c.name.as_str() },
                "phone": c.normalized_phone,
                "tags": c.tags,
                "preferredStaffIds": Vec::<String>::new(),
                "favoriteServiceIds": Vec::<String>::new(),
                "visitCount": c.visit_count,
                "lastBookedAt": dt_str(c.last_booked_at),
                "interactionStatus": c.interaction_status,
            }))
            .collect::<Vec<_>>();

        let now = DateTime::now();
        let failed_sends = outbound
            .iter()
            .filter(|row| bson_str(row, "status").as_deref() == Some("failed"))
            .count();
        let stuck_sessions = sessions
            .iter()
            .filter(|row| {
                bson_date(row, "expiresAt")
                    .map(|dt| dt < now && bson_str(row, "state").as_deref() != Some("menu"))
                    .unwrap_or(false)
            })
            .count();
        let repeated_misunderstandings = sessions
            .iter()
            .filter(|row| bson_i64(row, "consecutiveFailures") >= 2)
            .count();

        Ok(serde_json::json!({
            "analytics": {
                "since": since.try_to_rfc3339_string().unwrap_or_default(),
                "inboundCount": inbound.len(),
                "outboundCount": outbound.len(),
                "actionCounts": action_counts,
                "statusCounts": status_counts,
                "topServices": top_services.into_iter().take(10).map(|(name, count)| serde_json::json!({ "name": name, "count": count })).collect::<Vec<_>>()
            },
            "health": { "failedSends": failed_sends, "stuckSessions": stuck_sessions, "repeatedMisunderstandings": repeated_misunderstandings },
            "templateReadiness": required,
            "waitlist": waitlist.iter().map(waitlist_doc_json).collect::<Vec<_>>(),
            "qualityQueue": inbound.iter().filter(|row| media_review_text(&bson_str(row, "text").unwrap_or_default())).take(25).map(|row| serde_json::json!({ "id": doc_id(row), "phone": bson_str(row, "waPhone").unwrap_or_default(), "name": bson_str(row, "profileName").unwrap_or_else(|| bson_str(row, "waPhone").unwrap_or_default()), "text": bson_str(row, "text").unwrap_or_default(), "receivedAt": bson_date_str(row, "receivedAt"), "reason": "manual_review" })).collect::<Vec<_>>(),
            "campaignSegments": campaign_segments(&tagged),
            "customers": tagged
        }))
    }

    pub async fn access(&self, context: &RequestContext) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["read:staff", "admin:*"])?;
        self.access_response(&context.salon_id).await
    }

    pub async fn create_user(
        &self,
        context: &RequestContext,
        request: OwnerUserWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let name = required_trimmed(request.name, "name")?;
        let login_id = required_trimmed(request.login_id, "loginId")?;
        let role = required_trimmed(request.role, "role")?;
        let branch_ids = request
            .branch_ids
            .filter(|v| !v.is_empty())
            .ok_or_else(|| {
                AppError::Validation("branchIds must contain at least one branch.".to_string())
            })?;
        let status = request.status.unwrap_or_else(|| "active".to_string());
        validate_user_status(&status)?;
        let login_id_normalized = login_id.trim().to_lowercase();
        let password = request
            .password
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| {
                format!(
                    "Temp-{}-{login_id_normalized}",
                    DateTime::now().timestamp_millis()
                )
            });
        if password.len() < 8 {
            return Err(AppError::Validation(
                "password must be at least 8 characters.".to_string(),
            ));
        }
        let password_hash = hash(password, 12).map_err(|_| AppError::Internal)?;
        let default_permissions = default_user_permissions();
        let user = UserRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            login_id,
            login_id_normalized: login_id_normalized.clone(),
            email: request.email.filter(|v| !v.trim().is_empty()),
            name,
            password_hash,
            role: role.clone(),
            role_display_name: Some(role.clone()),
            custom_role_name: None,
            staff_id: if role == "owner" {
                None
            } else {
                Some(format!("{login_id_normalized}_staff"))
            },
            branch_id: branch_ids[0].clone(),
            branch_ids,
            staff_app_permissions: default_permissions.clone(),
            crm_permissions: default_permissions,
            status,
            totp_enabled: false,
            totp_secret: None,
            recovery_codes: Vec::new(),
            refresh_tokens: Vec::new(),
            hourly_rate_paise: 0,
        };
        let user = self.owner.create_user(&user).await?;
        Ok(
            serde_json::json!({ "user": user_access_json(&user), "access": self.access_response(&context.salon_id).await? }),
        )
    }

    pub async fn update_user(
        &self,
        context: &RequestContext,
        user_id: &str,
        request: OwnerUserWrite,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let mut update = doc! {};
        if let Some(name) = request
            .name
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            update.insert("name", name);
        }
        if let Some(login_id) = request
            .login_id
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            update.insert("loginId", login_id.clone());
            update.insert("loginIdNormalized", login_id.to_lowercase());
        }
        if let Some(email) = request.email {
            if email.trim().is_empty() {
                update.insert("email", mongodb::bson::Bson::Null);
            } else {
                update.insert("email", email);
            }
        }
        if let Some(role) = request
            .role
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            update.insert("role", role.clone());
            update.insert("roleDisplayName", role);
        }
        if let Some(branch_ids) = request.branch_ids.filter(|v| !v.is_empty()) {
            update.insert("branchId", branch_ids[0].clone());
            update.insert("branchIds", branch_ids);
        }
        if let Some(status) = request.status {
            validate_user_status(&status)?;
            update.insert("status", status);
        }
        if let Some(password) = request.password.filter(|p| !p.is_empty()) {
            if password.len() < 8 {
                return Err(AppError::Validation(
                    "password must be at least 8 characters.".to_string(),
                ));
            }
            update.insert(
                "passwordHash",
                hash(password, 12).map_err(|_| AppError::Internal)?,
            );
        }
        if update.is_empty() {
            return Err(AppError::Validation(
                "No user fields to update.".to_string(),
            ));
        }
        let id = parse_object_id(user_id, "user")?;
        let user = self
            .owner
            .update_user(&context.salon_id, id, update)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found.".to_string()))?;
        Ok(
            serde_json::json!({ "user": user_access_json(&user), "access": self.access_response(&context.salon_id).await? }),
        )
    }

    pub async fn role_response(
        &self,
        context: &RequestContext,
        role: Option<&str>,
        branch_id: Option<&str>,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*"])?;
        let access = self.access_response(&context.salon_id).await?;
        let roles = access
            .get("roles")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let selected = role
            .and_then(|wanted| {
                roles
                    .iter()
                    .find(|r| r.get("role").and_then(|v| v.as_str()) == Some(wanted))
                    .cloned()
            })
            .or_else(|| roles.first().cloned())
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(serde_json::json!({
            "role": selected,
            "access": access,
            "invalidatedUsers": 0,
            "requiresReauthentication": false,
            "impact": { "affectedUsers": 0, "activeAffectedUsers": 0, "requiresReauthentication": false, "permissionVersionIncremented": 0, "affectedActiveSessions": 0, "scope": "tenant", "branchId": branch_id.unwrap_or("") }
        }))
    }

    async fn access_response(&self, salon_id: &str) -> Result<serde_json::Value, AppError> {
        let branches = self.owner.branches(salon_id).await?;
        let users = self.owner.users(salon_id).await?;
        let default_permissions = default_user_permissions();
        let roles = ["owner", "admin", "manager", "receptionist", "stylist"]
            .iter()
            .map(|role| {
                let assigned = users.iter().filter(|u| u.role == *role).count();
                let active = users
                    .iter()
                    .filter(|u| u.role == *role && u.status == "active")
                    .count();
                serde_json::json!({
                    "role": role,
                    "name": capitalize(role),
                    "description": "Default access role",
                    "isSystem": true,
                    "status": "active",
                    "permissionKeys": default_permissions,
                    "editable": *role != "owner",
                    "configuredKeys": [],
                    "inheritedKeys": [],
                    "effectiveKeys": default_permissions,
                    "allowKeys": [],
                    "denyKeys": [],
                    "policyMode": "inherited",
                    "policySource": "default",
                    "editablePolicy": *role != "owner",
                    "kind": "system",
                    "assignedUserCount": assigned,
                    "activeAssignedUserCount": active,
                })
            })
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "branches": branches.into_iter().map(|b| serde_json::json!({ "id": b.id, "name": b.name, "timezone": b.timezone, "status": b.status, "slotIntervalMinutes": b.slot_interval_minutes })).collect::<Vec<_>>(),
            "roles": roles,
            "users": users.iter().map(user_access_json).collect::<Vec<_>>(),
            "permissionGroups": permission_groups(),
            "capabilities": { "createRole": true, "editCustomRole": true, "editBuiltinStaffAppPolicy": false, "restoreRoleDefaults": true, "duplicateRole": true, "setCustomRoleStatus": true, "createUser": true, "updateUser": true, "disableUser": true },
            "safeguards": { "lastActiveOwner": true, "ownerEssentialAccess": true, "assignmentsLimitedToOwnerBranches": true, "permissionVersionInvalidation": true }
        }))
    }

    pub async fn update_settings(
        &self,
        context: &RequestContext,
        query: SettingsQuery,
        body: SettingsUpdate,
    ) -> Result<serde_json::Value, AppError> {
        require_owner(context)?;
        require_any(context, &["admin:*", "update:settings"])?;
        let branch_id = query.branch_id.unwrap_or_else(|| context.branch_id.clone());
        let doc = mongodb::bson::to_document(&body.settings)
            .map_err(|_| AppError::Validation("settings must be an object.".to_string()))?;
        let updated = self
            .owner
            .update_settings(&context.salon_id, &branch_id, doc, &context.user_id)
            .await?;
        Ok(
            serde_json::json!({ "branchId": branch_id, "settings": mongodb::bson::from_bson::<serde_json::Value>(mongodb::bson::Bson::Document(updated.settings)).unwrap_or_else(|_| serde_json::json!({})), "audit": { "lastChangedBy": updated.last_changed_by } }),
        )
    }
}

fn parse_rfc3339(value: Option<&str>) -> Result<Option<mongodb::bson::DateTime>, AppError> {
    value
        .map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .map(|dt| mongodb::bson::DateTime::from_millis(dt.timestamp_millis()))
                .map_err(|_| {
                    AppError::Validation("Date filters must be RFC3339 timestamps.".to_string())
                })
        })
        .transpose()
}

fn parse_object_id(id: &str, what: &str) -> Result<ObjectId, AppError> {
    ObjectId::parse_str(id).map_err(|_| AppError::Validation(format!("Invalid {what} id: {id}.")))
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

fn regex_escape(value: &str) -> String {
    const METACHARS: [char; 14] = [
        '\\', '.', '+', '*', '?', '^', '$', '(', ')', '[', ']', '{', '}', '|',
    ];
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        if METACHARS.contains(&c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn page_json(limit: i64, offset: i64, total: u64) -> serde_json::Value {
    let next_offset = if offset + limit < total as i64 {
        Some(offset + limit)
    } else {
        None
    };
    serde_json::json!({
        "limit": limit,
        "offset": offset,
        "total": total,
        "hasMore": next_offset.is_some(),
        "nextOffset": next_offset,
    })
}

fn dt_str(value: Option<DateTime>) -> String {
    value
        .and_then(|dt| dt.try_to_rfc3339_string().ok())
        .unwrap_or_default()
}

fn owner_leave_json(
    leave: &StaffLeaveRecord,
    staff: Option<&(String, String)>,
) -> serde_json::Value {
    let approved = leave.status == "approved";
    let rejected = leave.status == "rejected";
    serde_json::json!({
        "id": leave.id.to_hex(),
        "branchId": staff.map(|s| s.1.as_str()).unwrap_or(""),
        "staffId": leave.staff_id,
        "staffName": staff.map(|s| s.0.as_str()).unwrap_or(leave.staff_id.as_str()),
        "leaveType": leave.leave_type,
        "startDate": leave.start_date,
        "endDate": leave.end_date,
        "days": leave.days,
        "reason": leave.reason,
        "status": leave.status,
        "rejectionReason": if rejected && !leave.decision_note.is_empty() { Some(leave.decision_note.as_str()) } else { None },
        "approvedAt": if approved { Some(dt_str(leave.decided_at)) } else { None },
        "decisionNote": leave.decision_note,
        "documentAvailable": false,
        "version": leave.version,
    })
}

fn required_trimmed(value: Option<String>, field: &str) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_string();
    if value.is_empty() {
        Err(AppError::Validation(format!("{field} is required.")))
    } else if value.chars().count() > 160 {
        Err(AppError::Validation(format!(
            "{field} must be at most 160 characters."
        )))
    } else {
        Ok(value)
    }
}

fn validate_user_status(status: &str) -> Result<(), AppError> {
    if ["active", "disabled", "suspended"].contains(&status) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "status must be active, disabled, or suspended.".to_string(),
        ))
    }
}

fn default_user_permissions() -> Vec<String> {
    [
        "read:appointments",
        "create:appointments",
        "update:appointments",
        "read:clients",
        "create:clients",
        "update:clients",
    ]
    .iter()
    .map(|p| p.to_string())
    .collect()
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn permission_groups() -> Vec<serde_json::Value> {
    let appointments = [
        "read:appointments",
        "create:appointments",
        "update:appointments",
    ];
    let clients = ["read:clients", "create:clients", "update:clients"];
    vec![
        serde_json::json!({
            "key": "appointments",
            "label": "Appointments",
            "items": appointments.iter().map(|key| permission_item(key, "appointments", false)).collect::<Vec<_>>()
        }),
        serde_json::json!({
            "key": "clients",
            "label": "Clients",
            "items": clients.iter().map(|key| permission_item(key, "clients", true)).collect::<Vec<_>>()
        }),
    ]
}

fn permission_item(key: &str, resource: &str, sensitive: bool) -> serde_json::Value {
    serde_json::json!({
        "key": key,
        "label": key,
        "resource": resource,
        "action": key.split(':').next().unwrap_or(""),
        "sensitive": sensitive,
    })
}

fn user_access_json(user: &UserRecord) -> serde_json::Value {
    serde_json::json!({
        "id": user.id.to_hex(),
        "name": user.name,
        "loginId": user.login_id,
        "email": user.email.clone().unwrap_or_default(),
        "role": user.role,
        "branchIds": if user.branch_ids.is_empty() { vec![user.branch_id.clone()] } else { user.branch_ids.clone() },
        "status": user.status,
        "isLocked": false,
        "permissionVersion": 1,
        "lastLoginAt": "",
        "activeSessions": 0,
        "staffId": user.staff_id,
    })
}

fn bson_str(doc: &Document, key: &str) -> Option<String> {
    match doc.get(key) {
        Some(Bson::String(value)) => Some(value.clone()),
        Some(value) => Some(value.to_string()),
        None => None,
    }
}

fn bson_i64(doc: &Document, key: &str) -> i64 {
    match doc.get(key) {
        Some(Bson::Int32(value)) => *value as i64,
        Some(Bson::Int64(value)) => *value,
        Some(Bson::Double(value)) => *value as i64,
        _ => 0,
    }
}

fn bson_bool(doc: &Document, key: &str) -> bool {
    matches!(doc.get(key), Some(Bson::Boolean(true)))
}

fn bson_date(doc: &Document, key: &str) -> Option<DateTime> {
    match doc.get(key) {
        Some(Bson::DateTime(value)) => Some(*value),
        _ => None,
    }
}

fn bson_date_str(doc: &Document, key: &str) -> String {
    bson_date(doc, key)
        .and_then(|dt| dt.try_to_rfc3339_string().ok())
        .unwrap_or_default()
}

fn doc_id(doc: &Document) -> String {
    match doc.get("_id") {
        Some(Bson::ObjectId(id)) => id.to_hex(),
        Some(Bson::String(id)) => id.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

fn template_doc_json(doc: &Document) -> serde_json::Value {
    serde_json::json!({
        "id": doc_id(doc),
        "name": bson_str(doc, "name").unwrap_or_default(),
        "language": bson_str(doc, "language").unwrap_or_default(),
        "status": bson_str(doc, "status").unwrap_or_default(),
        "category": bson_str(doc, "category").unwrap_or_default(),
        "lastSyncedAt": bson_date_str(doc, "lastSyncedAt"),
    })
}

fn waitlist_doc_json(doc: &Document) -> serde_json::Value {
    let service_names = match doc.get("serviceNames") {
        Some(Bson::Array(values)) => values
            .iter()
            .filter_map(|v| match v {
                Bson::String(s) => Some(s.clone()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    serde_json::json!({
        "id": doc_id(doc),
        "branchId": bson_str(doc, "branchId").unwrap_or_default(),
        "staffId": bson_str(doc, "staffId").unwrap_or_default(),
        "serviceNames": service_names,
        "date": bson_str(doc, "date").unwrap_or_default(),
        "preferredTime": bson_str(doc, "preferredTime").unwrap_or_default(),
        "customerPhone": bson_str(doc, "customerPhone").unwrap_or_default(),
        "status": bson_str(doc, "status").unwrap_or_default(),
        "notified": bson_bool(doc, "notified"),
        "opportunityExpiresAt": bson_date_str(doc, "opportunityExpiresAt"),
        "createdAt": bson_date_str(doc, "createdAt"),
    })
}

fn media_review_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "[audio]",
        "[image]",
        "[document]",
        "[video]",
        "[unsupported]",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn campaign_segments(customers: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let segments = [
        (
            "hot_leads",
            vec!["hot_lead", "walk_in_interest", "availability_shopper"],
        ),
        ("price_shoppers", vec!["price_shopper"]),
        (
            "rebook_candidates",
            vec!["rebook_candidate", "whatsapp_booked"],
        ),
        (
            "service_recovery",
            vec!["service_recovery", "negative_feedback"],
        ),
        ("group_bookings", vec!["group_booking"]),
    ];
    segments
        .into_iter()
        .map(|(key, tags)| {
            let count = customers
                .iter()
                .filter(|customer| {
                    customer
                        .get("tags")
                        .and_then(|v| v.as_array())
                        .map(|customer_tags| {
                            tags.iter().any(|tag| {
                                customer_tags
                                    .iter()
                                    .any(|value| value.as_str() == Some(tag))
                            })
                        })
                        .unwrap_or(false)
                })
                .count();
            serde_json::json!({ "key": key, "tags": tags, "count": count })
        })
        .collect()
}

fn customer_from_write(
    salon_id: &str,
    branch_id: &str,
    name: String,
    phone: String,
    request: OwnerClientWrite,
) -> CustomerRecord {
    CustomerRecord {
        id: ObjectId::new(),
        salon_id: salon_id.to_string(),
        branch_id: branch_id.to_string(),
        name,
        normalized_phone: phone,
        email: request.email.unwrap_or_default(),
        interaction_status: "active".to_string(),
        visit_count: 0,
        last_booked_at: None,
        wallet_balance_paise: request.wallet_balance_paise.unwrap_or(0).max(0),
        loyalty_points: request.loyalty_points.unwrap_or(0).max(0),
        membership_id: String::new(),
        membership_plan_name: request.membership_plan_name.unwrap_or_default(),
        membership_credits: request.membership_credits.unwrap_or(0).max(0),
        membership_credits_remaining: request.membership_credits_remaining.unwrap_or(0).max(0),
        membership_valid_until: request.membership_valid_until.unwrap_or_default(),
        membership_status: request.membership_status.unwrap_or_default(),
        package_name: request.package_name.unwrap_or_default(),
        package_credits_remaining: request.package_credits_remaining.unwrap_or(0).max(0),
        subscription_name: request.subscription_name.unwrap_or_default(),
        subscription_status: request.subscription_status.unwrap_or_default(),
        marketing_opt_out: false,
        gender: request.gender.unwrap_or_default(),
        birthday: request.birthday.unwrap_or_default(),
        anniversary: request.anniversary.unwrap_or_default(),
        tags: request.tags.unwrap_or_default(),
        notes: request.notes.unwrap_or_default(),
        address: request.address.unwrap_or_default(),
        created_at: Some(DateTime::now()),
        updated_at: Some(DateTime::now()),
    }
}

fn client_update_doc(request: OwnerClientWrite) -> Result<mongodb::bson::Document, AppError> {
    let mut update = doc! {};
    if let Some(name) = request
        .name
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        update.insert("name", name);
    }
    if let Some(email) = request.email {
        update.insert("email", email);
    }
    if let Some(value) = request.gender {
        update.insert("gender", value);
    }
    if let Some(value) = request.birthday {
        update.insert("birthday", value);
    }
    if let Some(value) = request.anniversary {
        update.insert("anniversary", value);
    }
    if let Some(value) = request.tags {
        update.insert("tags", value);
    }
    if let Some(value) = request.notes {
        update.insert("notes", value);
    }
    if let Some(value) = request.address {
        update.insert("address", value);
    }
    if let Some(value) = request.wallet_balance_paise {
        update.insert("walletBalancePaise", value.max(0));
    }
    if let Some(value) = request.loyalty_points {
        update.insert("loyaltyPoints", value.max(0));
    }
    if let Some(value) = request.membership_plan_name {
        update.insert("membershipPlanName", value);
    }
    if let Some(value) = request.membership_credits {
        update.insert("membershipCredits", value.max(0));
    }
    if let Some(value) = request.membership_credits_remaining {
        update.insert("membershipCreditsRemaining", value.max(0));
    }
    if let Some(value) = request.membership_valid_until {
        update.insert("membershipValidUntil", value);
    }
    if let Some(value) = request.membership_status {
        update.insert("membershipStatus", value);
    }
    if let Some(value) = request.package_name {
        update.insert("packageName", value);
    }
    if let Some(value) = request.package_credits_remaining {
        update.insert("packageCreditsRemaining", value.max(0));
    }
    if let Some(value) = request.subscription_name {
        update.insert("subscriptionName", value);
    }
    if let Some(value) = request.subscription_status {
        update.insert("subscriptionStatus", value);
    }
    Ok(update)
}

fn client_detail_json(
    customer: &CustomerRecord,
    branch_name: Option<&str>,
    visit_count: i64,
    total_spend_paise: i64,
    outstanding_paise: i64,
) -> serde_json::Value {
    serde_json::json!({
        "id": customer.id.to_hex(),
        "name": if customer.name.is_empty() { customer.normalized_phone.as_str() } else { customer.name.as_str() },
        "phone": customer.normalized_phone,
        "email": customer.email,
        "branchId": customer.branch_id,
        "branchName": branch_name.unwrap_or(customer.branch_id.as_str()),
        "status": customer.interaction_status,
        "visitCount": visit_count.max(customer.visit_count),
        "totalSpendPaise": total_spend_paise,
        "lastVisitAt": dt_str(customer.last_booked_at),
        "walletBalancePaise": customer.wallet_balance_paise,
        "loyaltyPoints": customer.loyalty_points,
        "membershipId": customer.membership_id,
        "membershipPlanName": customer.membership_plan_name,
        "packageName": customer.package_name,
        "packageCreditsRemaining": customer.package_credits_remaining,
        "subscriptionName": customer.subscription_name,
        "subscriptionStatus": customer.subscription_status,
        "outstandingPaise": outstanding_paise,
        "createdAt": dt_str(customer.created_at),
        "updatedAt": dt_str(customer.updated_at),
        "gender": customer.gender,
        "birthday": customer.birthday,
        "anniversary": customer.anniversary,
        "tags": customer.tags,
        "notes": customer.notes,
        "address": customer.address,
    })
}

fn client_appointment_json(
    appointment: &AppointmentRecord,
    branch_name: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "id": appointment.id.to_hex(),
        "branchId": appointment.branch_id,
        "branchName": branch_name.unwrap_or(appointment.branch_id.as_str()),
        "startAt": appointment.start_at.try_to_rfc3339_string().unwrap_or_default(),
        "endAt": appointment.end_at.try_to_rfc3339_string().unwrap_or_default(),
        "status": appointment.status,
        "serviceIds": appointment.service_ids,
        "notes": appointment.service_names.join(", "),
        "staffId": appointment.staff_id,
        "staffName": appointment.staff_id,
        "spendPaise": appointment.value,
        "createdAt": "",
    })
}

fn client_purchase_json(
    invoice: &solastio_database::models::InvoiceRecord,
    branch_name: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "id": invoice.id.to_hex(),
        "branchId": invoice.branch_id,
        "branchName": branch_name.unwrap_or(invoice.branch_id.as_str()),
        "items": invoice.lines,
        "totalPaise": invoice.grand_total_paise,
        "paidPaise": invoice.paid_amount_paise,
        "balancePaise": invoice.due_amount_paise,
        "status": invoice.payment_status,
        "createdAt": dt_str(invoice.created_at),
        "invoiceId": invoice.id.to_hex(),
        "invoiceNumber": invoice.invoice_number,
    })
}

fn client_photo_json(photo: &ClientPhotoRecord, branch_name: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "id": photo.id.to_hex(),
        "branchId": photo.branch_id,
        "branchName": branch_name.unwrap_or(photo.branch_id.as_str()),
        "appointmentId": photo.appointment_id,
        "beforeUrl": photo.before_url,
        "afterUrl": photo.after_url,
        "caption": photo.caption,
        "serviceNames": photo.service_names,
        "createdAt": dt_str(photo.created_at),
    })
}

fn leave_history_json(
    leave: &StaffLeaveRecord,
    staff: Option<&(String, String)>,
) -> Vec<serde_json::Value> {
    let mut history = vec![serde_json::json!({
        "action": "requested",
        "at": dt_str(leave.created_at),
        "by": staff.map(|s| s.0.as_str()).unwrap_or(leave.staff_id.as_str()),
    })];
    if leave.decided_at.is_some() && !leave.decided_by.is_empty() {
        history.push(serde_json::json!({
            "action": if leave.status == "approved" { "approved" } else { "rejected" },
            "at": dt_str(leave.decided_at),
            "by": leave.decided_by,
        }));
    }
    history
}

fn appointment_json(a: AppointmentRecord) -> serde_json::Value {
    serde_json::json!({ "id": a.id.to_hex(), "branchId": a.branch_id, "clientId": a.customer_id.unwrap_or_default(), "staffId": a.staff_id, "serviceIds": a.service_ids, "serviceNames": a.service_names, "startAt": a.start_at.try_to_rfc3339_string().unwrap_or_default(), "endAt": a.end_at.try_to_rfc3339_string().unwrap_or_default(), "status": a.status, "source": a.source.unwrap_or_else(|| "crm".to_string()), "clientName": a.customer_name.unwrap_or_else(|| "Walk-in".to_string()), "touchupCostPaise": a.value, "version": a.version })
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

fn normalize_phone(value: &str) -> String {
    value.chars().filter(|c| c.is_ascii_digit()).collect()
}
