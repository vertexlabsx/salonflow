use crate::models::{
    AppointmentRecord, AttendanceRecord, AuditLogRecord, BranchRecord, BundleDealRecord,
    ClientPhotoRecord, ConversationMessageRecord, ConversationRecord, CustomerRecord,
    ExpenseRecord, GiftCardRecord, InvoiceRecord, LeaveRecord, NotificationRecord,
    OwnerSettingsRecord, PayrollItemRecord, PayrollRunRecord, PromoCodeRecord,
    PromoRedemptionRecord, PurchaseOrderRecord, RefreshTokenRecord, SalonRecord, ScheduleRecord,
    ServiceRecord, ShiftSwapRecord, ShopifyUserRecord, StaffLeaveRecord, StaffTaskRecord,
    TargetRecord, TipRecord, UserRecord,
};
use mongodb::options::{FindOneAndUpdateOptions, ReturnDocument};
use mongodb::{
    bson::{doc, oid::ObjectId, DateTime, Document},
    Collection, Database,
};
use solastio_shared::error::AppError;

#[derive(Clone)]
pub struct UserRepository {
    users: Collection<UserRecord>,
}

#[derive(Clone)]
pub struct ShopifyUserRepository {
    users: Collection<ShopifyUserRecord>,
    stores: Collection<Document>,
    flows: Collection<Document>,
    templates: Collection<Document>,
    outbounds: Collection<Document>,
    customers: Collection<Document>,
    campaigns: Collection<Document>,
    audiences: Collection<Document>,
    events: Collection<Document>,
    executions: Collection<Document>,
}

