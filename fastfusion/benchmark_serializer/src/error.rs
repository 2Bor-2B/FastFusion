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

    /// A non-2xx reply from OpenRouter, carrying the message it sent back.
    /// Without the body a rate limit and an unknown model look identical.
    #[error("OpenRouter returned {status}: {message}")]
    Upstream { status: u16, message: String },

    #[error("OpenRouter returned no choices")]
    EmptyResponse,
}

impl AppError {
    /// Builds an `Upstream` error from a raw response body. OpenRouter reports
    /// failures as `{"error": {"message": "...", "code": ...}}`, so prefer that
    /// message and fall back to the body itself (truncated) for anything else.
    pub fn upstream(status: u16, body: &str) -> Self {
        let message = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| {
                let error = value.get("error")?;
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .or_else(|| error.as_str().map(str::to_string))
            })
            .unwrap_or_else(|| {
                let body = body.trim();
                if body.is_empty() {
                    "(empty response body)".to_string()
                } else {
                    body.chars().take(500).collect()
                }
            });

        AppError::Upstream { status, message }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::Reqwest(_) => StatusCode::BAD_GATEWAY,

            AppError::Upstream { .. } => StatusCode::BAD_GATEWAY,

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

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn upstream_prefers_the_openrouter_error_message() {
        let error = AppError::upstream(
            429,
            r#"{"error":{"message":"Rate limit exceeded: free-models-per-day","code":429}}"#,
        );
        assert_eq!(
            error.to_string(),
            "OpenRouter returned 429: Rate limit exceeded: free-models-per-day"
        );
    }

    #[test]
    fn upstream_falls_back_to_a_plain_string_error_field() {
        let error = AppError::upstream(403, r#"{"error":"forbidden"}"#);
        assert_eq!(error.to_string(), "OpenRouter returned 403: forbidden");
    }

    #[test]
    fn upstream_falls_back_to_the_raw_body() {
        let error = AppError::upstream(502, "<html>bad gateway</html>");
        assert_eq!(
            error.to_string(),
            "OpenRouter returned 502: <html>bad gateway</html>"
        );
    }

    #[test]
    fn upstream_truncates_a_long_body_without_splitting_characters() {
        let body = "文".repeat(1000);
        let error = AppError::upstream(500, &body);
        let AppError::Upstream { message, .. } = error else {
            panic!("expected an upstream error");
        };
        assert_eq!(message.chars().count(), 500);
    }

    #[test]
    fn upstream_reports_an_empty_body() {
        let error = AppError::upstream(504, "   ");
        assert_eq!(
            error.to_string(),
            "OpenRouter returned 504: (empty response body)"
        );
    }
}
