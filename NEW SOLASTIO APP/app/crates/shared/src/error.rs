use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Authentication is required.")]
    Authentication,
    #[error("Required permission is missing.")]
    Authorization,
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("This record changed elsewhere. Refresh and try again.")]
    StaleVersion,
    #[error("Database operation failed.")]
    Database,
    #[error("External service failed.")]
    ExternalService,
    #[error("Internal server error.")]
    Internal,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    ok: bool,
    error: ErrorMessage<'a>,
}

#[derive(Serialize)]
struct ErrorMessage<'a> {
    code: &'a str,
    message: String,
}

impl AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::Authentication => StatusCode::UNAUTHORIZED,
            Self::Authorization => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) | Self::StaleVersion => StatusCode::CONFLICT,
            Self::Database | Self::ExternalService | Self::Internal => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "VALIDATION_ERROR",
            Self::Authentication => "AUTHENTICATION_ERROR",
            Self::Authorization => "AUTHORIZATION_ERROR",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Conflict(_) => "CONFLICT",
            Self::StaleVersion => "STALE_VERSION",
            Self::Database => "DATABASE_ERROR",
            Self::ExternalService => "EXTERNAL_SERVICE_ERROR",
            Self::Internal => "INTERNAL_ERROR",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = ErrorBody {
            ok: false,
            error: ErrorMessage {
                code: self.code(),
                message: self.to_string(),
            },
        };
        (status, Json(body)).into_response()
    }
}