impl ShopifyUserRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            users: database.collection("shopifyusers"),
            stores: database.collection("shopifystores"),
            flows: database.collection("shopifyflows"),
            templates: database.collection("whatsapptemplates"),
            outbounds: database.collection("whatsappoutbounds"),
            customers: database.collection("shopifycustomers"),
            campaigns: database.collection("shopifycampaigns"),
            audiences: database.collection("shopifyaudiences"),
            events: database.collection("shopifyevents"),
            executions: database.collection("shopifyflowexecutions"),
        }
    }

    pub async fn find_by_login(
        &self,
        login_id_normalized: &str,
    ) -> Result<Option<ShopifyUserRecord>, AppError> {
        self.users
            .find_one(doc! { "loginIdNormalized": login_id_normalized }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_by_refresh_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<ShopifyUserRecord>, AppError> {
        self.users
            .find_one(doc! { "refreshTokens.tokenHash": token_hash }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn append_refresh_token(
        &self,
        user_id: ObjectId,
        token: RefreshTokenRecord,
    ) -> Result<(), AppError> {
        let token_bson = mongodb::bson::to_bson(&token).map_err(|_| AppError::Database)?;
        self.users
            .update_one(
                doc! { "_id": user_id },
                doc! { "$push": { "refreshTokens": token_bson }, "$set": { "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn revoke_refresh_token(
        &self,
        token_hash: &str,
        replaced_by_hash: Option<&str>,
    ) -> Result<(), AppError> {
        self.users
            .update_one(
                doc! { "refreshTokens.tokenHash": token_hash },
                doc! { "$set": { "refreshTokens.$.revokedAt": DateTime::now(), "refreshTokens.$.replacedByHash": replaced_by_hash.unwrap_or("") } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn latest_store(&self, salon_id: &str) -> Result<Option<Document>, AppError> {
        self.stores
            .find_one(
                doc! { "salonId": salon_id },
                mongodb::options::FindOneOptions::builder()
                    .sort(doc! { "connectedAt": -1 })
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn documents(
        &self,
        collection: &str,
        salon_id: &str,
        limit: i64,
    ) -> Result<Vec<Document>, AppError> {
        let source = match collection {
            "flows" => &self.flows,
            "templates" => &self.templates,
            "logs" => &self.outbounds,
            "customers" => &self.customers,
            "campaigns" => &self.campaigns,
            "audiences" => &self.audiences,
            _ => {
                return Err(AppError::Validation(
                    "Unknown Shopify collection.".to_string(),
                ))
            }
        };
        let sort = match collection {
            "templates" => doc! { "name": 1 },
            "customers" | "flows" => doc! { "updatedAt": -1 },
            _ => doc! { "createdAt": -1 },
        };
        let mut cursor = source
            .find(
                doc! { "salonId": salon_id },
                mongodb::options::FindOptions::builder()
                    .sort(sort)
                    .limit(limit.clamp(1, 500))
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn count_outbounds(&self, salon_id: &str, filter: Document) -> Result<u64, AppError> {
        let mut merged = doc! { "salonId": salon_id };
        merged.extend(filter);
        self.outbounds
            .count_documents(merged, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn upsert_customer(
        &self,
        salon_id: &str,
        normalized_phone: &str,
        update: Document,
    ) -> Result<(), AppError> {
        self.customers
            .update_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                doc! { "$set": update },
                mongodb::options::UpdateOptions::builder()
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn mark_customer_opt_out(
        &self,
        salon_id: &str,
        normalized_phone: &str,
    ) -> Result<(), AppError> {
        self.customers
            .update_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                doc! { "$set": { "marketingOptOut": true, "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn create_campaign(&self, campaign: Document) -> Result<Document, AppError> {
        let result = self
            .campaigns
            .insert_one(campaign.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut doc = campaign;
        doc.insert("_id", result.inserted_id);
        Ok(doc)
    }

    pub async fn create_audience(&self, audience: Document) -> Result<Document, AppError> {
        let result = self
            .audiences
            .insert_one(audience.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut doc = audience;
        doc.insert("_id", result.inserted_id);
        Ok(doc)
    }

    pub async fn count_customers(&self, salon_id: &str, filter: Document) -> Result<u64, AppError> {
        let mut merged = doc! { "salonId": salon_id };
        merged.extend(filter);
        self.customers
            .count_documents(merged, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn campaign_by_id(
        &self,
        salon_id: &str,
        campaign_id: ObjectId,
    ) -> Result<Option<Document>, AppError> {
        self.campaigns
            .find_one(doc! { "_id": campaign_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_campaign_fields(
        &self,
        salon_id: &str,
        campaign_id: ObjectId,
        update: Document,
    ) -> Result<Option<Document>, AppError> {
        self.campaigns
            .find_one_and_update(
                doc! { "_id": campaign_id, "salonId": salon_id },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn eligible_campaign_customers(
        &self,
        salon_id: &str,
        limit: i64,
    ) -> Result<Vec<Document>, AppError> {
        let mut cursor = self
            .customers
            .find(
                doc! { "salonId": salon_id, "marketingConsent": true, "marketingOptOut": false, "normalizedPhone": { "$ne": "" } },
                mongodb::options::FindOptions::builder()
                    .limit(limit.clamp(1, 500))
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn disconnect_stores(&self, salon_id: &str) -> Result<u64, AppError> {
        let result = self
            .stores
            .update_many(
                doc! { "salonId": salon_id },
                doc! { "$set": { "status": "disconnected", "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(result.modified_count)
    }

    pub async fn connected_store_by_shop(&self, shop: &str) -> Result<Option<Document>, AppError> {
        self.stores
            .find_one(doc! { "shop": shop, "status": "connected" }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn connected_store_for_salon(
        &self,
        salon_id: &str,
    ) -> Result<Option<Document>, AppError> {
        self.stores
            .find_one(
                doc! { "salonId": salon_id, "status": "connected" },
                mongodb::options::FindOneOptions::builder()
                    .sort(doc! { "connectedAt": -1 })
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn upsert_connected_store(
        &self,
        salon_id: &str,
        shop: &str,
        update: Document,
    ) -> Result<Document, AppError> {
        self.stores
            .find_one_and_update(
                doc! { "salonId": salon_id, "shop": shop },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn insert_event_once(&self, event: Document) -> Result<Option<Document>, AppError> {
        let shop = event.get_str("shop").unwrap_or_default().to_string();
        let topic = event.get_str("topic").unwrap_or_default().to_string();
        let external_event_id = event
            .get_str("externalEventId")
            .unwrap_or_default()
            .to_string();
        let result = self
            .events
            .update_one(
                doc! { "shop": &shop, "topic": &topic, "externalEventId": &external_event_id },
                doc! { "$setOnInsert": event },
                mongodb::options::UpdateOptions::builder()
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        if result.matched_count > 0 {
            return Ok(None);
        }
        self.events
            .find_one(
                doc! { "shop": shop, "topic": topic, "externalEventId": external_event_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn active_flows_for_trigger(
        &self,
        salon_id: &str,
        trigger: &str,
    ) -> Result<Vec<Document>, AppError> {
        let mut cursor = self
            .flows
            .find(
                doc! { "salonId": salon_id, "trigger": trigger, "status": "active" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn queue_flow_execution_once(&self, execution: Document) -> Result<(), AppError> {
        let salon_id = execution.get_str("salonId").unwrap_or_default().to_string();
        let flow_id = execution.get_str("flowId").unwrap_or_default().to_string();
        let external_event_id = execution
            .get_str("externalEventId")
            .unwrap_or_default()
            .to_string();
        self.executions
            .update_one(
                doc! { "salonId": salon_id, "flowId": flow_id, "externalEventId": external_event_id },
                doc! { "$setOnInsert": execution },
                mongodb::options::UpdateOptions::builder().upsert(true).build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn increment_flow_triggered(&self, flow_id: ObjectId) -> Result<(), AppError> {
        self.flows
            .update_one(
                doc! { "_id": flow_id },
                doc! { "$inc": { "metrics.triggered": 1 }, "$set": { "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn create_flow(&self, flow: Document) -> Result<Document, AppError> {
        let result = self
            .flows
            .insert_one(flow.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut doc = flow;
        doc.insert("_id", result.inserted_id);
        Ok(doc)
    }

    pub async fn flow_by_id(
        &self,
        salon_id: &str,
        flow_id: ObjectId,
    ) -> Result<Option<Document>, AppError> {
        self.flows
            .find_one(doc! { "_id": flow_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_flow(
        &self,
        salon_id: &str,
        flow_id: ObjectId,
        update: Document,
    ) -> Result<Option<Document>, AppError> {
        self.flows
            .find_one_and_update(
                doc! { "_id": flow_id, "salonId": salon_id },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn delete_flow_node(
        &self,
        salon_id: &str,
        flow_id: ObjectId,
        node_id: &str,
    ) -> Result<Option<Document>, AppError> {
        self.flows
            .find_one_and_update(
                doc! { "_id": flow_id, "salonId": salon_id },
                doc! { "$pull": { "nodes": { "id": node_id } }, "$set": { "updatedAt": DateTime::now() } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }
}

#[derive(Clone)]
pub struct AppointmentRepository {
    appointments: Collection<AppointmentRecord>,
    appointments_raw: Collection<mongodb::bson::Document>,
    slot_locks: Collection<mongodb::bson::Document>,
    customers: Collection<CustomerRecord>,
    owner_settings: Collection<mongodb::bson::Document>,
    waitlists: Collection<mongodb::bson::Document>,
}

pub struct WaitlistOfferResult {
    pub waitlist_id: String,
    pub appointment_id: String,
    pub customer_phone: String,
}

impl AppointmentRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            appointments: database.collection("appointments"),
            appointments_raw: database.collection("appointments"),
            slot_locks: database.collection("appointmentslotlocks"),
            customers: database.collection("customers"),
            owner_settings: database.collection("ownersettings"),
            waitlists: database.collection("waitlists"),
        }
    }

    pub async fn list_for_staff(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        staff_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<AppointmentRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        if let Some(staff_id) = staff_id {
            filter.insert("staffId", staff_id);
        }
        let mut cursor = self
            .appointments
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|item| item.start_at.timestamp_millis());
        Ok(items)
    }

    pub async fn list_for_owner(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        from: Option<DateTime>,
        to: Option<DateTime>,
        limit: i64,
    ) -> Result<Vec<AppointmentRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        if from.is_some() || to.is_some() {
            let mut range = doc! {};
            if let Some(from) = from {
                range.insert("$gte", from);
            }
            if let Some(to) = to {
                range.insert("$lte", to);
            }
            filter.insert("startAt", range);
        }
        let mut cursor = self
            .appointments
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 500)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|item| item.start_at.timestamp_millis());
        Ok(items)
    }

    pub async fn transition_status(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
        status: &str,
        version: i64,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        self.appointments
            .find_one_and_update(
                doc! { "_id": appointment_id, "salonId": salon_id, "version": version },
                doc! { "$set": { "status": status }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn offer_cancelled_slot_to_waitlist(
        &self,
        input: &AppointmentRecord,
    ) -> Result<Option<WaitlistOfferResult>, AppError> {
        let ist_start = chrono::DateTime::from_timestamp_millis(input.start_at.timestamp_millis())
            .map(|dt| dt + chrono::Duration::minutes(330));
        let date = ist_start
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        let opened_time = ist_start
            .map(|dt| dt.format("%H:%M").to_string())
            .unwrap_or_default();
        let candidates_options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": 1 })
            .limit(20)
            .build();
        let mut cursor = self
            .waitlists
            .find(
                doc! {
                    "salonId": &input.salon_id,
                    "branchId": &input.branch_id,
                    "status": "waiting",
                    "notified": false,
                    "$or": [{ "date": "" }, { "date": &date }],
                    "serviceIds": { "$all": &input.service_ids },
                },
                candidates_options,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut selected = None;
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let doc: Document = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            let staff_id = doc.get_str("staffId").unwrap_or_default();
            let preferred = doc.get_str("preferredTime").unwrap_or_default();
            if (staff_id.is_empty() || staff_id == input.staff_id)
                && within_waitlist_preference(&opened_time, preferred)
            {
                selected = Some(doc);
                break;
            }
        }
        let Some(entry) = selected else {
            return Ok(None);
        };
        let waitlist_oid = entry.get_object_id("_id").map_err(|_| AppError::Database)?;
        let appointment_id = ObjectId::new();
        let locks: Vec<Document> = slot_instants(input.start_at, input.end_at)
            .into_iter()
            .map(|slot_at| {
                doc! {
                    "salonId": &input.salon_id,
                    "branchId": &input.branch_id,
                    "staffId": &input.staff_id,
                    "appointmentId": appointment_id.to_hex(),
                    "slotAt": slot_at,
                }
            })
            .collect();
        if !locks.is_empty() {
            self.slot_locks
                .insert_many(locks, None)
                .await
                .map_err(|_| AppError::Database)?;
        }
        let customer_id = entry.get_str("customerId").unwrap_or_default().to_string();
        let customer_name = if let Ok(oid) = ObjectId::parse_str(&customer_id) {
            self.customer_by_id(&input.salon_id, oid)
                .await?
                .map(|customer| customer.name)
                .unwrap_or_else(|| {
                    entry
                        .get_str("customerPhone")
                        .unwrap_or_default()
                        .to_string()
                })
        } else {
            entry
                .get_str("customerPhone")
                .unwrap_or_default()
                .to_string()
        };
        self.appointments_raw
            .insert_one(
                doc! {
                    "_id": appointment_id,
                    "salonId": &input.salon_id,
                    "branchId": &input.branch_id,
                    "staffId": &input.staff_id,
                    "customerId": &customer_id,
                    "customerName": customer_name,
                    "serviceIds": &input.service_ids,
                    "serviceNames": &input.service_names,
                    "durationMinutes": input.duration_minutes,
                    "value": input.value,
                    "startAt": input.start_at,
                    "endAt": input.end_at,
                    "status": "pending",
                    "source": "whatsapp_waitlist",
                    "paymentStatus": "not_required",
                    "holdExpiresAt": DateTime::from_millis(DateTime::now().timestamp_millis() + 15 * 60_000),
                    "version": 1,
                    "createdAt": DateTime::now(),
                    "updatedAt": DateTime::now(),
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        self.waitlists
            .update_one(
                doc! { "_id": waitlist_oid },
                doc! { "$set": {
                    "status": "offered",
                    "notified": true,
                    "offeredAppointmentId": appointment_id.to_hex(),
                    "opportunityExpiresAt": DateTime::from_millis(DateTime::now().timestamp_millis() + 15 * 60_000),
                    "updatedAt": DateTime::now(),
                } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(Some(WaitlistOfferResult {
            waitlist_id: waitlist_oid.to_hex(),
            appointment_id: appointment_id.to_hex(),
            customer_phone: entry
                .get_str("customerPhone")
                .unwrap_or_default()
                .to_string(),
        }))
    }

    pub async fn claim_waitlist_offer(
        &self,
        salon_id: &str,
        customer_phone: &str,
    ) -> Result<Option<Document>, AppError> {
        let entry = self
            .waitlists
            .find_one(
                doc! {
                    "salonId": salon_id,
                    "customerPhone": customer_phone,
                    "status": "offered",
                    "opportunityExpiresAt": { "$gte": DateTime::now() },
                },
                mongodb::options::FindOneOptions::builder()
                    .sort(doc! { "opportunityExpiresAt": 1 })
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let Some(entry) = entry else {
            return Ok(None);
        };
        let appointment_id = entry.get_str("offeredAppointmentId").unwrap_or_default();
        let appointment_oid =
            ObjectId::parse_str(appointment_id).map_err(|_| AppError::Database)?;
        let appointment = self
            .appointments_raw
            .find_one_and_update(
                doc! {
                    "_id": appointment_oid,
                    "salonId": salon_id,
                    "status": "pending",
                    "source": "whatsapp_waitlist",
                    "holdExpiresAt": { "$gte": DateTime::now() },
                },
                doc! {
                    "$set": { "status": "confirmed", "paymentStatus": "not_required", "updatedAt": DateTime::now() },
                    "$unset": { "holdExpiresAt": "" },
                    "$inc": { "version": 1 },
                },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let Some(appointment) = appointment else {
            return Ok(None);
        };
        if let Ok(waitlist_id) = entry.get_object_id("_id") {
            let _ = self
                .waitlists
                .update_one(
                    doc! { "_id": waitlist_id },
                    doc! { "$set": { "status": "booked", "updatedAt": DateTime::now() } },
                    None,
                )
                .await;
        }
        Ok(Some(appointment))
    }

    pub async fn find_by_id(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        self.appointments
            .find_one(doc! { "_id": appointment_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_by_id(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
        version: i64,
        update: mongodb::bson::Document,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        self.appointments
            .find_one_and_update(
                doc! { "_id": appointment_id, "salonId": salon_id, "version": version },
                doc! { "$set": update, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn customer_by_id(
        &self,
        salon_id: &str,
        customer_id: ObjectId,
    ) -> Result<Option<CustomerRecord>, AppError> {
        self.customers
            .find_one(doc! { "_id": customer_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn customer_phone(&self, customer_id: &str) -> Result<Option<String>, AppError> {
        let id = ObjectId::parse_str(customer_id).map_err(|_| AppError::Authentication)?;
        Ok(self
            .customers
            .find_one(doc! { "_id": id }, None)
            .await
            .map_err(|_| AppError::Database)?
            .map(|customer| customer.normalized_phone))
    }

    pub async fn cancel_public(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        let updated = self.appointments
            .find_one_and_update(
                doc! { "_id": appointment_id, "salonId": salon_id, "status": { "$in": booking_blocking_statuses() } },
                doc! { "$set": { "status": "cancelled" }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        if updated.is_some() {
            self.slot_locks
                .delete_many(
                    doc! { "salonId": salon_id, "appointmentId": appointment_id.to_hex() },
                    None,
                )
                .await
                .map_err(|_| AppError::Database)?;
        }
        Ok(updated)
    }

    pub async fn reschedule_public(
        &self,
        mut appointment: AppointmentRecord,
        start_at: DateTime,
        end_at: DateTime,
    ) -> Result<AppointmentRecord, AppError> {
        self.slot_locks
            .delete_many(
                doc! { "salonId": &appointment.salon_id, "appointmentId": appointment.id.to_hex() },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let lock_docs: Vec<_> = slot_instants(start_at, end_at).into_iter().map(|slot_at| doc! { "salonId": &appointment.salon_id, "branchId": &appointment.branch_id, "staffId": &appointment.staff_id, "appointmentId": appointment.id.to_hex(), "slotAt": slot_at }).collect();
        if !lock_docs.is_empty() {
            self.slot_locks
                .insert_many(lock_docs, None)
                .await
                .map_err(|_| AppError::Conflict("Requested time is not available.".to_string()))?;
        }
        appointment.start_at = start_at;
        appointment.end_at = end_at;
        appointment.status = "confirmed".to_string();
        appointment.version += 1;
        self.appointments
            .find_one_and_update(
                doc! { "_id": appointment.id, "salonId": &appointment.salon_id },
                doc! { "$set": { "startAt": start_at, "endAt": end_at, "status": "confirmed" }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or_else(|| AppError::NotFound("Appointment was not found.".to_string()))
    }

    pub async fn find_overlap(
        &self,
        salon_id: &str,
        staff_id: &str,
        start_at: DateTime,
        end_at: DateTime,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        self.appointments.find_one(doc! { "salonId": salon_id, "staffId": staff_id, "status": { "$in": booking_blocking_statuses() }, "startAt": { "$lt": end_at }, "endAt": { "$gt": start_at } }, None).await.map_err(|_| AppError::Database)
    }

    pub async fn count_day_load(
        &self,
        salon_id: &str,
        staff_id: &str,
        start_at: DateTime,
    ) -> Result<u64, AppError> {
        let center = start_at.timestamp_millis();
        self.appointments.count_documents(doc! { "salonId": salon_id, "staffId": staff_id, "startAt": { "$gte": DateTime::from_millis(center - 12 * 60 * 60_000), "$lte": DateTime::from_millis(center + 12 * 60 * 60_000) } }, None).await.map_err(|_| AppError::Database)
    }

    pub async fn has_lock_overlap(
        &self,
        salon_id: &str,
        staff_id: &str,
        start_at: DateTime,
        end_at: DateTime,
    ) -> Result<bool, AppError> {
        let found = self.slot_locks.find_one(doc! { "salonId": salon_id, "staffId": staff_id, "slotAt": { "$gte": start_at, "$lt": end_at } }, None).await.map_err(|_| AppError::Database)?;
        Ok(found.is_some())
    }

    pub async fn create_with_customer_and_locks(
        &self,
        appointment: AppointmentRecord,
        normalized_phone: Option<&str>,
    ) -> Result<AppointmentRecord, AppError> {
        let mut appointment = appointment;
        if let Some(phone) = normalized_phone.filter(|phone| !phone.is_empty()) {
            let updated = self.customers.find_one_and_update(
                doc! { "salonId": &appointment.salon_id, "normalizedPhone": phone },
                doc! { "$setOnInsert": { "branchId": &appointment.branch_id, "source": appointment.source.clone().unwrap_or_else(|| "crm".to_string()) }, "$set": { "name": appointment.customer_name.clone().unwrap_or_default(), "interactionStatus": if appointment.source.as_deref() == Some("whatsapp") { "booked" } else { "active" } } },
                FindOneAndUpdateOptions::builder().upsert(true).return_document(ReturnDocument::After).build(),
            ).await.map_err(|_| AppError::Database)?;
            appointment.customer_id = updated.map(|customer| customer.id.to_hex());
        }
        let lock_docs: Vec<_> = slot_instants(appointment.start_at, appointment.end_at).into_iter().map(|slot_at| doc! { "salonId": &appointment.salon_id, "branchId": &appointment.branch_id, "staffId": &appointment.staff_id, "appointmentId": appointment.id.to_hex(), "slotAt": slot_at }).collect();
        if !lock_docs.is_empty() {
            self.slot_locks
                .insert_many(lock_docs, None)
                .await
                .map_err(|_| AppError::Conflict("Requested time is not available.".to_string()))?;
        }
        self.appointments
            .insert_one(&appointment, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(appointment)
    }

    /// Confirms a Razorpay deposit payment for a held appointment.
    /// Returns "confirmed", "expired", or "not_found".
    pub async fn confirm_deposit_payment(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
        link_id: &str,
        payment_reference: &str,
    ) -> Result<String, AppError> {
        let Some(appointment) = self.appointments_raw.find_one(
            doc! { "_id": appointment_id, "salonId": salon_id, "paymentProvider": "razorpay", "paymentProviderId": link_id, "status": "pending" },
            None,
        ).await.map_err(|_| AppError::Database)?
        else {
            return Ok("not_found".to_string());
        };
        let expired = appointment
            .get("holdExpiresAt")
            .and_then(|value| value.as_datetime())
            .cloned()
            .is_some_and(|at| at.lt(&DateTime::now()));
        if expired {
            self.appointments.update_one(
                doc! { "_id": appointment_id },
                doc! { "$set": { "status": "expired", "paymentStatus": "failed" }, "$inc": { "version": 1 } },
                None,
            ).await.map_err(|_| AppError::Database)?;
            self.slot_locks
                .delete_many(
                    doc! { "salonId": salon_id, "appointmentId": appointment_id.to_hex() },
                    None,
                )
                .await
                .map_err(|_| AppError::Database)?;
            return Ok("expired".to_string());
        }
        self.appointments.update_one(
            doc! { "_id": appointment_id },
            doc! { "$set": { "status": "confirmed", "paymentStatus": "paid", "paymentReference": payment_reference }, "$inc": { "version": 1 } },
            None,
        ).await.map_err(|_| AppError::Database)?;
        Ok("confirmed".to_string())
    }

    /// Finds the deposit metadata (provider link id, deposit amount, value, services,
    /// start time, customer contact, branch) for an appointment as a raw document.
    pub async fn deposit_appointment(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
    ) -> Result<Option<Document>, AppError> {
        self.appointments_raw
            .find_one(doc! { "_id": appointment_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    /// Reads the deposit configuration for a branch from owner settings.
    /// Returns (enabled, mode, fixed_paise, percent, minimum_paise).
    #[allow(clippy::too_many_arguments)]
    pub async fn booking_deposit_config(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<(bool, String, i64, i64, i64), AppError> {
        let settings = self
            .owner_settings
            .find_one(doc! { "salonId": salon_id, "branchId": branch_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let settings = match settings {
            Some(doc) => Some(doc),
            None => self
                .owner_settings
                .find_one(doc! { "salonId": salon_id, "branchId": "" }, None)
                .await
                .map_err(|_| AppError::Database)?,
        };
        let booking = settings
            .and_then(|doc| doc.get_document("settings").ok().cloned())
            .and_then(|settings| settings.get_document("booking").ok().cloned());
        let enabled = booking
            .as_ref()
            .and_then(|booking| booking.get_bool("depositsEnabled").ok())
            .unwrap_or(false);
        if !enabled {
            return Ok((false, "percent".to_string(), 0, 0, 0));
        }
        let mode = booking
            .as_ref()
            .and_then(|booking| booking.get_str("depositMode").ok())
            .unwrap_or("percent")
            .to_string();
        let fixed = booking
            .as_ref()
            .and_then(|booking| booking.get_i64("depositFixedPaise").ok())
            .unwrap_or(0);
        let percent = booking
            .as_ref()
            .and_then(|booking| booking.get_i64("depositPercent").ok())
            .unwrap_or(10);
        let minimum = booking
            .as_ref()
            .and_then(|booking| booking.get_i64("depositMinimumPaise").ok())
            .unwrap_or(0);
        Ok((enabled, mode, fixed, percent, minimum))
    }

    /// Applies a deposit hold to a booked appointment (creates an awaiting_payment
    /// state so the Razorpay webhook can later confirm it).
    pub async fn apply_deposit_hold(
        &self,
        salon_id: &str,
        appointment_id: ObjectId,
        link_id: &str,
        link_url: &str,
        deposit_paise: i64,
    ) -> Result<(), AppError> {
        let hold_expires_at =
            DateTime::from_millis(DateTime::now().timestamp_millis() + 30 * 60_000);
        self.appointments
            .update_one(
                doc! { "_id": appointment_id, "salonId": salon_id },
                doc! {
                    "$set": {
                        "status": "pending",
                        "paymentStatus": "pending",
                        "paymentProvider": "razorpay",
                        "paymentProviderId": link_id,
                        "paymentLink": link_url,
                        "depositAmountPaise": deposit_paise,
                        "holdExpiresAt": hold_expires_at,
                    },
                    "$inc": { "version": 1 },
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct CatalogRepository {
    services: Collection<ServiceRecord>,
    branches: Collection<BranchRecord>,
    schedules: Collection<ScheduleRecord>,
    leaves: Collection<LeaveRecord>,
    users: Collection<UserRecord>,
    customers: Collection<CustomerRecord>,
}

impl CatalogRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            services: database.collection("services"),
            branches: database.collection("branches"),
            schedules: database.collection("schedules"),
            leaves: database.collection("leaves"),
            users: database.collection("users"),
            customers: database.collection("customers"),
        }
    }

    pub async fn active_service(
        &self,
        salon_id: &str,
        service_id: ObjectId,
    ) -> Result<Option<ServiceRecord>, AppError> {
        self.services
            .find_one(
                doc! { "_id": service_id, "salonId": salon_id, "status": "active" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn active_branch(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Option<BranchRecord>, AppError> {
        self.branches
            .find_one(
                doc! { "_id": branch_id, "salonId": salon_id, "status": "active" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn public_branches(&self, salon_id: &str) -> Result<Vec<BranchRecord>, AppError> {
        let mut cursor = self
            .branches
            .find(doc! { "salonId": salon_id, "status": "active" }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn public_services(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Vec<ServiceRecord>, AppError> {
        let mut cursor = self
            .services
            .find(doc! { "salonId": salon_id, "status": "active", "$or": [ { "branchIds": branch_id }, { "branchIds": { "$size": 0 } } ] }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn active_staff(
        &self,
        salon_id: &str,
        branch_id: &str,
        eligible: &[String],
    ) -> Result<Vec<UserRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "branchIds": branch_id, "status": "active" };
        if !eligible.is_empty() {
            filter.insert("staffId", doc! { "$in": eligible });
        }
        let mut cursor = self
            .users
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|user| user.staff_id.clone().unwrap_or_else(|| user.id.to_hex()));
        Ok(items)
    }

    pub async fn schedule(
        &self,
        salon_id: &str,
        branch_id: &str,
        staff_id: &str,
        schedule_date: &str,
    ) -> Result<Option<ScheduleRecord>, AppError> {
        self.schedules.find_one(doc! { "salonId": salon_id, "branchId": branch_id, "staffId": staff_id, "scheduleDate": schedule_date, "status": { "$ne": "cancelled" } }, None).await.map_err(|_| AppError::Database)
    }

    pub async fn leave(
        &self,
        salon_id: &str,
        staff_id: &str,
        date: &str,
    ) -> Result<Option<LeaveRecord>, AppError> {
        self.leaves.find_one(doc! { "salonId": salon_id, "staffId": staff_id, "status": { "$in": ["pending", "approved"] }, "startDate": { "$lte": date }, "endDate": { "$gte": date } }, None).await.map_err(|_| AppError::Database)
    }

    pub async fn list_branches(&self, salon_id: &str) -> Result<Vec<BranchRecord>, AppError> {
        let mut cursor = self
            .branches
            .find(doc! { "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn upsert_branch(&self, branch: &BranchRecord) -> Result<BranchRecord, AppError> {
        let hours = mongodb::bson::to_bson(&branch.hours).map_err(|_| AppError::Database)?;
        self.branches
            .find_one_and_update(
                doc! { "_id": &branch.id, "salonId": &branch.salon_id },
                doc! {
                    "$set": { "name": &branch.name, "timezone": &branch.timezone, "status": &branch.status, "slotIntervalMinutes": branch.slot_interval_minutes, "hours": hours }
                },
                FindOneAndUpdateOptions::builder().upsert(true).return_document(ReturnDocument::After).build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn update_branch(
        &self,
        salon_id: &str,
        branch_id: &str,
        update: mongodb::bson::Document,
    ) -> Result<Option<BranchRecord>, AppError> {
        self.branches
            .find_one_and_update(
                doc! { "_id": branch_id, "salonId": salon_id },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_branch_status(
        &self,
        salon_id: &str,
        branch_id: &str,
        status: &str,
    ) -> Result<Option<BranchRecord>, AppError> {
        self.update_branch(salon_id, branch_id, doc! { "status": status })
            .await
    }

    pub async fn list_admin_services(
        &self,
        salon_id: &str,
        branch_id: Option<&str>,
    ) -> Result<Vec<ServiceRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            filter.insert(
                "$or",
                vec![
                    doc! { "branchIds": branch_id },
                    doc! { "branchIds": { "$size": 0 } },
                ],
            );
        }
        let mut cursor = self
            .services
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 500 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn list_services(
        &self,
        salon_id: &str,
        branch_id: Option<&str>,
    ) -> Result<Vec<ServiceRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "status": "active" };
        if let Some(branch_id) = branch_id {
            filter.insert(
                "$or",
                vec![
                    doc! { "branchIds": branch_id },
                    doc! { "branchIds": { "$size": 0 } },
                ],
            );
        }
        let mut cursor = self
            .services
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn upsert_service(&self, service: &ServiceRecord) -> Result<ServiceRecord, AppError> {
        let update = doc! {
            "branchIds": &service.branch_ids,
            "category": &service.category,
            "name": &service.name,
            "description": &service.description,
            "pricePaise": service.price_paise,
            "durationMinutes": service.duration_minutes,
            "eligibleStaffIds": &service.eligible_staff_ids,
            "status": &service.status
        };
        self.services.find_one_and_update(
            doc! { "$or": [ { "_id": service.id, "salonId": &service.salon_id }, { "salonId": &service.salon_id, "name": &service.name } ] },
            doc! { "$set": update },
            FindOneAndUpdateOptions::builder().upsert(true).return_document(ReturnDocument::After).build(),
        ).await.map_err(|_| AppError::Database)?.ok_or(AppError::Database)
    }

    pub async fn update_service(
        &self,
        salon_id: &str,
        service_id: ObjectId,
        update: mongodb::bson::Document,
    ) -> Result<Option<ServiceRecord>, AppError> {
        self.services
            .find_one_and_update(
                doc! { "_id": service_id, "salonId": salon_id },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_service_status(
        &self,
        salon_id: &str,
        service_id: ObjectId,
        status: &str,
    ) -> Result<Option<ServiceRecord>, AppError> {
        self.update_service(salon_id, service_id, doc! { "status": status })
            .await
    }

    pub async fn list_customers(
        &self,
        salon_id: &str,
        search: Option<&str>,
    ) -> Result<Vec<CustomerRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if let Some(search) = search.filter(|s| !s.trim().is_empty()) {
            let digits: String = search.chars().filter(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                filter.insert(
                    "normalizedPhone",
                    doc! { "$regex": format!(".*{}.*", digits) },
                );
            } else {
                let escaped = search.replace(
                    [
                        '\\', '.', '+', '*', '?', '^', '$', '(', ')', '[', ']', '{', '}', '|',
                    ],
                    "\\$&",
                );
                filter.insert("name", doc! { "$regex": format!("(?i){}", escaped) });
            }
        }
        let mut cursor = self
            .customers
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 50 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn upsert_customer(
        &self,
        customer: &CustomerRecord,
    ) -> Result<CustomerRecord, AppError> {
        self.customers
            .find_one_and_update(
                doc! { "salonId": &customer.salon_id, "normalizedPhone": &customer.normalized_phone },
                doc! { "$setOnInsert": { "source": "crm" }, "$set": { "branchId": &customer.branch_id, "name": &customer.name, "interactionStatus": "active" } },
                FindOneAndUpdateOptions::builder().upsert(true).return_document(ReturnDocument::After).build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }
}

fn booking_blocking_statuses() -> Vec<&'static str> {
    vec!["pending", "booked", "confirmed", "arrived", "in_service"]
}

fn slot_instants(start_at: DateTime, end_at: DateTime) -> Vec<DateTime> {
    let interval = 5 * 60_000;
    let start = start_at.timestamp_millis();
    let end = end_at.timestamp_millis();
    let mut ts = (start / interval) * interval;
    let mut slots = Vec::new();
    while ts < end {
        if ts >= start {
            slots.push(DateTime::from_millis(ts));
        }
        ts += interval;
    }
    if slots.is_empty() {
        vec![start_at]
    } else {
        slots
    }
}

fn within_waitlist_preference(opened: &str, preferred: &str) -> bool {
    fn minutes(value: &str) -> Option<i64> {
        let (hour, minute) = value.split_once(':')?;
        Some(hour.parse::<i64>().ok()? * 60 + minute.parse::<i64>().ok()?)
    }
    if preferred.trim().is_empty() {
        return true;
    }
    match (minutes(opened), minutes(preferred)) {
        (Some(opened), Some(preferred)) => (opened - preferred).abs() <= 60,
        _ => true,
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

impl UserRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            users: database.collection("users"),
        }
    }

    pub async fn find_for_login(
        &self,
        salon_id: &str,
        login_identifier: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        let trimmed = login_identifier.trim();
        let filter = if trimmed.contains('@') {
            doc! { "salonId": salon_id, "email": trimmed.to_lowercase() }
        } else {
            doc! { "salonId": salon_id, "loginIdNormalized": trimmed.to_lowercase() }
        };
        self.users
            .find_one(filter, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_active_context(
        &self,
        id: &str,
        salon_id: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        let object_id = ObjectId::parse_str(id).map_err(|_| AppError::Authentication)?;
        self.users
            .find_one(doc! { "_id": object_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_user_id_by_staff(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Option<String>, AppError> {
        let found = self
            .users
            .find_one(doc! { "salonId": salon_id, "staffId": staff_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(found.map(|u| u.id.to_hex()))
    }

    pub async fn find_by_refresh_hash(
        &self,
        token_hash: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        self.users
            .find_one(doc! { "refreshTokens.tokenHash": token_hash }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn append_refresh_token(
        &self,
        user_id: ObjectId,
        record: RefreshTokenRecord,
    ) -> Result<(), AppError> {
        let record_doc = mongodb::bson::to_document(&record).map_err(|_| AppError::Database)?;
        self.users
            .update_one(
                doc! { "_id": user_id },
                doc! { "$pull": { "refreshTokens": { "$or": [ { "revokedAt": { "$ne": null } }, { "expiresAt": { "$lte": DateTime::now() } } ] } } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        self.users
            .update_one(
                doc! { "_id": user_id },
                doc! {
                    "$push": { "refreshTokens": { "$each": [record_doc], "$slice": -10 } }
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn revoke_refresh(
        &self,
        token_hash: &str,
        replaced_by_hash: Option<&str>,
    ) -> Result<(), AppError> {
        self.users
            .update_one(
                doc! { "refreshTokens.tokenHash": token_hash },
                doc! { "$set": { "refreshTokens.$.revokedAt": DateTime::now(), "refreshTokens.$.replacedByHash": replaced_by_hash.unwrap_or("") } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn find_first_staff(&self, salon_id: &str) -> Result<Option<UserRecord>, AppError> {
        self.users
            .find_one(
                doc! {
                    "salonId": salon_id,
                    "status": "active",
                    "staffId": { "$ne": null }
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_by_staff_id(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        self.users
            .find_one(doc! { "salonId": salon_id, "staffId": staff_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }
}

#[derive(Clone)]
pub struct SalonRepository {
    salons: Collection<SalonRecord>,
}

#[derive(Clone)]
pub struct WhatsAppRepository {
    webhook_events: Collection<Document>,
    inbounds: Collection<Document>,
    outbounds: Collection<Document>,
    connections: Collection<Document>,
    oauth_states: Collection<Document>,
    customers: Collection<Document>,
    templates: Collection<Document>,
    whatsapp_sessions: Collection<Document>,
    waitlists: Collection<Document>,
}

impl WhatsAppRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            webhook_events: database.collection("whatsappwebhookevents"),
            inbounds: database.collection("whatsappinbounds"),
            outbounds: database.collection("whatsappoutbounds"),
            connections: database.collection("whatsappconnections"),
            oauth_states: database.collection("whatsappoauthstates"),
            customers: database.collection("customers"),
            templates: database.collection("whatsapptemplates"),
            whatsapp_sessions: database.collection("whatsappbookingsessions"),
            waitlists: database.collection("waitlists"),
        }
    }

    pub async fn insert_webhook_event(&self, event: Document) -> Result<(), AppError> {
        self.webhook_events
            .insert_one(event, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn insert_inbound(&self, inbound: Document) -> Result<(), AppError> {
        self.inbounds
            .insert_one(inbound, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn apply_delivery_status(
        &self,
        provider_message_id: &str,
        status: &str,
        timestamp: DateTime,
    ) -> Result<(), AppError> {
        self.outbounds
            .update_one(
                doc! { "providerMessageId": provider_message_id },
                doc! { "$set": { "status": status, "deliveredStatusAt": timestamp, "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn insert_outbound(&self, outbound: Document) -> Result<Document, AppError> {
        let result = self
            .outbounds
            .insert_one(outbound.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut doc = outbound;
        doc.insert("_id", result.inserted_id);
        Ok(doc)
    }

    pub async fn update_outbound_send_result(
        &self,
        outbound_id: ObjectId,
        status: &str,
        provider_message_id: &str,
        error: &str,
        retry_increment: bool,
    ) -> Result<Document, AppError> {
        let mut update = doc! {
            "status": status,
            "providerMessageId": provider_message_id,
            "error": error,
            "updatedAt": DateTime::now(),
        };
        if status == "sent" {
            update.insert("sentAt", DateTime::now());
        }
        let mut mutation = doc! { "$set": update };
        if retry_increment {
            mutation.insert("$inc", doc! { "retryCount": 1 });
        }
        self.outbounds
            .find_one_and_update(
                doc! { "_id": outbound_id },
                mutation,
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn customer_marketing_opt_out(
        &self,
        salon_id: &str,
        normalized_phone: &str,
    ) -> Result<bool, AppError> {
        let customer = self
            .customers
            .find_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(customer
            .as_ref()
            .and_then(|doc| doc.get_bool("marketingOptOut").ok())
            .unwrap_or(false))
    }

    pub async fn set_customer_opt_out(
        &self,
        salon_id: &str,
        normalized_phone: &str,
        opt_out: bool,
    ) -> Result<(), AppError> {
        self.customers
            .update_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                doc! { "$set": { "marketingOptOut": opt_out } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn record_customer_booking(
        &self,
        salon_id: &str,
        normalized_phone: &str,
        staff_id: &str,
        service_ids: Vec<String>,
        start_at: DateTime,
    ) -> Result<(), AppError> {
        if normalized_phone.trim().is_empty() {
            return Ok(());
        }
        let hour = chrono::DateTime::from_timestamp_millis(start_at.timestamp_millis())
            .map(|dt| {
                use chrono::Timelike;
                (dt + chrono::Duration::minutes(330)).hour()
            })
            .unwrap_or(12);
        let preferred_time = if hour < 12 {
            "prefers_morning"
        } else if hour < 16 {
            "prefers_afternoon"
        } else if hour < 19 {
            "prefers_evening"
        } else {
            "prefers_late_evening"
        };
        let services: Vec<String> = service_ids.into_iter().take(20).collect();
        self.customers
            .update_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                doc! {
                    "$inc": { "visitCount": 1 },
                    "$set": { "lastBookedAt": start_at, "interactionStatus": "booked" },
                    "$addToSet": { "tags": { "$each": ["whatsapp_booked", preferred_time] } },
                    "$push": {
                        "favoriteServiceIds": { "$each": services, "$slice": -30 },
                        "preferredStaffIds": { "$each": [staff_id], "$slice": -8 }
                    }
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_waitlist_entry(
        &self,
        salon_id: &str,
        branch_id: &str,
        staff_id: &str,
        service_ids: Vec<String>,
        service_names: Vec<String>,
        date: &str,
        preferred_time: &str,
        customer_phone: &str,
    ) -> Result<bool, AppError> {
        let existing = self
            .waitlists
            .find_one(
                doc! {
                    "salonId": salon_id,
                    "branchId": branch_id,
                    "customerPhone": customer_phone,
                    "status": { "$in": ["waiting", "offered"] },
                    "serviceIds": { "$all": &service_ids },
                    "$or": [{ "date": "" }, { "date": date }],
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        if existing.is_some() {
            return Ok(false);
        }
        let customer_id = self
            .customer_by_normalized_phone(salon_id, customer_phone, 1)
            .await?
            .into_iter()
            .next()
            .and_then(|doc| doc.get_object_id("_id").ok())
            .map(|oid| oid.to_hex())
            .unwrap_or_default();
        self.waitlists
            .insert_one(
                doc! {
                    "salonId": salon_id,
                    "branchId": branch_id,
                    "staffId": staff_id,
                    "serviceIds": service_ids,
                    "serviceNames": service_names,
                    "date": date,
                    "preferredTime": preferred_time,
                    "customerId": customer_id,
                    "customerPhone": customer_phone,
                    "status": "waiting",
                    "notified": false,
                    "offeredAppointmentId": "",
                    "opportunityExpiresAt": null,
                    "createdAt": DateTime::now(),
                    "updatedAt": DateTime::now(),
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(true)
    }

    pub async fn add_customer_tags(
        &self,
        salon_id: &str,
        normalized_phone: &str,
        tags: Vec<String>,
    ) -> Result<(), AppError> {
        if tags.is_empty() || normalized_phone.trim().is_empty() {
            return Ok(());
        }
        self.customers
            .update_one(
                doc! { "salonId": salon_id, "normalizedPhone": normalized_phone },
                doc! { "$addToSet": { "tags": { "$each": tags } }, "$set": { "updatedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn connected_connection(&self, salon_id: &str) -> Result<Option<Document>, AppError> {
        self.connections
            .find_one(
                doc! { "salonId": salon_id, "status": "connected" },
                mongodb::options::FindOneOptions::builder()
                    .sort(doc! { "connectedAt": -1 })
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn insert_oauth_state(
        &self,
        state_hash: &str,
        salon_id: &str,
        user_id: &str,
        expires_at: DateTime,
    ) -> Result<(), AppError> {
        self.oauth_states
            .insert_one(
                doc! {
                    "stateHash": state_hash,
                    "salonId": salon_id,
                    "userId": user_id,
                    "expiresAt": expires_at,
                    "consumedAt": null,
                    "createdAt": DateTime::now(),
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn oauth_state(
        &self,
        state_hash: &str,
        salon_id: &str,
        user_id: &str,
    ) -> Result<Option<Document>, AppError> {
        self.oauth_states
            .find_one(
                doc! { "stateHash": state_hash, "salonId": salon_id, "userId": user_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn consume_oauth_state(
        &self,
        state_hash: &str,
        salon_id: &str,
        user_id: &str,
    ) -> Result<bool, AppError> {
        let result = self
            .oauth_states
            .update_one(
                doc! {
                    "stateHash": state_hash,
                    "salonId": salon_id,
                    "userId": user_id,
                    "consumedAt": null,
                    "expiresAt": { "$gt": DateTime::now() },
                },
                doc! { "$set": { "consumedAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(result.modified_count == 1)
    }

    pub async fn connection_by_phone_number(
        &self,
        phone_number_id: &str,
    ) -> Result<Option<Document>, AppError> {
        self.connections
            .find_one(
                doc! { "phoneNumberId": phone_number_id, "status": { "$ne": "disconnected" } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn upsert_connection(
        &self,
        salon_id: &str,
        user_id: &str,
        provider: &str,
        waba_id: &str,
        phone_number_id: &str,
        business_id: &str,
        display_phone_number: &str,
        verified_name: &str,
        encrypted_access_token: &str,
        token_expires_at: Option<DateTime>,
        webhook_subscribed: bool,
    ) -> Result<Document, AppError> {
        self.connections
            .find_one_and_update(
                doc! { "salonId": salon_id, "phoneNumberId": phone_number_id },
                doc! {
                    "$set": {
                        "provider": provider,
                        "wabaId": waba_id,
                        "businessId": business_id,
                        "displayPhoneNumber": display_phone_number,
                        "verifiedName": verified_name,
                        "encryptedAccessToken": encrypted_access_token,
                        "tokenExpiresAt": token_expires_at,
                        "status": "connected",
                        "webhookSubscribed": webhook_subscribed,
                        "connectedAt": DateTime::now(),
                        "disconnectedAt": null,
                        "lastError": "",
                        "updatedAt": DateTime::now(),
                    },
                    "$setOnInsert": {
                        "salonId": salon_id,
                        "phoneNumberId": phone_number_id,
                        "createdBy": user_id,
                        "scopes": [],
                    },
                },
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn disconnect_connection(
        &self,
        salon_id: &str,
        phone_number_id: Option<&str>,
    ) -> Result<Document, AppError> {
        let filter = match phone_number_id {
            Some(phone_number_id) => doc! {
                "salonId": salon_id,
                "phoneNumberId": phone_number_id,
                "status": { "$ne": "disconnected" },
            },
            None => doc! { "salonId": salon_id, "status": { "$ne": "disconnected" } },
        };
        self.connections
            .find_one_and_update(
                filter,
                doc! { "$set": { "status": "disconnected", "disconnectedAt": DateTime::now(), "webhookSubscribed": false, "updatedAt": DateTime::now() } },
                FindOneAndUpdateOptions::builder()
                    .sort(doc! { "connectedAt": -1 })
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or_else(|| AppError::NotFound("WhatsApp connection not found.".to_string()))
    }

    pub async fn salon_for_phone_number_id(
        &self,
        phone_number_id: &str,
    ) -> Result<Option<Document>, AppError> {
        self.connections
            .find_one(
                doc! { "phoneNumberId": phone_number_id, "status": "connected" },
                mongodb::options::FindOneOptions::builder()
                    .sort(doc! { "connectedAt": -1 })
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn template(
        &self,
        salon_id: &str,
        name: &str,
        language: &str,
    ) -> Result<Option<Document>, AppError> {
        self.templates
            .find_one(
                doc! { "salonId": salon_id, "name": name, "language": language },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn conversation_customers(
        &self,
        salon_id: &str,
        search: &str,
        limit: usize,
    ) -> Result<Vec<Document>, AppError> {
        let search = search.trim();
        let filter = if search.is_empty() {
            doc! { "salonId": salon_id }
        } else {
            let digits: String = search.chars().filter(char::is_ascii_digit).collect();
            let mut or = vec![doc! {
                "name": doc! { "$regex": format!("(?i){}", regex_escape(search)) },
            }];
            if !digits.is_empty() {
                or.push(doc! {
                    "normalizedPhone": doc! { "$regex": format!("{}", digits) },
                });
            }
            doc! { "salonId": salon_id, "$or": or }
        };
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "updatedAt": -1 })
            .limit(limit as i64)
            .build();
        let mut cursor = self
            .customers
            .find(filter, Some(options))
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn conversation_inbounds_by_phones(
        &self,
        salon_id: &str,
        phones: &[String],
        limit: usize,
    ) -> Result<Vec<Document>, AppError> {
        if phones.is_empty() {
            return Ok(Vec::new());
        }
        let filter = doc! { "salonId": salon_id, "waPhone": { "$in": phones } };
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit as i64)
            .build();
        let mut cursor = self
            .inbounds
            .find(filter, Some(options))
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn conversation_outbounds_by_phones(
        &self,
        salon_id: &str,
        phones: &[String],
        limit: usize,
    ) -> Result<Vec<Document>, AppError> {
        if phones.is_empty() {
            return Ok(Vec::new());
        }
        let filter = doc! { "salonId": salon_id, "toPhone": { "$in": phones } };
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit as i64)
            .build();
        let mut cursor = self
            .outbounds
            .find(filter, Some(options))
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn conversation_inbounds_by_phone(
        &self,
        salon_id: &str,
        phone: &str,
        limit: usize,
    ) -> Result<Vec<Document>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit as i64)
            .build();
        let mut cursor = self
            .inbounds
            .find(
                doc! { "salonId": salon_id, "waPhone": phone },
                Some(options),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn conversation_outbounds_by_phone(
        &self,
        salon_id: &str,
        phone: &str,
        limit: usize,
    ) -> Result<Vec<Document>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit as i64)
            .build();
        let mut cursor = self
            .outbounds
            .find(
                doc! { "salonId": salon_id, "toPhone": phone },
                Some(options),
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn customer_by_normalized_phone(
        &self,
        salon_id: &str,
        normalized_phone: &str,
        limit_depth: usize,
    ) -> Result<Vec<Document>, AppError> {
        let filter = doc! { "salonId": salon_id, "normalizedPhone": normalized_phone };
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "updatedAt": -1 })
            .limit((limit_depth.max(1)) as i64)
            .build();
        let mut cursor = self
            .customers
            .find(filter, Some(options))
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn customer_by_id_in_branches(
        &self,
        salon_id: &str,
        customer_id: &ObjectId,
        branch_ids: &[String],
    ) -> Result<Option<Document>, AppError> {
        self.customers
            .find_one(
                doc! {
                    "_id": customer_id,
                    "salonId": salon_id,
                    "branchId": { "$in": branch_ids },
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn get_booking_session(
        &self,
        salon_id: &str,
        wa_phone: &str,
    ) -> Result<Option<Document>, AppError> {
        self.whatsapp_sessions
            .find_one(doc! { "salonId": salon_id, "waPhone": wa_phone }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn upsert_booking_session(
        &self,
        salon_id: &str,
        wa_phone: &str,
        fields: Document,
    ) -> Result<(), AppError> {
        self.whatsapp_sessions
            .find_one_and_update(
                doc! { "salonId": salon_id, "waPhone": wa_phone },
                doc! {
                    "$set": {
                        "salonId": salon_id,
                        "waPhone": wa_phone,
                        "updatedAt": DateTime::now(),
                        "expiresAt": DateTime::from_millis(DateTime::now().timestamp_millis() + 30 * 60_000),
                    },
                    "$setOnInsert": { "createdAt": DateTime::now() },
                },
                mongodb::options::FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        self.whatsapp_sessions
            .update_one(
                doc! { "salonId": salon_id, "waPhone": wa_phone },
                doc! { "$set": fields },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn clear_booking_session(
        &self,
        salon_id: &str,
        wa_phone: &str,
    ) -> Result<(), AppError> {
        self.whatsapp_sessions
            .delete_one(doc! { "salonId": salon_id, "waPhone": wa_phone }, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct PushDeviceRepository {
    devices: Collection<Document>,
}

impl PushDeviceRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            devices: database.collection("pushdevices"),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_device(
        &self,
        salon_id: &str,
        user_id: &str,
        device_id: &str,
        platform: &str,
        push_provider: &str,
        device_token: &str,
        app_version: &str,
        capabilities: Document,
    ) -> Result<(), AppError> {
        self.devices
            .update_one(
                doc! { "userId": user_id, "deviceId": device_id },
                doc! {
                    "$set": {
                        "salonId": salon_id,
                        "platform": platform,
                        "pushProvider": push_provider,
                        "deviceToken": device_token,
                        "appVersion": app_version,
                        "capabilities": mongodb::bson::Bson::Document(capabilities),
                        "updatedAt": DateTime::now(),
                    },
                    "$setOnInsert": {
                        "createdAt": DateTime::now(),
                    }
                },
                mongodb::options::UpdateOptions::builder()
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn upsert_subscription(
        &self,
        salon_id: &str,
        user_id: &str,
        device_id: &str,
        subscription: Document,
    ) -> Result<(), AppError> {
        self.devices
            .update_one(
                doc! { "userId": user_id, "deviceId": device_id },
                doc! {
                    "$set": {
                        "salonId": salon_id,
                        "subscription": mongodb::bson::Bson::Document(subscription),
                        "updatedAt": DateTime::now(),
                    },
                    "$setOnInsert": {
                        "deviceId": device_id,
                        "userId": user_id,
                        "platform": "web",
                        "pushProvider": "web-push",
                        "deviceToken": "",
                        "appVersion": "",
                        "capabilities": doc! { "pwa": true, "native": false, "pushNotifications": true },
                        "createdAt": DateTime::now(),
                    }
                },
                mongodb::options::UpdateOptions::builder()
                    .upsert(true)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn devices_for_user(
        &self,
        salon_id: &str,
        user_id: &str,
    ) -> Result<Vec<Document>, AppError> {
        let mut cursor = self
            .devices
            .find(
                doc! { "salonId": salon_id, "userId": user_id, "subscription": { "$ne": null } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn delete_device(&self, device_id: &str) -> Result<(), AppError> {
        self.devices
            .delete_one(doc! { "_id": { "$oid": device_id } }, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct AttendanceRepository {
    attendance: Collection<AttendanceRecord>,
}

impl AttendanceRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            attendance: database.collection("attendances"),
        }
    }

    pub async fn list(
        &self,
        salon_id: &str,
        staff_id: &str,
        date: Option<&str>,
        from: Option<&str>,
        to: Option<&str>,
        limit: i64,
    ) -> Result<Vec<AttendanceRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "staffId": staff_id };
        if let Some(date) = date {
            filter.insert("businessDate", date);
        } else if from.is_some() || to.is_some() {
            let mut range = doc! {};
            if let Some(from) = from {
                range.insert("$gte", from);
            }
            if let Some(to) = to {
                range.insert("$lte", to);
            }
            filter.insert("businessDate", range);
        }
        let mut cursor = self
            .attendance
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 500)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|item| -item.clock_in_at.timestamp_millis());
        Ok(items)
    }

    pub async fn open_for_staff(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Option<AttendanceRecord>, AppError> {
        self.attendance
            .find_one(
                doc! { "salonId": salon_id, "staffId": staff_id, "status": "open" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn clock_in(&self, record: AttendanceRecord) -> Result<AttendanceRecord, AppError> {
        self.attendance
            .insert_one(&record, None)
            .await
            .map_err(|_| {
                AppError::Conflict(
                    "You are already checked in. Clock out before clocking in again.".to_string(),
                )
            })?;
        Ok(record)
    }

    pub async fn clock_out(
        &self,
        salon_id: &str,
        staff_id: &str,
        attendance_id: ObjectId,
        clock_out_at: DateTime,
    ) -> Result<Option<AttendanceRecord>, AppError> {
        self.attendance.find_one_and_update(
            doc! { "_id": attendance_id, "salonId": salon_id, "staffId": staff_id, "status": "open" },
            doc! { "$set": { "status": "closed", "clockOutAt": clock_out_at } },
            FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).build(),
        ).await.map_err(|_| AppError::Database)
    }

    pub async fn start_break(
        &self,
        salon_id: &str,
        staff_id: &str,
        break_type: &str,
    ) -> Result<Option<AttendanceRecord>, AppError> {
        self.attendance.find_one_and_update(
            doc! { "salonId": salon_id, "staffId": staff_id, "status": "open", "breaks": { "$not": { "$elemMatch": { "endedAt": null } } } },
            doc! { "$push": { "breaks": { "breakType": break_type, "startedAt": DateTime::now(), "endedAt": null } } },
            FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).build(),
        ).await.map_err(|_| AppError::Database)
    }

    pub async fn end_break(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Option<AttendanceRecord>, AppError> {
        self.attendance.find_one_and_update(
            doc! { "salonId": salon_id, "staffId": staff_id, "status": "open", "breaks": { "$elemMatch": { "endedAt": null } } },
            doc! { "$set": { "breaks.$[openBreak].endedAt": DateTime::now() } },
            FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).array_filters(vec![doc! { "openBreak.endedAt": null }]).build(),
        ).await.map_err(|_| AppError::Database)
    }
}

#[derive(Clone)]
pub struct StaffRepository {
    leaves: Collection<StaffLeaveRecord>,
    tasks: Collection<StaffTaskRecord>,
    payroll: Collection<PayrollItemRecord>,
    targets: Collection<TargetRecord>,
    schedules: Collection<ScheduleRecord>,
    shift_swaps: Collection<ShiftSwapRecord>,
    notifications: Collection<NotificationRecord>,
}

#[derive(Clone)]
pub struct OwnerRepository {
    users: Collection<UserRecord>,
    branches: Collection<BranchRecord>,
    customers: Collection<CustomerRecord>,
    settings: Collection<OwnerSettingsRecord>,
    leaves: Collection<StaffLeaveRecord>,
    appointments: Collection<AppointmentRecord>,
    invoices: Collection<InvoiceRecord>,
    client_photos: Collection<ClientPhotoRecord>,
    whatsapp_outbounds: Collection<Document>,
    whatsapp_inbounds: Collection<Document>,
    whatsapp_sessions: Collection<Document>,
    whatsapp_templates: Collection<Document>,
    waitlists: Collection<Document>,
}

#[derive(Clone)]
pub struct ChatRepository {
    conversations: Collection<ConversationRecord>,
    messages: Collection<ConversationMessageRecord>,
}

impl ChatRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            conversations: database.collection("conversations"),
            messages: database.collection("conversationmessages"),
        }
    }

    pub async fn team_conversation(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Option<ConversationRecord>, AppError> {
        self.conversations
            .find_one(
                doc! { "salonId": salon_id, "branchId": branch_id, "type": "team" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn ensure_team_conversation(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<ConversationRecord, AppError> {
        if let Some(existing) = self.team_conversation(salon_id, branch_id).await? {
            return Ok(existing);
        }
        let conversation = ConversationRecord {
            id: ObjectId::new(),
            salon_id: salon_id.to_string(),
            branch_id: branch_id.to_string(),
            conversation_type: "team".to_string(),
            title: "Team".to_string(),
            participant_user_ids: Vec::new(),
            last_message_at: None,
        };
        self.conversations
            .insert_one(&conversation, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(conversation)
    }

    pub async fn visible_conversations(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        user_id: &str,
    ) -> Result<Vec<ConversationRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if branch_ids.is_empty() {
            filter.insert("branchId", "");
        } else {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        filter.insert(
            "$or",
            vec![
                doc! { "type": "team" },
                doc! { "type": "private-owner", "participantUserIds": user_id },
            ],
        );
        let mut cursor = self
            .conversations
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.last_message_at));
        Ok(items)
    }

    pub async fn conversation(
        &self,
        salon_id: &str,
        conversation_id: ObjectId,
    ) -> Result<Option<ConversationRecord>, AppError> {
        self.conversations
            .find_one(doc! { "_id": conversation_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn count_messages(
        &self,
        salon_id: &str,
        conversation_id: ObjectId,
        user_id: &str,
    ) -> Result<(u64, u64), AppError> {
        let total = self
            .messages
            .count_documents(
                doc! { "salonId": salon_id, "conversationId": conversation_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let unread = self
            .messages
            .count_documents(
                doc! { "salonId": salon_id, "conversationId": conversation_id, "senderUserId": { "$ne": user_id }, "readCount": 0 },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok((total, unread))
    }

    pub async fn messages(
        &self,
        salon_id: &str,
        conversation_id: ObjectId,
    ) -> Result<Vec<ConversationMessageRecord>, AppError> {
        let mut cursor = self
            .messages
            .find(
                doc! { "salonId": salon_id, "conversationId": conversation_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 200 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|m| m.id.timestamp().timestamp_millis());
        Ok(items)
    }

    pub async fn update_delivered(
        &self,
        salon_id: &str,
        conversation_id: ObjectId,
        user_id: &str,
    ) -> Result<(), AppError> {
        self.messages
            .update_many(
                doc! { "salonId": salon_id, "conversationId": conversation_id, "senderUserId": { "$ne": user_id } },
                doc! { "$inc": { "deliveredCount": 1 } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn increment_receipts(
        &self,
        salon_id: &str,
        conversation_id: ObjectId,
        message_ids: &[ObjectId],
        field: &str,
    ) -> Result<usize, AppError> {
        if message_ids.is_empty() {
            return Ok(0);
        }
        let field = if field == "read" {
            "readCount"
        } else {
            "deliveredCount"
        };
        let result = self
            .messages
            .update_many(
                doc! { "salonId": salon_id, "conversationId": conversation_id, "_id": { "$in": message_ids } },
                doc! { "$inc": { field: 1 } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(result.modified_count as usize)
    }

    pub async fn insert_message(
        &self,
        message: ConversationMessageRecord,
        conversation_id: ObjectId,
    ) -> Result<ConversationMessageRecord, AppError> {
        self.messages
            .insert_one(&message, None)
            .await
            .map_err(|_| AppError::Database)?;
        self.conversations
            .update_one(
                doc! { "_id": conversation_id },
                doc! { "$set": { "lastMessageAt": DateTime::now() } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(message)
    }

    pub async fn search_messages(
        &self,
        salon_id: &str,
        conversation_ids: &[ObjectId],
        term: &str,
    ) -> Result<Vec<ConversationMessageRecord>, AppError> {
        if conversation_ids.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = regex_escape(term);
        let mut cursor = self
            .messages
            .find(
                doc! { "salonId": salon_id, "conversationId": { "$in": conversation_ids }, "body": { "$regex": pattern } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 50 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }
}

impl OwnerRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            users: database.collection("users"),
            branches: database.collection("branches"),
            customers: database.collection("customers"),
            settings: database.collection("ownersettings"),
            leaves: database.collection("leaves"),
            appointments: database.collection("appointments"),
            invoices: database.collection("invoices"),
            client_photos: database.collection("clientphotos"),
            whatsapp_outbounds: database.collection("whatsappoutbounds"),
            whatsapp_inbounds: database.collection("whatsappinbounds"),
            whatsapp_sessions: database.collection("whatsappbookingsessions"),
            whatsapp_templates: database.collection("whatsapptemplates"),
            waitlists: database.collection("waitlists"),
        }
    }

    pub async fn branches(&self, salon_id: &str) -> Result<Vec<BranchRecord>, AppError> {
        let mut cursor = self
            .branches
            .find(doc! { "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn staff(
        &self,
        salon_id: &str,
        branch_ids: &[String],
    ) -> Result<Vec<UserRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "staffId": { "$ne": null } };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let mut cursor = self
            .users
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 200 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn users(&self, salon_id: &str) -> Result<Vec<UserRecord>, AppError> {
        let mut cursor = self
            .users
            .find(doc! { "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn create_user(&self, user: &UserRecord) -> Result<UserRecord, AppError> {
        let mut user = user.clone();
        user.id = ObjectId::new();
        self.users
            .insert_one(&user, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(user)
    }

    pub async fn update_user(
        &self,
        salon_id: &str,
        user_id: ObjectId,
        update: mongodb::bson::Document,
    ) -> Result<Option<UserRecord>, AppError> {
        self.users
            .find_one_and_update(
                doc! { "_id": user_id, "salonId": salon_id },
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn clients(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        limit: i64,
    ) -> Result<Vec<CustomerRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let mut cursor = self
            .customers
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 200)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)
    }

    pub async fn upsert_owner_customer(
        &self,
        customer: &CustomerRecord,
    ) -> Result<CustomerRecord, AppError> {
        let now = DateTime::now();
        self.customers
            .find_one_and_update(
                doc! { "salonId": &customer.salon_id, "normalizedPhone": &customer.normalized_phone },
                doc! {
                    "$setOnInsert": { "source": "owner", "createdAt": now },
                    "$set": {
                        "branchId": &customer.branch_id,
                        "name": &customer.name,
                        "email": &customer.email,
                        "gender": &customer.gender,
                        "birthday": &customer.birthday,
                        "anniversary": &customer.anniversary,
                        "tags": &customer.tags,
                        "notes": &customer.notes,
                        "address": &customer.address,
                        "walletBalancePaise": customer.wallet_balance_paise,
                        "loyaltyPoints": customer.loyalty_points,
                        "membershipPlanName": &customer.membership_plan_name,
                        "membershipCredits": customer.membership_credits,
                        "membershipCreditsRemaining": customer.membership_credits_remaining,
                        "membershipValidUntil": &customer.membership_valid_until,
                        "membershipStatus": &customer.membership_status,
                        "packageName": &customer.package_name,
                        "packageCreditsRemaining": customer.package_credits_remaining,
                        "subscriptionName": &customer.subscription_name,
                        "subscriptionStatus": &customer.subscription_status,
                        "interactionStatus": "active",
                        "updatedAt": now,
                    }
                },
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn find_owner_customer(
        &self,
        salon_id: &str,
        customer_id: ObjectId,
        branch_ids: &[String],
    ) -> Result<Option<CustomerRecord>, AppError> {
        let mut filter = doc! { "_id": customer_id, "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        self.customers
            .find_one(filter, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_owner_customer(
        &self,
        salon_id: &str,
        customer_id: ObjectId,
        branch_ids: &[String],
        update: mongodb::bson::Document,
    ) -> Result<Option<CustomerRecord>, AppError> {
        let mut filter = doc! { "_id": customer_id, "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        self.customers
            .find_one_and_update(
                filter,
                doc! { "$set": update },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn appointments_for_customer(
        &self,
        salon_id: &str,
        customer_id: &str,
        branch_id: Option<&str>,
    ) -> Result<Vec<AppointmentRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "customerId": customer_id };
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            filter.insert("branchId", branch_id);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "startAt": -1 })
            .limit(200)
            .build();
        let mut cursor = self
            .appointments
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn invoices_for_customer(
        &self,
        salon_id: &str,
        customer_id: &str,
        branch_id: Option<&str>,
    ) -> Result<Vec<InvoiceRecord>, AppError> {
        let mut filter =
            doc! { "salonId": salon_id, "customerId": customer_id, "status": { "$ne": "void" } };
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            filter.insert("branchId", branch_id);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(200)
            .build();
        let mut cursor = self
            .invoices
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn photos_for_customer(
        &self,
        salon_id: &str,
        customer_id: &str,
        branch_id: Option<&str>,
    ) -> Result<Vec<ClientPhotoRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "customerId": customer_id };
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            filter.insert("branchId", branch_id);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(100)
            .build();
        let mut cursor = self
            .client_photos
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_client_photo(
        &self,
        photo: &ClientPhotoRecord,
    ) -> Result<ClientPhotoRecord, AppError> {
        let mut photo = photo.clone();
        photo.id = ObjectId::new();
        photo.created_at = Some(DateTime::now());
        self.client_photos
            .insert_one(&photo, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(photo)
    }

    pub async fn delete_client_photo(
        &self,
        salon_id: &str,
        customer_id: &str,
        photo_id: ObjectId,
        branch_ids: &[String],
    ) -> Result<Option<ClientPhotoRecord>, AppError> {
        let mut filter = doc! { "_id": photo_id, "salonId": salon_id, "customerId": customer_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        self.client_photos
            .find_one_and_delete(filter, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn whatsapp_intelligence_docs(
        &self,
        salon_id: &str,
        since: DateTime,
    ) -> Result<
        (
            Vec<Document>,
            Vec<Document>,
            Vec<Document>,
            Vec<CustomerRecord>,
            Vec<Document>,
            Vec<Document>,
        ),
        AppError,
    > {
        let outbound = self
            .collect_documents(
                &self.whatsapp_outbounds,
                doc! { "salonId": salon_id, "createdAt": { "$gte": since } },
                Some(doc! { "createdAt": -1 }),
                1000,
            )
            .await?;
        let inbound = self
            .collect_documents(
                &self.whatsapp_inbounds,
                doc! { "salonId": salon_id, "receivedAt": { "$gte": since } },
                Some(doc! { "receivedAt": -1 }),
                1000,
            )
            .await?;
        let sessions = self
            .collect_documents(
                &self.whatsapp_sessions,
                doc! { "salonId": salon_id },
                Some(doc! { "updatedAt": -1 }),
                1000,
            )
            .await?;
        let mut customers = self.clients(salon_id, &[], 100).await?;
        customers.sort_by_key(|customer| std::cmp::Reverse(customer.updated_at));
        let templates = self
            .collect_documents(
                &self.whatsapp_templates,
                doc! { "salonId": salon_id },
                Some(doc! { "name": 1 }),
                1000,
            )
            .await?;
        let waitlist = self
            .collect_documents(
                &self.waitlists,
                doc! { "salonId": salon_id, "status": { "$in": ["waiting", "offered"] } },
                Some(doc! { "createdAt": -1 }),
                100,
            )
            .await?;
        Ok((outbound, inbound, sessions, customers, templates, waitlist))
    }

    async fn collect_documents(
        &self,
        collection: &Collection<Document>,
        filter: Document,
        sort: Option<Document>,
        limit: i64,
    ) -> Result<Vec<Document>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .sort(sort)
            .limit(limit)
            .build();
        let mut cursor = collection
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn staff_ids_for_branches(
        &self,
        salon_id: &str,
        branch_ids: &[String],
    ) -> Result<Vec<String>, AppError> {
        let mut filter = doc! { "salonId": salon_id, "staffId": { "$ne": null } };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let mut cursor = self
            .users
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut ids = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let user: UserRecord = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            if let Some(staff_id) = user.staff_id {
                ids.push(staff_id);
            }
        }
        Ok(ids)
    }

    pub async fn staff_by_staff_ids(
        &self,
        salon_id: &str,
        staff_ids: &[String],
    ) -> Result<Vec<UserRecord>, AppError> {
        if staff_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut cursor = self
            .users
            .find(
                doc! { "salonId": salon_id, "staffId": { "$in": staff_ids } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut users = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            users.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(users)
    }

    pub async fn staff_ids_matching_name(
        &self,
        salon_id: &str,
        search: &str,
    ) -> Result<Vec<String>, AppError> {
        let mut cursor = self
            .users
            .find(
                doc! {
                    "salonId": salon_id,
                    "staffId": { "$ne": null },
                    "name": { "$regex": format!("(?i){}", regex_escape(search)) },
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut ids = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let user: UserRecord = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            if let Some(staff_id) = user.staff_id {
                ids.push(staff_id);
            }
        }
        Ok(ids)
    }

    pub async fn list_owner_leaves(
        &self,
        filter: mongodb::bson::Document,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<StaffLeaveRecord>, u64), AppError> {
        let total = self
            .leaves
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(offset.max(0) as u64)
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .leaves
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((items, total))
    }

    pub async fn find_owner_leave(
        &self,
        salon_id: &str,
        leave_id: ObjectId,
    ) -> Result<Option<StaffLeaveRecord>, AppError> {
        self.leaves
            .find_one(doc! { "_id": leave_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn approved_leaves_for_staff(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Vec<StaffLeaveRecord>, AppError> {
        let mut cursor = self
            .leaves
            .find(
                doc! { "salonId": salon_id, "staffId": staff_id, "status": "approved" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn leave_conflicts(
        &self,
        salon_id: &str,
        leave: &StaffLeaveRecord,
    ) -> Result<Vec<StaffLeaveRecord>, AppError> {
        let mut cursor = self
            .leaves
            .find(
                doc! {
                    "salonId": salon_id,
                    "staffId": &leave.staff_id,
                    "_id": { "$ne": leave.id },
                    "status": "approved",
                    "startDate": { "$lte": &leave.end_date },
                    "endDate": { "$gte": &leave.start_date },
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn decide_leave(
        &self,
        salon_id: &str,
        leave_id: ObjectId,
        version: i64,
        status: &str,
        note: &str,
        decided_by: &str,
    ) -> Result<Option<StaffLeaveRecord>, AppError> {
        self.leaves
            .find_one_and_update(
                doc! { "_id": leave_id, "salonId": salon_id, "status": "pending", "version": version },
                doc! {
                    "$set": {
                        "status": status,
                        "decisionNote": note,
                        "decidedBy": decided_by,
                        "decidedAt": DateTime::now(),
                        "version": version + 1,
                    }
                },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn settings(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Option<OwnerSettingsRecord>, AppError> {
        self.settings
            .find_one(doc! { "salonId": salon_id, "branchId": branch_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_settings(
        &self,
        salon_id: &str,
        branch_id: &str,
        settings: mongodb::bson::Document,
        changed_by: &str,
    ) -> Result<OwnerSettingsRecord, AppError> {
        self.settings
            .find_one_and_update(
                doc! { "salonId": salon_id, "branchId": branch_id },
                doc! { "$set": { "settings": settings, "lastChangedBy": changed_by } },
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }
}

impl StaffRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            leaves: database.collection("leaves"),
            tasks: database.collection("tasks"),
            payroll: database.collection("payrollitems"),
            targets: database.collection("targets"),
            schedules: database.collection("schedules"),
            shift_swaps: database.collection("shiftswaps"),
            notifications: database.collection("notifications"),
        }
    }

    pub async fn schedules(
        &self,
        salon_id: &str,
        staff_id: &str,
        limit: i64,
    ) -> Result<Vec<ScheduleRecord>, AppError> {
        let mut cursor = self
            .schedules
            .find(doc! { "salonId": salon_id, "staffId": staff_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 60)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by(|a, b| b.schedule_date.cmp(&a.schedule_date));
        Ok(items)
    }

    pub async fn schedule(
        &self,
        salon_id: &str,
        staff_id: &str,
        schedule_id: ObjectId,
    ) -> Result<Option<ScheduleRecord>, AppError> {
        self.schedules
            .find_one(
                doc! { "_id": schedule_id, "salonId": salon_id, "staffId": staff_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_schedule(
        &self,
        salon_id: &str,
        schedule_id: ObjectId,
        status: &str,
        version: i64,
    ) -> Result<Option<ScheduleRecord>, AppError> {
        self.schedules
            .find_one_and_update(
                doc! { "_id": schedule_id, "salonId": salon_id, "version": version },
                doc! { "$set": { "status": status }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn coworker_schedules(
        &self,
        salon_id: &str,
        branch_id: &str,
        staff_id: &str,
    ) -> Result<Vec<ScheduleRecord>, AppError> {
        let mut cursor = self
            .schedules
            .find(
                doc! { "salonId": salon_id, "branchId": branch_id, "staffId": { "$ne": staff_id } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 100 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn shift_swaps_for(
        &self,
        salon_id: &str,
        staff_id: &str,
        limit: i64,
    ) -> Result<Vec<ShiftSwapRecord>, AppError> {
        let mut cursor = self
            .shift_swaps
            .find(
                doc! { "salonId": salon_id, "$or": [ { "fromStaffId": staff_id }, { "toStaffId": staff_id } ] },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 30)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_shift_swap(
        &self,
        swap: ShiftSwapRecord,
    ) -> Result<ShiftSwapRecord, AppError> {
        self.shift_swaps
            .insert_one(&swap, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(swap)
    }

    pub async fn pending_shift_swap(
        &self,
        salon_id: &str,
        schedule_id: &str,
    ) -> Result<Option<ShiftSwapRecord>, AppError> {
        self.shift_swaps
            .find_one(
                doc! { "salonId": salon_id, "scheduleId": schedule_id, "status": { "$in": ["pending", "pending_manager"] } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn respond_shift_swap(
        &self,
        salon_id: &str,
        to_staff_id: &str,
        swap_id: ObjectId,
        status: &str,
        note: &str,
        version: i64,
    ) -> Result<Option<ShiftSwapRecord>, AppError> {
        self.shift_swaps
            .find_one_and_update(
                doc! { "_id": swap_id, "salonId": salon_id, "toStaffId": to_staff_id, "version": version },
                doc! { "$set": { "status": status, "targetResponseNote": note }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn cancel_shift_swap(
        &self,
        salon_id: &str,
        from_staff_id: &str,
        swap_id: ObjectId,
        version: i64,
    ) -> Result<Option<ShiftSwapRecord>, AppError> {
        self.shift_swaps
            .find_one_and_update(
                doc! { "_id": swap_id, "salonId": salon_id, "fromStaffId": from_staff_id, "version": version, "status": { "$in": ["pending", "pending_manager"] } },
                doc! { "$set": { "status": "cancelled" }, "$inc": { "version": 1 } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_notification(
        &self,
        salon_id: &str,
        user_id: &str,
        notification_id: ObjectId,
        status: &str,
    ) -> Result<Option<NotificationRecord>, AppError> {
        self.notifications
            .find_one_and_update(
                doc! { "_id": notification_id, "salonId": salon_id, "userId": user_id },
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn notifications(
        &self,
        salon_id: &str,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<NotificationRecord>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "_id": -1 })
            .limit(limit.clamp(1, 100))
            .build();
        let mut cursor = self
            .notifications
            .find(doc! { "salonId": salon_id, "userId": user_id }, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn leaves(
        &self,
        salon_id: &str,
        staff_id: &str,
        limit: i64,
    ) -> Result<Vec<StaffLeaveRecord>, AppError> {
        let mut cursor = self
            .leaves
            .find(doc! { "salonId": salon_id, "staffId": staff_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)?
            && (items.len() as i64) < limit.clamp(1, 50)
        {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_leave(
        &self,
        leave: StaffLeaveRecord,
    ) -> Result<StaffLeaveRecord, AppError> {
        self.leaves
            .insert_one(&leave, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(leave)
    }

    pub async fn active_tasks(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Vec<StaffTaskRecord>, AppError> {
        let mut cursor = self.tasks.find(doc! { "salonId": salon_id, "status": { "$in": ["pending", "in_progress"] }, "$or": [ { "staffId": staff_id }, { "staffId": null } ] }, None).await.map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 50 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn update_task(
        &self,
        salon_id: &str,
        staff_id: &str,
        task_id: ObjectId,
        status: &str,
        version: i64,
    ) -> Result<Option<StaffTaskRecord>, AppError> {
        self.tasks.find_one_and_update(doc! { "_id": task_id, "salonId": salon_id, "version": version, "$or": [ { "staffId": staff_id }, { "staffId": null } ] }, doc! { "$set": { "status": status }, "$inc": { "version": 1 } }, FindOneAndUpdateOptions::builder().return_document(ReturnDocument::After).build()).await.map_err(|_| AppError::Database)
    }

    pub async fn payroll(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Vec<PayrollItemRecord>, AppError> {
        let mut cursor = self
            .payroll
            .find(doc! { "salonId": salon_id, "staffId": staff_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 24 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn targets(
        &self,
        salon_id: &str,
        staff_id: &str,
    ) -> Result<Vec<TargetRecord>, AppError> {
        let mut cursor = self.targets.find(doc! { "salonId": salon_id, "$or": [ { "staffId": staff_id }, { "staffId": null } ] }, None).await.map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? && items.len() < 20 {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }
}

impl SalonRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            salons: database.collection("salons"),
        }
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<SalonRecord>, AppError> {
        self.salons
            .find_one(doc! { "_id": id.trim() }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_first_active(&self) -> Result<Option<SalonRecord>, AppError> {
        self.salons
            .find_one(doc! { "status": "active" }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn add_whatsapp_phone_number(
        &self,
        salon_id: &str,
        phone_number_id: &str,
    ) -> Result<(), AppError> {
        self.salons
            .update_one(
                doc! { "_id": salon_id.trim() },
                doc! { "$addToSet": { "whatsappPhoneNumberIds": phone_number_id } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn remove_whatsapp_phone_number(
        &self,
        salon_id: &str,
        phone_number_id: &str,
    ) -> Result<(), AppError> {
        self.salons
            .update_one(
                doc! { "_id": salon_id.trim() },
                doc! { "$pull": { "whatsappPhoneNumberIds": phone_number_id } },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct FinanceRepository {
    invoices: Collection<InvoiceRecord>,
    expenses: Collection<ExpenseRecord>,
    tips: Collection<TipRecord>,
    settings: Collection<OwnerSettingsRecord>,
    branches: Collection<BranchRecord>,
    customers: Collection<CustomerRecord>,
    appointments: Collection<AppointmentRecord>,
    purchase_orders: Collection<PurchaseOrderRecord>,
    gift_cards: Collection<GiftCardRecord>,
    bundle_deals: Collection<BundleDealRecord>,
    audit_logs: Collection<AuditLogRecord>,
    promos: Collection<PromoCodeRecord>,
    promo_redemptions: Collection<PromoRedemptionRecord>,
    payroll_runs: Collection<PayrollRunRecord>,
    users: Collection<UserRecord>,
    attendances: Collection<AttendanceRecord>,
}

impl FinanceRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            invoices: database.collection("invoices"),
            expenses: database.collection("expenses"),
            tips: database.collection("tips"),
            settings: database.collection("ownersettings"),
            branches: database.collection("branches"),
            customers: database.collection("customers"),
            appointments: database.collection("appointments"),
            purchase_orders: database.collection("purchaseorders"),
            gift_cards: database.collection("giftcards"),
            bundle_deals: database.collection("bundledeals"),
            audit_logs: database.collection("auditlogs"),
            promos: database.collection("promos"),
            promo_redemptions: database.collection("promoredemptions"),
            payroll_runs: database.collection("payrollruns"),
            users: database.collection("users"),
            attendances: database.collection("attendances"),
        }
    }

    pub async fn list_invoices(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        limit: i64,
        offset: i64,
    ) -> Result<(u64, Vec<InvoiceRecord>), AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let total = self
            .invoices
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(offset as u64)
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .invoices
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((total, items))
    }

    pub async fn find_invoice(
        &self,
        salon_id: &str,
        invoice_id: ObjectId,
    ) -> Result<Option<InvoiceRecord>, AppError> {
        self.invoices
            .find_one(doc! { "_id": invoice_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn record_payment(
        &self,
        salon_id: &str,
        invoice_id: ObjectId,
        method: &str,
        amount_paise: i64,
        reference: &str,
        user_id: &str,
    ) -> Result<Option<InvoiceRecord>, AppError> {
        let now = DateTime::now();
        let payment_doc = doc! { "method": method, "amountPaise": amount_paise, "reference": reference, "receivedByUserId": user_id, "receivedAt": now };
        let pipeline = vec![
            doc! { "$set": { "payments": { "$concatArrays": [ "$payments", [ payment_doc ] ] } } },
            doc! { "$set": { "paidAmountPaise": { "$add": [ "$paidAmountPaise", amount_paise ] }, "dueAmountPaise": { "$subtract": [ "$dueAmountPaise", amount_paise ] } } },
            doc! { "$set": { "paymentStatus": { "$cond": [ { "$eq": [ "$dueAmountPaise", 0 ] }, "paid", "partial" ] } } },
        ];
        self.invoices
            .find_one_and_update(
                doc! { "_id": invoice_id, "salonId": salon_id, "status": { "$ne": "void" }, "dueAmountPaise": { "$gte": amount_paise } },
                pipeline,
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn void_invoice(
        &self,
        salon_id: &str,
        invoice_id: ObjectId,
        reason: &str,
    ) -> Result<Option<InvoiceRecord>, AppError> {
        self.invoices
            .find_one_and_update(
                doc! { "_id": invoice_id, "salonId": salon_id, "status": { "$ne": "void" } },
                vec![doc! { "$set": { "status": "void", "voidReason": reason, "paidAmountPaise": 0, "dueAmountPaise": "$grandTotalPaise", "paymentStatus": "unpaid", "payments": [] } }],
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_appointment(
        &self,
        salon_id: &str,
        appointment_id: &str,
    ) -> Result<Option<AppointmentRecord>, AppError> {
        let object_id = ObjectId::parse_str(appointment_id).map_err(|_| {
            AppError::Validation(format!("Invalid appointment id: {appointment_id}"))
        })?;
        self.appointments
            .find_one(doc! { "_id": object_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_invoice_by_appointment(
        &self,
        salon_id: &str,
        appointment_id: &str,
    ) -> Result<Option<InvoiceRecord>, AppError> {
        self.invoices
            .find_one(
                doc! { "salonId": salon_id, "appointmentId": appointment_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn upsert_invoice_from_appointment(
        &self,
        salon_id: &str,
        invoice: &InvoiceRecord,
    ) -> Result<InvoiceRecord, AppError> {
        let lines = mongodb::bson::to_bson(&invoice.lines).map_err(|_| AppError::Database)?;
        self.invoices
            .find_one_and_update(
                doc! { "salonId": salon_id, "appointmentId": &invoice.appointment_id },
                doc! { "$setOnInsert": { "salonId": salon_id, "branchId": &invoice.branch_id, "customerId": &invoice.customer_id, "appointmentId": &invoice.appointment_id, "invoiceNumber": &invoice.invoice_number, "status": &invoice.status, "paymentStatus": &invoice.payment_status, "currency": &invoice.currency, "lines": lines, "subtotalPaise": invoice.subtotal_paise, "taxPaise": invoice.tax_paise, "grandTotalPaise": invoice.grand_total_paise, "paidAmountPaise": 0, "dueAmountPaise": invoice.due_amount_paise, "issuedAt": invoice.issued_at.unwrap_or_else(DateTime::now), "voidReason": "" } },
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?
            .ok_or(AppError::Database)
    }

    pub async fn list_tips_for_invoice(
        &self,
        salon_id: &str,
        invoice_id: &str,
    ) -> Result<Vec<TipRecord>, AppError> {
        let mut cursor = self
            .tips
            .find(doc! { "salonId": salon_id, "invoiceId": invoice_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.created_at));
        Ok(items)
    }

    pub async fn create_tip(&self, tip: &TipRecord) -> Result<TipRecord, AppError> {
        self.tips
            .insert_one(tip, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(tip.clone())
    }

    pub async fn create_expense(&self, expense: &ExpenseRecord) -> Result<ExpenseRecord, AppError> {
        let mut expense = expense.clone();
        expense.id = ObjectId::new();
        expense.created_at = Some(DateTime::now());
        self.expenses
            .insert_one(&expense, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(expense)
    }

    pub async fn update_expense(
        &self,
        salon_id: &str,
        expense_id: ObjectId,
        expense: &ExpenseRecord,
    ) -> Result<Option<ExpenseRecord>, AppError> {
        self.expenses
            .find_one_and_update(
                doc! { "_id": expense_id, "salonId": salon_id },
                doc! { "$set": { "branchId": &expense.branch_id, "date": &expense.date, "category": &expense.category, "vendor": &expense.vendor, "description": &expense.description, "amountPaise": expense.amount_paise, "taxRateBps": expense.tax_rate_bps, "taxPaise": expense.tax_paise, "totalPaise": expense.total_paise, "notes": &expense.notes } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn delete_expense(
        &self,
        salon_id: &str,
        expense_id: ObjectId,
    ) -> Result<Option<ExpenseRecord>, AppError> {
        self.expenses
            .find_one_and_delete(doc! { "_id": expense_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_expenses(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        from_date: &str,
        to_date: &str,
        category: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(u64, Vec<ExpenseRecord>), AppError> {
        let mut filter =
            doc! { "salonId": salon_id, "date": { "$gte": from_date, "$lte": to_date } };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        if category != "all" {
            filter.insert("category", category);
        }
        let total = self
            .expenses
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "date": -1, "createdAt": -1 })
            .skip(offset as u64)
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .expenses
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((total, items))
    }

    pub async fn expense_gst_aggregate(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        from_date: &str,
        to_date: &str,
    ) -> Result<(u64, i64, i64), AppError> {
        let mut filter =
            doc! { "salonId": salon_id, "date": { "$gte": from_date, "$lte": to_date } };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let mut cursor = self
            .expenses
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut count: u64 = 0;
        let mut total_amount: i64 = 0;
        let mut total_input_tax: i64 = 0;
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let expense: ExpenseRecord = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            count += 1;
            total_amount += expense.amount_paise;
            total_input_tax += expense.tax_paise;
        }
        Ok((count, total_amount, total_input_tax))
    }

    pub async fn branch_name(&self, salon_id: &str, branch_id: &str) -> Result<String, AppError> {
        Ok(self
            .branches
            .find_one(doc! { "_id": branch_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?
            .map(|branch| branch.name)
            .unwrap_or_else(|| branch_id.to_string()))
    }

    pub async fn customer_name(
        &self,
        salon_id: &str,
        customer_id: &str,
    ) -> Result<String, AppError> {
        if customer_id.is_empty() {
            return Ok(String::new());
        }
        let object_id = ObjectId::parse_str(customer_id).unwrap_or_default();
        Ok(self
            .customers
            .find_one(doc! { "_id": object_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?
            .map(|customer| customer.name)
            .unwrap_or_default())
    }

    pub async fn gst_issued_invoices(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        from_date: &str,
        to_date: &str,
    ) -> Result<Vec<InvoiceRecord>, AppError> {
        let start = DateTime::parse_rfc3339_str(format!("{from_date}T00:00:00.000Z"))
            .map_err(|_| AppError::Validation("Invalid date range.".to_string()))?;
        let end = DateTime::parse_rfc3339_str(format!("{to_date}T23:59:59.999Z"))
            .map_err(|_| AppError::Validation("Invalid date range.".to_string()))?;
        let mut filter = doc! { "salonId": salon_id, "status": "issued", "issuedAt": { "$gte": start, "$lte": end } };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        let mut cursor = self
            .invoices
            .find(filter, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn list_purchase_orders(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        status: &str,
        limit: i64,
    ) -> Result<Vec<PurchaseOrderRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        if status != "all" {
            filter.insert("status", status);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .purchase_orders
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_purchase_order(
        &self,
        purchase_order: &PurchaseOrderRecord,
    ) -> Result<PurchaseOrderRecord, AppError> {
        let mut purchase_order = purchase_order.clone();
        purchase_order.id = ObjectId::new();
        purchase_order.created_at = Some(DateTime::now());
        self.purchase_orders
            .insert_one(&purchase_order, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(purchase_order)
    }

    pub async fn update_purchase_order_status(
        &self,
        salon_id: &str,
        branch_ids: &[String],
        purchase_order_id: ObjectId,
        status: &str,
    ) -> Result<Option<PurchaseOrderRecord>, AppError> {
        let mut filter = doc! { "_id": purchase_order_id, "salonId": salon_id };
        if !branch_ids.is_empty() {
            filter.insert("branchId", doc! { "$in": branch_ids });
        }
        self.purchase_orders
            .find_one_and_update(
                filter,
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn list_gift_cards(
        &self,
        salon_id: &str,
        status: &str,
        limit: i64,
    ) -> Result<Vec<GiftCardRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if status != "all" {
            filter.insert("status", status);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .gift_cards
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_gift_card(
        &self,
        gift_card: &GiftCardRecord,
    ) -> Result<GiftCardRecord, AppError> {
        let mut gift_card = gift_card.clone();
        gift_card.id = ObjectId::new();
        gift_card.created_at = Some(DateTime::now());
        self.gift_cards
            .insert_one(&gift_card, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(gift_card)
    }

    pub async fn update_gift_card_status(
        &self,
        salon_id: &str,
        gift_card_id: ObjectId,
        status: &str,
    ) -> Result<Option<GiftCardRecord>, AppError> {
        self.gift_cards
            .find_one_and_update(
                doc! { "_id": gift_card_id, "salonId": salon_id },
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_active_gift_card(
        &self,
        salon_id: &str,
        gift_card_id: ObjectId,
    ) -> Result<Option<GiftCardRecord>, AppError> {
        self.gift_cards
            .find_one(
                doc! { "_id": gift_card_id, "salonId": salon_id, "status": "active" },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn redeem_gift_card(
        &self,
        gift_card_id: ObjectId,
        new_balance_paise: i64,
        set_redeemed: bool,
    ) -> Result<Option<GiftCardRecord>, AppError> {
        let mut set = doc! { "balancePaise": new_balance_paise };
        if set_redeemed {
            set.insert("status", "redeemed");
        }
        self.gift_cards
            .find_one_and_update(
                doc! { "_id": gift_card_id },
                doc! { "$set": set },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn list_bundle_deals(
        &self,
        salon_id: &str,
        limit: i64,
    ) -> Result<Vec<BundleDealRecord>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit.clamp(1, 200))
            .build();
        let mut cursor = self
            .bundle_deals
            .find(doc! { "salonId": salon_id }, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn create_bundle_deal(
        &self,
        bundle_deal: &BundleDealRecord,
    ) -> Result<BundleDealRecord, AppError> {
        let mut bundle_deal = bundle_deal.clone();
        bundle_deal.id = ObjectId::new();
        bundle_deal.created_at = Some(DateTime::now());
        self.bundle_deals
            .insert_one(&bundle_deal, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(bundle_deal)
    }

    pub async fn update_bundle_deal_status(
        &self,
        salon_id: &str,
        bundle_id: ObjectId,
        status: &str,
    ) -> Result<Option<BundleDealRecord>, AppError> {
        self.bundle_deals
            .find_one_and_update(
                doc! { "_id": bundle_id, "salonId": salon_id },
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn create_audit_log(
        &self,
        audit_log: &AuditLogRecord,
    ) -> Result<AuditLogRecord, AppError> {
        let mut audit_log = audit_log.clone();
        audit_log.id = ObjectId::new();
        audit_log.created_at = Some(DateTime::now());
        self.audit_logs
            .insert_one(&audit_log, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(audit_log)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_audit_logs(
        &self,
        salon_id: &str,
        action: Option<&str>,
        resource_type: Option<&str>,
        actor_user_id: Option<&str>,
        from: Option<DateTime>,
        to: Option<DateTime>,
        page: i64,
        page_size: i64,
    ) -> Result<(u64, Vec<AuditLogRecord>), AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if let Some(action) = action.filter(|a| !a.is_empty()) {
            let pattern = regex_escape(action);
            filter.insert("action", doc! { "$regex": format!("(?i){}", pattern) });
        }
        if let Some(resource_type) = resource_type.filter(|r| !r.is_empty()) {
            filter.insert("resourceType", resource_type);
        }
        if let Some(actor_user_id) = actor_user_id.filter(|a| !a.is_empty()) {
            filter.insert("actorUserId", actor_user_id);
        }
        if from.is_some() || to.is_some() {
            let mut range = doc! {};
            if let Some(from) = from {
                range.insert("$gte", from);
            }
            if let Some(to) = to {
                range.insert("$lte", to);
            }
            filter.insert("createdAt", range);
        }
        let total = self
            .audit_logs
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let skip = (page.saturating_sub(1)).saturating_mul(page_size);
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(skip as u64)
            .limit(page_size.clamp(1, 200))
            .build();
        let mut cursor = self
            .audit_logs
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((total, items))
    }

    pub async fn export_audit_logs(
        &self,
        salon_id: &str,
        from: Option<DateTime>,
        to: Option<DateTime>,
        limit: i64,
    ) -> Result<Vec<AuditLogRecord>, AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if from.is_some() || to.is_some() {
            let mut range = doc! {};
            if let Some(from) = from {
                range.insert("$gte", from);
            }
            if let Some(to) = to {
                range.insert("$lte", to);
            }
            filter.insert("createdAt", range);
        }
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .limit(limit.clamp(1, 5000))
            .build();
        let mut cursor = self
            .audit_logs
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn find_promo_by_id(
        &self,
        salon_id: &str,
        promo_id: ObjectId,
    ) -> Result<Option<PromoCodeRecord>, AppError> {
        self.promos
            .find_one(doc! { "_id": promo_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_promo_by_code(
        &self,
        salon_id: &str,
        code: &str,
    ) -> Result<Option<PromoCodeRecord>, AppError> {
        self.promos
            .find_one(
                doc! { "salonId": salon_id, "code": regex_escape(code).to_uppercase() },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn promo_code_exists(&self, salon_id: &str, code: &str) -> Result<bool, AppError> {
        let count = self
            .promos
            .count_documents(doc! { "salonId": salon_id, "code": code }, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(count > 0)
    }

    pub async fn create_promo(&self, promo: &PromoCodeRecord) -> Result<PromoCodeRecord, AppError> {
        let mut promo = promo.clone();
        promo.id = ObjectId::new();
        promo.created_at = Some(DateTime::now());
        self.promos
            .insert_one(&promo, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(promo)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_promos(
        &self,
        salon_id: &str,
        kind: Option<&str>,
        status: Option<&str>,
        search: Option<&str>,
        branch_ids: &[String],
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<PromoCodeRecord>, u64), AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if let Some(kind) = kind.filter(|k| !k.is_empty()) {
            filter.insert("kind", kind);
        }
        if let Some(status) = status.filter(|s| !s.is_empty()) {
            filter.insert("status", status);
        }
        if let Some(search) = search.filter(|s| !s.is_empty()) {
            filter.insert(
                "code",
                doc! { "$regex": format!("(?i){}", regex_escape(search)) },
            );
        }
        let branch_scope = if branch_ids.is_empty() {
            vec!["".to_string()]
        } else {
            branch_ids.to_vec()
        };
        filter.insert(
            "$or",
            vec![
                doc! { "anyBranch": true },
                doc! { "branchIds": { "$in": branch_scope } },
            ],
        );
        let total = self
            .promos
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let skip = (page.saturating_sub(1)).saturating_mul(page_size).max(0);
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(skip as u64)
            .limit(page_size.clamp(1, 100))
            .build();
        let mut cursor = self
            .promos
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((items, total))
    }

    pub async fn set_promo_status(
        &self,
        salon_id: &str,
        promo_id: ObjectId,
        status: &str,
    ) -> Result<Option<PromoCodeRecord>, AppError> {
        self.promos
            .find_one_and_update(
                doc! { "_id": promo_id, "salonId": salon_id },
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn update_promo_stats(
        &self,
        promo_id: ObjectId,
        redemption_count: i64,
        total_discount_paise: i64,
        status: &str,
    ) -> Result<(), AppError> {
        self.promos
            .update_one(
                doc! { "_id": promo_id },
                doc! {
                    "$set": {
                        "redemptionCount": redemption_count,
                        "totalDiscountPaise": total_discount_paise,
                        "status": status,
                    }
                },
                None,
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }

    pub async fn create_promo_redemption(
        &self,
        redemption: &PromoRedemptionRecord,
    ) -> Result<PromoRedemptionRecord, AppError> {
        let mut redemption = redemption.clone();
        redemption.id = ObjectId::new();
        redemption.applied_at = Some(DateTime::now());
        self.promo_redemptions
            .insert_one(&redemption, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(redemption)
    }

    pub async fn list_promo_redemptions(
        &self,
        salon_id: &str,
        promo_id: &str,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<PromoRedemptionRecord>, u64), AppError> {
        let filter = doc! { "salonId": salon_id, "promoId": promo_id };
        let total = self
            .promo_redemptions
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let skip = (page.saturating_sub(1)).saturating_mul(page_size).max(0);
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "appliedAt": -1 })
            .skip(skip as u64)
            .limit(page_size.clamp(1, 100))
            .build();
        let mut cursor = self
            .promo_redemptions
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((items, total))
    }

    pub async fn find_customer(
        &self,
        salon_id: &str,
        customer_id: &str,
    ) -> Result<Option<CustomerRecord>, AppError> {
        self.customers
            .find_one(
                doc! { "_id": ObjectId::parse_str(customer_id).ok().unwrap_or_default(), "salonId": salon_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_customer_by_phone(
        &self,
        salon_id: &str,
        phone: &str,
    ) -> Result<Option<CustomerRecord>, AppError> {
        self.customers
            .find_one(doc! { "salonId": salon_id, "normalizedPhone": phone }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn list_branch_ids(&self, salon_id: &str) -> Result<Vec<String>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .projection(doc! { "_id": 1 })
            .build();
        let mut cursor = self
            .branches
            .find(doc! { "salonId": salon_id }, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut ids = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let doc: BranchRecord = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            ids.push(doc.id);
        }
        Ok(ids)
    }

    pub async fn find_branch_name(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Option<String>, AppError> {
        let doc = self
            .branches
            .find_one(doc! { "_id": ObjectId::parse_str(branch_id).ok().unwrap_or_default(), "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)?;
        Ok(doc.map(|b| b.name))
    }

    pub async fn list_staff_users(
        &self,
        salon_id: &str,
        branch_id: &str,
    ) -> Result<Vec<UserRecord>, AppError> {
        let options = mongodb::options::FindOptions::builder()
            .projection(doc! { "_id": 1, "name": 1, "role": 1, "staffId": 1, "hourlyRatePaise": 1 })
            .build();
        let mut cursor = self
            .users
            .find(
                doc! {
                    "salonId": salon_id,
                    "branchIds": branch_id,
                    "role": { "$ne": "owner" },
                    "status": "active",
                },
                options,
            )
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok(items)
    }

    pub async fn attendance_minutes_summary(
        &self,
        salon_id: &str,
        start: DateTime,
        end: DateTime,
    ) -> Result<std::collections::HashMap<String, i64>, AppError> {
        let filter = doc! { "salonId": salon_id, "clockInAt": { "$gte": start, "$lte": end } };
        let options = mongodb::options::FindOptions::builder()
            .projection(doc! { "staffId": 1, "grossMinutes": 1 })
            .build();
        let mut cursor = self
            .attendances
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut map = std::collections::HashMap::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            let rec = cursor
                .deserialize_current()
                .map_err(|_| AppError::Database)?;
            let entry = map.entry(rec.staff_id).or_insert(0i64);
            *entry += rec.gross_minutes;
        }
        Ok(map)
    }

    pub async fn find_user(
        &self,
        salon_id: &str,
        user_id: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        self.users
            .find_one(
                doc! { "_id": ObjectId::parse_str(user_id).ok().unwrap_or_default(), "salonId": salon_id },
                None,
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn find_payroll_run(
        &self,
        salon_id: &str,
        run_id: ObjectId,
    ) -> Result<Option<PayrollRunRecord>, AppError> {
        self.payroll_runs
            .find_one(doc! { "_id": run_id, "salonId": salon_id }, None)
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn list_payroll_runs(
        &self,
        salon_id: &str,
        branch_id: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<PayrollRunRecord>, u64), AppError> {
        let mut filter = doc! { "salonId": salon_id };
        if let Some(branch_id) = branch_id.filter(|b| !b.is_empty() && *b != "all") {
            filter.insert("branchId", branch_id);
        }
        let total = self
            .payroll_runs
            .count_documents(filter.clone(), None)
            .await
            .map_err(|_| AppError::Database)?;
        let options = mongodb::options::FindOptions::builder()
            .sort(doc! { "createdAt": -1 })
            .skip(offset.max(0) as u64)
            .limit(limit.clamp(1, 100))
            .build();
        let mut cursor = self
            .payroll_runs
            .find(filter, options)
            .await
            .map_err(|_| AppError::Database)?;
        let mut items = Vec::new();
        while cursor.advance().await.map_err(|_| AppError::Database)? {
            items.push(
                cursor
                    .deserialize_current()
                    .map_err(|_| AppError::Database)?,
            );
        }
        Ok((items, total))
    }

    pub async fn upsert_payroll_run(
        &self,
        run: &PayrollRunRecord,
    ) -> Result<PayrollRunRecord, AppError> {
        let update = doc! {
            "$setOnInsert": {
                "salonId": &run.salon_id,
                "branchId": &run.branch_id,
                "periodStart": &run.period_start,
                "periodEnd": &run.period_end,
                "generatedByUserId": &run.generated_by_user_id,
            },
            "$set": {
                "items": mongodb::bson::to_bson(&run.items).unwrap_or(mongodb::bson::Bson::Array(Vec::new())),
                "totalGrossPayPaise": run.total_gross_pay_paise,
                "status": "draft",
            },
        };
        let result = self
            .payroll_runs
            .find_one_and_update(
                doc! {
                    "salonId": &run.salon_id,
                    "branchId": &run.branch_id,
                    "periodStart": &run.period_start,
                    "periodEnd": &run.period_end,
                },
                update,
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        result.ok_or(AppError::Database)
    }

    pub async fn update_payroll_run_status(
        &self,
        salon_id: &str,
        run_id: ObjectId,
        status: &str,
    ) -> Result<Option<PayrollRunRecord>, AppError> {
        self.payroll_runs
            .find_one_and_update(
                doc! { "_id": run_id, "salonId": salon_id },
                doc! { "$set": { "status": status } },
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)
    }

    pub async fn load_tax_settings(
        &self,
        salon_id: &str,
    ) -> Result<(String, String, i64, bool), AppError> {
        let doc = self
            .settings
            .find_one(doc! { "salonId": salon_id, "branchId": "" }, None)
            .await
            .map_err(|_| AppError::Database)?;
        let mut tax = mongodb::bson::Document::new();
        if let Some(settings) = doc {
            if let Some(mongodb::bson::Bson::Document(tax_doc)) = settings.settings.get("tax") {
                tax = tax_doc.clone();
            }
        }
        let gstin = tax.get_str("gstin").unwrap_or("").to_string();
        let place_of_supply = tax.get_str("placeOfSupply").unwrap_or("").to_string();
        let rate = tax
            .get_i64("defaultTaxRateBps")
            .unwrap_or(0)
            .clamp(0, 10000);
        let prices_include_tax = tax.get_bool("pricesIncludeTax").unwrap_or(false);
        Ok((gstin, place_of_supply, rate, prices_include_tax))
    }

    pub async fn update_tax_settings(
        &self,
        salon_id: &str,
        user_id: &str,
        tax: &mongodb::bson::Document,
    ) -> Result<(), AppError> {
        let tax_doc = mongodb::bson::Bson::Document(tax.clone());
        let update_doc = doc! { "$set": { "settings.tax": tax_doc, "lastChangedBy": user_id } };
        self.settings
            .find_one_and_update(
                doc! { "salonId": salon_id, "branchId": "" },
                update_doc,
                FindOneAndUpdateOptions::builder()
                    .upsert(true)
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await
            .map_err(|_| AppError::Database)?;
        Ok(())
    }
}
