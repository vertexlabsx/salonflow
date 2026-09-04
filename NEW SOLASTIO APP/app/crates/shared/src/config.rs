use std::env;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub env: String,
    pub port: u16,
    pub mongodb_uri: String,
    pub mongodb_database: String,
    pub mongodb_max_pool_size: u32,
    pub mongodb_auto_index: Option<bool>,
    pub cors_origins: Vec<String>,
    pub cookie_domain: Option<String>,
    pub cookie_samesite: String,
    pub cookie_secure: bool,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
    pub csrf_secret: String,
    pub access_token_ttl_minutes: i64,
    pub refresh_token_ttl_days: i64,
    pub seed_salon_id: String,
    pub seed_salon_name: String,
    pub salon_timezone: String,
    pub seed_owner_login: String,
    pub seed_owner_password: String,
    pub seed_staff_login: String,
    pub seed_staff_password: String,
    pub whatsapp_provider: String,
    pub web_push_public_key: Option<String>,
    pub web_push_private_key: Option<String>,
    pub meta_graph_api_base_url: String,
    pub meta_graph_api_version: String,
    pub meta_api_version: Option<String>,
    pub meta_app_id: Option<String>,
    pub meta_config_id: Option<String>,
    pub meta_credential_encryption_key: Option<String>,
    pub meta_waba_phone_number_id: Option<String>,
    pub meta_whatsapp_token: Option<String>,
    pub meta_app_secret: Option<String>,
    pub meta_webhook_app_secret: Option<String>,
    pub verify_token: Option<String>,
    pub meta_webhook_verify_token: Option<String>,
    pub whatsapp_booking_flow_id: Option<String>,
    pub whatsapp_booking_flow_layout: String,
    pub whatsapp_flow_private_key: Option<String>,
    pub whatsapp_flow_private_key_path: Option<String>,
    pub whatsapp_concierge_enabled: bool,
    pub whatsapp_concierge_max_turns: i64,
    pub whatsapp_concierge_model: Option<String>,
    pub shopify_api_key: Option<String>,
    pub shopify_api_secret: Option<String>,
    pub shopify_scopes: String,
    pub shopify_app_url: Option<String>,
    pub shopify_jwt_secret: String,
    pub shopify_admin_email: String,
    pub shopify_admin_password: String,
    pub shopify_client_email: String,
    pub shopify_client_password: String,
    pub razorpay_key_id: Option<String>,
    pub razorpay_key_secret: Option<String>,
    pub razorpay_webhook_secret: Option<String>,
    pub openai_api_key: Option<String>,
    pub openai_model: String,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let mongodb_uri = read_env(
            "MONGODB_URI",
            "mongodb://127.0.0.1:27017/aura_saas?replicaSet=rs0",
        );
        let config = Self {
            env: read_env("NODE_ENV", "development"),
            port: read_env("PORT", "4000")
                .parse()
                .map_err(|_| "PORT must be a valid u16".to_string())?,
            mongodb_database: read_env("MONGODB_DATABASE", "aura_saas"),
            mongodb_max_pool_size: read_env("MONGODB_MAX_POOL_SIZE", "10")
                .parse()
                .map_err(|_| "MONGODB_MAX_POOL_SIZE must be valid".to_string())?,
            mongodb_auto_index: optional_bool("MONGODB_AUTO_INDEX")?,
            mongodb_uri,
            cors_origins: read_env(
                "CORS_ORIGINS",
                "http://127.0.0.1:4320,http://localhost:4320",
            )
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
            cookie_domain: optional_env("COOKIE_DOMAIN"),
            cookie_samesite: enum_env("COOKIE_SAMESITE", "lax", &["lax", "none", "strict"])?
                .to_string(),
            cookie_secure: bool_env("COOKIE_SECURE", false),
            jwt_access_secret: required_secret("JWT_ACCESS_SECRET")?,
            jwt_refresh_secret: required_secret("JWT_REFRESH_SECRET")?,
            csrf_secret: required_secret("CSRF_SECRET")?,
            access_token_ttl_minutes: read_env("ACCESS_TOKEN_TTL_MINUTES", "15")
                .parse()
                .map_err(|_| "ACCESS_TOKEN_TTL_MINUTES must be valid".to_string())?,
            refresh_token_ttl_days: read_env("REFRESH_TOKEN_TTL_DAYS", "14")
                .parse()
                .map_err(|_| "REFRESH_TOKEN_TTL_DAYS must be valid".to_string())?,
            seed_salon_id: read_env("SEED_SALON_ID", "tenant_aura"),
            seed_salon_name: read_env("SEED_SALON_NAME", "Solastio Studio - Flagship"),
            salon_timezone: read_env("SALON_TIMEZONE", "Asia/Kolkata"),
            seed_owner_login: read_env("SEED_OWNER_LOGIN", "owner"),
            seed_owner_password: read_env("SEED_OWNER_PASSWORD", "owner@123"),
            seed_staff_login: read_env("SEED_STAFF_LOGIN", "reception"),
            seed_staff_password: read_env("SEED_STAFF_PASSWORD", "staff@123"),
            whatsapp_provider: enum_env(
                "WHATSAPP_PROVIDER",
                "mock",
                &["mock", "meta", "meta_test", "meta_production"],
            )?
            .to_string(),
            web_push_public_key: optional_env("WEB_PUSH_PUBLIC_KEY"),
            web_push_private_key: optional_env("WEB_PUSH_PRIVATE_KEY"),
            meta_graph_api_base_url: read_env(
                "META_GRAPH_API_BASE_URL",
                "https://graph.facebook.com",
            ),
            meta_graph_api_version: read_env("META_GRAPH_API_VERSION", "v21.0"),
            meta_api_version: optional_env("META_API_VERSION"),
            meta_app_id: optional_env("META_APP_ID"),
            meta_config_id: optional_env("META_CONFIG_ID"),
            meta_credential_encryption_key: optional_env("META_CREDENTIAL_ENCRYPTION_KEY"),
            meta_waba_phone_number_id: optional_env("META_WABA_PHONE_NUMBER_ID"),
            meta_whatsapp_token: optional_env("META_WHATSAPP_TOKEN"),
            meta_app_secret: optional_env("META_APP_SECRET"),
            meta_webhook_app_secret: optional_env("META_WEBHOOK_APP_SECRET"),
            verify_token: optional_env("VERIFY_TOKEN"),
            meta_webhook_verify_token: optional_env("META_WEBHOOK_VERIFY_TOKEN"),
            whatsapp_booking_flow_id: optional_env("WHATSAPP_BOOKING_FLOW_ID"),
            whatsapp_booking_flow_layout: enum_env(
                "WHATSAPP_BOOKING_FLOW_LAYOUT",
                "appointment",
                &["appointment", "guided"],
            )?
            .to_string(),
            whatsapp_flow_private_key: optional_env("WHATSAPP_FLOW_PRIVATE_KEY"),
            whatsapp_flow_private_key_path: optional_env("WHATSAPP_FLOW_PRIVATE_KEY_PATH"),
            whatsapp_concierge_enabled: bool_env("WHATSAPP_CONCIERGE_ENABLED", false),
            whatsapp_concierge_max_turns: read_env("WHATSAPP_CONCIERGE_MAX_TURNS", "4")
                .parse()
                .map_err(|_| "WHATSAPP_CONCIERGE_MAX_TURNS must be valid".to_string())?,
            whatsapp_concierge_model: optional_env("WHATSAPP_CONCIERGE_MODEL"),
            shopify_api_key: optional_env("SHOPIFY_API_KEY"),
            shopify_api_secret: optional_env("SHOPIFY_API_SECRET"),
            shopify_scopes: read_env(
                "SHOPIFY_SCOPES",
                "read_customers,read_orders,read_products,read_checkouts,write_webhooks",
            ),
            shopify_app_url: optional_env("SHOPIFY_APP_URL"),
            shopify_jwt_secret: required_secret("SHOPIFY_JWT_SECRET")?,
            shopify_admin_email: required_env("SHOPIFY_ADMIN_EMAIL")?,
            shopify_admin_password: min_len_env("SHOPIFY_ADMIN_PASSWORD", 8)?,
            shopify_client_email: read_env("SHOPIFY_CLIENT_EMAIL", ""),
            shopify_client_password: read_env("SHOPIFY_CLIENT_PASSWORD", ""),
            razorpay_key_id: optional_env("RAZORPAY_KEY_ID"),
            razorpay_key_secret: optional_env("RAZORPAY_KEY_SECRET"),
            razorpay_webhook_secret: optional_env("RAZORPAY_WEBHOOK_SECRET"),
            openai_api_key: optional_env("OPENAI_API_KEY"),
            openai_model: read_env("OPENAI_MODEL", "gpt-4o-mini"),
        };
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), String> {
        if self.mongodb_max_pool_size == 0 || self.mongodb_max_pool_size > 100 {
            return Err("MONGODB_MAX_POOL_SIZE must be between 1 and 100".to_string());
        }
        if self.whatsapp_concierge_max_turns < 0 || self.whatsapp_concierge_max_turns > 20 {
            return Err("WHATSAPP_CONCIERGE_MAX_TURNS must be between 0 and 20".to_string());
        }
        if self.web_push_public_key.is_some() != self.web_push_private_key.is_some() {
            return Err(
                "WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be configured together"
                    .to_string(),
            );
        }
        if self.env == "production" {
            validate_production_secret("JWT_ACCESS_SECRET", &self.jwt_access_secret)?;
            validate_production_secret("JWT_REFRESH_SECRET", &self.jwt_refresh_secret)?;
            validate_production_secret("CSRF_SECRET", &self.csrf_secret)?;
            if contains_localhost(&self.mongodb_uri) {
                return Err("Production must use a persistent MONGODB_URI".to_string());
            }
            if !self.cookie_secure {
                return Err("Production must set COOKIE_SECURE=true behind HTTPS".to_string());
            }
            if self
                .cors_origins
                .iter()
                .any(|origin| contains_localhost(origin))
            {
                return Err(
                    "Production CORS_ORIGINS must contain only real HTTPS origins".to_string(),
                );
            }
            validate_production_seed_password("SEED_OWNER_PASSWORD", &self.seed_owner_password)?;
            validate_production_seed_password("SEED_STAFF_PASSWORD", &self.seed_staff_password)?;
            if self.whatsapp_provider == "meta" {
                require_configured("META_WABA_PHONE_NUMBER_ID", &self.meta_waba_phone_number_id)?;
                require_configured("META_WHATSAPP_TOKEN", &self.meta_whatsapp_token)?;
                require_configured("META_APP_SECRET", &self.meta_app_secret)?;
                self.require_any_verify_token()?;
            }
            if self.whatsapp_provider == "meta_test" || self.whatsapp_provider == "meta_production"
            {
                require_configured("META_APP_ID", &self.meta_app_id)?;
                require_configured("META_APP_SECRET", &self.meta_app_secret)?;
                require_configured("META_CONFIG_ID", &self.meta_config_id)?;
                self.require_any_verify_token()?;
            }
        }
        Ok(())
    }

    fn require_any_verify_token(&self) -> Result<(), String> {
        if self.meta_webhook_verify_token.is_none() && self.verify_token.is_none() {
            return Err("META_WEBHOOK_VERIFY_TOKEN or VERIFY_TOKEN is required".to_string());
        }
        Ok(())
    }
}

