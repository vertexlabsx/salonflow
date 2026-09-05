use bcrypt::verify;
use chrono::{Duration, Utc};
use mongodb::bson::DateTime;
use serde::{Deserialize, Serialize};
use solastio_auth::tokens::{
    generate_refresh_token, hash_refresh_token, sign_access_token, verify_access_token,
    AccessTokenInput,
};
use solastio_database::{
    models::{RefreshTokenRecord, SalonRecord, UserRecord},
    repositories::{SalonRepository, UserRepository},
};
use solastio_shared::{config::AppConfig, error::AppError};

#[derive(Clone)]
pub struct AuthService {
    config: AppConfig,
    users: UserRepository,
    salons: SalonRepository,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub tenant_id: String,
    pub login_id: String,
    pub password: String,
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub device: Option<DeviceRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub device: Option<DeviceRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutRequest {
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeviceRequest {
    #[serde(default)]
    pub r#type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutResponse {
    pub logged_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrfResponse {
    pub csrf_token: String,
    pub expires_at: String,
}

#[derive(Clone, Debug)]
pub struct RequestContext {
    pub user_id: String,
    pub salon_id: String,
    pub role: String,
    pub staff_id: Option<String>,
    pub branch_id: String,
    pub branch_ids: Vec<String>,
    pub permissions: Vec<String>,
    pub ip: String,
    pub user_agent: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: SessionUser,
    pub tenant: SessionTenant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub login_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_role_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<String>,
    pub branch_id: String,
    pub branch_ids: Vec<String>,
    pub permissions: Vec<String>,
    pub staff_app_permissions: Vec<String>,
    pub crm_permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionTenant {
    pub id: String,
    pub name: String,
}

impl AuthService {
    pub fn new(config: AppConfig, users: UserRepository, salons: SalonRepository) -> Self {
        Self {
            config,
            users,
            salons,
        }
    }

    pub async fn login(&self, request: LoginRequest) -> Result<SessionResponse, AppError> {
        if request.tenant_id.trim().is_empty() {
            return Err(AppError::Validation("Tenant ID is required.".to_string()));
        }
        let user = self
            .users
            .find_for_login(&request.tenant_id, &request.login_id)
            .await?;
        let password_matches = match &user {
            Some(user) => verify(&request.password, &user.password_hash).unwrap_or(false),
            None => {
                let _ = verify(
                    &request.password,
                    "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQ0PzNROl2tkVgkvXn8v1Rf2oA6W",
                );
                false
            }
        };
        let user = user
            .filter(|_| password_matches)
            .ok_or(AppError::Authentication)?;
        if user.totp_enabled {
            return Err(AppError::Authentication);
        }
        if user.status != "active" {
            return Err(AppError::Authorization);
        }
        if let Some(branch_id) = request.branch_id.as_deref() {
            if !user.branch_ids.is_empty() && !user.branch_ids.iter().any(|item| item == branch_id)
            {
                return Err(AppError::Authorization);
            }
        }
        let salon = self.require_active_salon(&request.tenant_id).await?;
        self.issue_session(
            user,
            salon,
            request
                .device
                .and_then(|device| device.r#type)
                .unwrap_or_default(),
        )
        .await
    }

    pub async fn refresh(&self, request: RefreshRequest) -> Result<SessionResponse, AppError> {
        let raw_token = request.refresh_token.unwrap_or_default();
        if raw_token.is_empty() {
            return Err(AppError::Authentication);
        }
        let token_hash = hash_refresh_token(&raw_token);
        let user = self
            .users
            .find_by_refresh_hash(&token_hash)
            .await?
            .ok_or(AppError::Authentication)?;
        let record = user
            .refresh_tokens
            .iter()
            .find(|record| record.token_hash == token_hash)
            .ok_or(AppError::Authentication)?;
        if record.revoked_at.is_some()
            || record.expires_at.timestamp_millis() <= DateTime::now().timestamp_millis()
        {
            return Err(AppError::Authentication);
        }
        if user.status != "active" {
            return Err(AppError::Authorization);
        }
        let salon = self.require_active_salon(&user.salon_id).await?;
        let next = self
            .issue_session(
                user,
                salon,
                request
                    .device
                    .and_then(|device| device.r#type)
                    .unwrap_or_default(),
            )
            .await?;
        self.users
            .revoke_refresh(&token_hash, Some(&hash_refresh_token(&next.refresh_token)))
            .await?;
        Ok(next)
    }

    pub async fn logout(&self, request: LogoutRequest) -> Result<LogoutResponse, AppError> {
        if let Some(raw_token) = request.refresh_token.filter(|token| !token.is_empty()) {
            self.users
                .revoke_refresh(&hash_refresh_token(&raw_token), None)
                .await?;
        }
        Ok(LogoutResponse { logged_out: true })
    }

    pub async fn demo_staff_session(&self) -> Result<SessionResponse, AppError> {
        let salon = match self.salons.find_first_active().await? {
            Some(s) => s,
            None => match self.salons.find_by_id("tenant_aura").await? {
                Some(s) => s,
                None => return Err(AppError::NotFound("No active salon found".to_string())),
            },
        };
        let user = self
            .users
            .find_first_staff(&salon.id)
            .await?
            .ok_or_else(|| AppError::NotFound("No staff user found".to_string()))?;
        self.issue_session(user, salon, "demo-staff-session".to_string())
            .await
    }

    pub fn issue_csrf(&self) -> CsrfResponse {
        let expires_at = Utc::now() + Duration::minutes(10);
        CsrfResponse {
            csrf_token: generate_refresh_token(),
            expires_at: expires_at.to_rfc3339(),
        }
    }

    pub async fn context_from_token(&self, token: &str) -> Result<RequestContext, AppError> {
        let claims = verify_access_token(&self.config, token)?;
        let user = self
            .users
            .find_active_context(&claims.sub, &claims.ten)
            .await?
            .ok_or(AppError::Authentication)?;
        if user.status != "active" {
            return Err(AppError::Authorization);
        }
        let permissions = user.effective_permissions();
        Ok(RequestContext {
            user_id: user.id.to_hex(),
            salon_id: user.salon_id,
            role: user.role,
            staff_id: user.staff_id,
            branch_id: user.branch_id,
            branch_ids: user.branch_ids,
            permissions,
            ip: String::new(),
            user_agent: String::new(),
        })
    }

    async fn require_active_salon(&self, tenant_id: &str) -> Result<SalonRecord, AppError> {
        let salon = self
            .salons
            .find_by_id(tenant_id)
            .await?
            .ok_or(AppError::Authentication)?;
        if salon.status != "active" {
            return Err(AppError::Authorization);
        }
        Ok(salon)
    }

    async fn issue_session(
        &self,
        user: UserRecord,
        salon: SalonRecord,
        device_type: String,
    ) -> Result<SessionResponse, AppError> {
        let permissions = user.effective_permissions();
        let (access_token, _session_id) = sign_access_token(
            &self.config,
            AccessTokenInput {
                user_id: user.id.to_hex(),
                salon_id: user.salon_id.clone(),
                role: user.role.clone(),
                staff_id: user.staff_id.clone(),
                branch_id: user.branch_id.clone(),
                branch_ids: user.branch_ids.clone(),
                permissions: permissions.clone(),
            },
        )?;
        let refresh_token = generate_refresh_token();
        let expires_at = Utc::now() + Duration::days(self.config.refresh_token_ttl_days);
        self.users
            .append_refresh_token(
                user.id,
                RefreshTokenRecord {
                    token_hash: hash_refresh_token(&refresh_token),
                    issued_at: DateTime::now(),
                    expires_at: DateTime::from_millis(expires_at.timestamp_millis()),
                    revoked_at: None,
                    replaced_by_hash: None,
                    device_type,
                },
            )
            .await?;
        Ok(SessionResponse {
            access_token,
            refresh_token,
            user: SessionUser {
                id: user.id.to_hex(),
                name: user.name,
                login_id: user.login_id,
                email: user.email,
                role: user.role,
                role_display_name: user.role_display_name,
                custom_role_name: user.custom_role_name,
                staff_id: user.staff_id,
                branch_id: user.branch_id,
                branch_ids: user.branch_ids,
                permissions,
                staff_app_permissions: user.staff_app_permissions,
                crm_permissions: user.crm_permissions,
            },
            tenant: SessionTenant {
                id: salon.id,
                name: salon.name,
            },
        })
    }
}
