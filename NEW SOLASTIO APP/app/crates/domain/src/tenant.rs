use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TenantContext {
    pub salon_id: String,
    pub user_id: String,
    pub role: String,
    pub staff_id: Option<String>,
    pub branch_id: String,
    pub branch_ids: Vec<String>,
    pub permissions: Vec<String>,
    pub crm_permissions: Vec<String>,
}
