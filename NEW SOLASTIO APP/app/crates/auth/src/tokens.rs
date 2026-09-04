use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solastio_shared::{config::AppConfig, error::AppError};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccessClaims {
    pub sub: String,
    pub sid: String,
    pub ten: String,
    pub rol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stf: Option<String>,
    pub br0: String,
    pub brs: Vec<String>,
    pub prm: Vec<String>,
    pub exp: usize,
    pub iss: String,
}

pub struct AccessTokenInput {
    pub user_id: String,
    pub salon_id: String,
    pub role: String,
    pub staff_id: Option<String>,
    pub branch_id: String,
    pub branch_ids: Vec<String>,
    pub permissions: Vec<String>,
}

pub fn sign_access_token(
    config: &AppConfig,
    input: AccessTokenInput,
) -> Result<(String, String), AppError> {
    let session_id = Uuid::new_v4().to_string();
    let exp = Utc::now() + Duration::minutes(config.access_token_ttl_minutes);
    let claims = AccessClaims {
        sub: input.user_id,
        sid: session_id.clone(),
        ten: input.salon_id,
        rol: input.role,
        stf: input.staff_id,
        br0: input.branch_id,
        brs: input.branch_ids,
        prm: input.permissions,
        exp: exp.timestamp() as usize,
        iss: "aura-staff-server".to_string(),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_access_secret.as_bytes()),
    )
    .map_err(|_| AppError::Internal)?;
    Ok((token, session_id))
}

pub fn verify_access_token(config: &AppConfig, token: &str) -> Result<AccessClaims, AppError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&["aura-staff-server"]);
    decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(config.jwt_access_secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|_| AppError::Authentication)
}

pub fn generate_refresh_token() -> String {
    let mut bytes = [0_u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_refresh_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    format!("{:x}", hasher.finalize())
}
