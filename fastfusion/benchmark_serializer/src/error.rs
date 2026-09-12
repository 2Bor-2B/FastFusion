use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("OpenRouter request failed: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("OpenRouter returned no choices")]
    EmptyResponse,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::Reqwest(_) => StatusCode::BAD_GATEWAY,

            AppError::EmptyResponse => StatusCode::BAD_GATEWAY,
        };

        (
            status,
            Json(json!({
                "error": self.to_string()
            })),
        )
            .into_response()
    }
}