fn read_env(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}

fn required_env(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("{key} is required"))
}

fn optional_env(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.is_empty())
}

fn min_len_env(key: &str, min_len: usize) -> Result<String, String> {
    let value = required_env(key)?;
    if value.len() < min_len {
        return Err(format!("{key} must be at least {min_len} characters"));
    }
    Ok(value)
}

fn required_secret(key: &str) -> Result<String, String> {
    let value = env::var(key).map_err(|_| format!("{key} is required"))?;
    if value.len() < 16 {
        return Err(format!("{key} must be at least 16 characters"));
    }
    Ok(value)
}

fn bool_env(key: &str, fallback: bool) -> bool {
    env::var(key)
        .map(|value| truthy(&value))
        .unwrap_or(fallback)
}

fn optional_bool(key: &str) -> Result<Option<bool>, String> {
    Ok(env::var(key).ok().map(|value| truthy(&value)))
}

fn truthy(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
}

fn enum_env<'a>(key: &str, fallback: &'a str, allowed: &'a [&str]) -> Result<&'a str, String> {
    let value = env::var(key).unwrap_or_else(|_| fallback.to_string());
    allowed
        .iter()
        .copied()
        .find(|allowed| *allowed == value)
        .ok_or_else(|| format!("{key} must be one of {}", allowed.join(", ")))
}

fn validate_production_secret(key: &str, value: &str) -> Result<(), String> {
    const PLACEHOLDERS: [&str; 5] = [
        "change-me",
        "replace-me",
        "replace-with-strong-access-secret",
        "replace-with-strong-refresh-secret",
        "replace-with-strong-csrf-secret",
    ];
    if value.len() < 32 || PLACEHOLDERS.contains(&value) {
        return Err(format!(
            "{key} must be a unique, non-placeholder value with at least 32 characters in production"
        ));
    }
    Ok(())
}

fn validate_production_seed_password(key: &str, value: &str) -> Result<(), String> {
    if value.len() < 12 || matches!(value, "owner@123" | "staff@123") {
        return Err(format!("{key} must be rotated before production seed"));
    }
    Ok(())
}

fn contains_localhost(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    lowered.contains("127.0.0.1")
        || lowered.contains("localhost")
        || lowered.contains("mongodb-memory-server")
}

fn require_configured(key: &str, value: &Option<String>) -> Result<(), String> {
    if value.is_none() {
        return Err(format!("{key} is required"));
    }
    Ok(())
}
