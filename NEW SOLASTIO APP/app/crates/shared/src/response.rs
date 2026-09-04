use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct Envelope<T: Serialize> {
    pub ok: bool,
    pub data: T,
}

pub fn ok<T: Serialize>(data: T) -> Response {
    (StatusCode::OK, Json(Envelope { ok: true, data })).into_response()
}
