use axum::{
    Router,
    routing::{get, post},
};

use std::sync::Arc;

use crate::{api::handlers, state::AppState};

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/run", post(handlers::run))
        .route("/health", get(|| async { "ok" }))
        .with_state(state)
}
